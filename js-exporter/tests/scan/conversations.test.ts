import { describe, it, expect, vi } from "vitest";
import { scanConversations } from "../../src/scan/conversations";
import type { ExportState } from "../../src/types";
import { defaultState } from "../../src/state/defaults";

const createMockNet = () => ({
  getToken: vi.fn().mockResolvedValue("token"),
  fetchJson: vi.fn(),
});

const createMockDeps = () => {
  const net = createMockNet();
  return {
    net,
    S: defaultState(),
    log: vi.fn(),
    setStatus: vi.fn(),
  };
};

describe("scanConversations", () => {
  it("calls getToken before scanning", async () => {
    const deps = createMockDeps();
    deps.net.fetchJson.mockResolvedValue({ items: [] });
    const ac = new AbortController();

    await scanConversations(deps.net, deps.S, ac.signal, null, null, deps.log, deps.setStatus);
    expect(deps.net.getToken).toHaveBeenCalledWith(ac.signal);
  });

  it("paginates correctly using offset + limit=100", async () => {
    const deps = createMockDeps();
    // Page size is fixed at 100
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `id-${i}`,
      title: `T-${i}`,
      update_time: i,
    }));
    const page2 = [{ id: "last", title: "Last", update_time: 999 }];

    deps.net.fetchJson
      .mockResolvedValueOnce({ items: page1 })
      .mockResolvedValueOnce({ items: page2 });
    const ac = new AbortController();

    const items = await scanConversations(
      deps.net,
      deps.S,
      ac.signal,
      null,
      null,
      deps.log,
      deps.setStatus,
    );

    expect(items).toHaveLength(101);
    expect(items[0].id).toBe("id-0");
    expect(items[100].id).toBe("last");
    // First call: offset=0, limit=100
    expect(deps.net.fetchJson.mock.calls[0][0]).toContain("offset=0");
    expect(deps.net.fetchJson.mock.calls[0][0]).toContain("limit=100");
    // Second call: offset=100
    expect(deps.net.fetchJson.mock.calls[1][0]).toContain("offset=100");
  });

  it("stops when receiving empty page", async () => {
    const deps = createMockDeps();
    deps.net.fetchJson.mockResolvedValueOnce({ items: [] });
    const ac = new AbortController();

    const items = await scanConversations(
      deps.net,
      deps.S,
      ac.signal,
      null,
      null,
      deps.log,
      deps.setStatus,
    );

    expect(items).toHaveLength(0);
    expect(deps.net.fetchJson).toHaveBeenCalledTimes(1);
  });

  it("stops when page has fewer items than pageSize", async () => {
    const deps = createMockDeps();
    deps.net.fetchJson.mockResolvedValueOnce({
      items: Array.from({ length: 10 }, (_, i) => ({
        id: `id-${i}`,
        title: `T-${i}`,
        update_time: i,
      })),
    });
    const ac = new AbortController();

    const items = await scanConversations(
      deps.net,
      deps.S,
      ac.signal,
      null,
      null,
      deps.log,
      deps.setStatus,
    );

    expect(items).toHaveLength(10);
    expect(deps.net.fetchJson).toHaveBeenCalledTimes(1);
  });

  it("respects knownIds for early termination (2 consecutive known pages)", async () => {
    const deps = createMockDeps();
    // Pages of 100 items each, all known
    const knownIds = new Set<string>();
    const page1 = Array.from({ length: 100 }, (_, i) => {
      const id = `known-${i}`;
      knownIds.add(id);
      return { id, title: `T-${i}`, update_time: i };
    });
    const page2 = Array.from({ length: 100 }, (_, i) => {
      const id = `known-${100 + i}`;
      knownIds.add(id);
      return { id, title: `T-${100 + i}`, update_time: 100 + i };
    });

    deps.net.fetchJson
      .mockResolvedValueOnce({ items: page1 })
      .mockResolvedValueOnce({ items: page2 });
    const ac = new AbortController();

    await scanConversations(
      deps.net,
      deps.S,
      ac.signal,
      null,
      knownIds,
      deps.log,
      deps.setStatus,
    );

    // Should stop after 2 consecutive pages of all-known items
    expect(deps.net.fetchJson).toHaveBeenCalledTimes(2);
    expect(deps.log).toHaveBeenCalledWith(
      "info",
      "scan",
      expect.stringContaining("early-exit"),
      expect.any(Object),
    );
  });

  it("resets consecutiveKnownPages when new items are found", async () => {
    const deps = createMockDeps();
    const knownIds = new Set<string>();
    // Page 1: all known
    const page1 = Array.from({ length: 100 }, (_, i) => {
      const id = `known-${i}`;
      knownIds.add(id);
      return { id, title: `T-${i}`, update_time: i };
    });
    // Page 2: has new items - resets counter
    const page2 = Array.from({ length: 5 }, (_, i) => ({
      id: `new-${i}`,
      title: `New-${i}`,
      update_time: 200 + i,
    }));

    deps.net.fetchJson
      .mockResolvedValueOnce({ items: page1 })
      .mockResolvedValueOnce({ items: page2 }); // partial page - stops
    const ac = new AbortController();

    await scanConversations(deps.net, deps.S, ac.signal, null, knownIds, deps.log, deps.setStatus);

    // 2 calls: first known (count=1), second has new (resets) but partial so stops
    expect(deps.net.fetchJson).toHaveBeenCalledTimes(2);
  });

  it("calls onPage callback with page items", async () => {
    const deps = createMockDeps();
    const onPage = vi.fn();
    deps.net.fetchJson
      .mockResolvedValueOnce({
        items: [{ id: "a", title: "A", update_time: 100 }],
      });
    const ac = new AbortController();

    await scanConversations(deps.net, deps.S, ac.signal, onPage, null, deps.log, deps.setStatus);

    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith([
      { id: "a", title: "A", update_time: 100, gizmo_id: null },
    ]);
  });

  it("extracts gizmo_id from item, preferring gizmo_id over project_id", async () => {
    const deps = createMockDeps();
    deps.net.fetchJson.mockResolvedValueOnce({
      items: [
        { id: "a", title: "A", update_time: 1, gizmo_id: "g1" },
        { id: "b", title: "B", update_time: 2, project_id: "p1" },
        { id: "c", title: "C", update_time: 3 },
      ],
    });
    const ac = new AbortController();

    const items = await scanConversations(
      deps.net,
      deps.S,
      ac.signal,
      null,
      null,
      deps.log,
      deps.setStatus,
    );

    expect(items[0].gizmo_id).toBe("g1");
    expect(items[1].gizmo_id).toBe("p1");
    expect(items[2].gizmo_id).toBeNull();
  });

  it("stops when offset reaches data.total", async () => {
    const deps = createMockDeps();
    deps.net.fetchJson.mockResolvedValueOnce({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: `id-${i}`,
        title: `T-${i}`,
        update_time: i,
      })),
      total: 100,
    });
    const ac = new AbortController();

    const items = await scanConversations(
      deps.net,
      deps.S,
      ac.signal,
      null,
      null,
      deps.log,
      deps.setStatus,
    );

    expect(items).toHaveLength(100);
    expect(deps.net.fetchJson).toHaveBeenCalledTimes(1);
  });
});
