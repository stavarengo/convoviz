import { describe, it, expect, vi, beforeEach } from "vitest";
import { scanConversations } from "../../src/scan/conversations";
import type { PendingItem, ExportState } from "../../src/types";

const createMockNet = () => ({
  getToken: vi.fn().mockResolvedValue("token"),
  fetchJson: vi.fn(),
});

const createMockDeps = (overrides?: Partial<ReturnType<typeof makeDeps>>) => {
  const net = createMockNet();
  return {
    net,
    S: {
      settings: { batch: 50 },
    } as unknown as ExportState,
    addLog: vi.fn(),
    setStatus: vi.fn(),
    ...overrides,
  };
};

const makeDeps = createMockDeps;

describe("scanConversations", () => {
  it("calls getToken before scanning", async () => {
    const deps = createMockDeps();
    deps.net.fetchJson.mockResolvedValue({ items: [] });
    const ac = new AbortController();

    await scanConversations(deps.net, deps.S, ac.signal, null, null, deps.addLog, deps.setStatus);
    expect(deps.net.getToken).toHaveBeenCalledWith(ac.signal);
  });

  it("paginates correctly using offset + limit", async () => {
    const deps = createMockDeps();
    // Set batch=2 so pageSize=2, meaning a full page is 2 items
    deps.S.settings.batch = 2 as any;
    deps.net.fetchJson
      .mockResolvedValueOnce({
        items: [
          { id: "a", title: "A", update_time: 100 },
          { id: "b", title: "B", update_time: 200 },
        ],
      })
      .mockResolvedValueOnce({
        items: [{ id: "c", title: "C", update_time: 300 }],
      });
    const ac = new AbortController();

    const items = await scanConversations(
      deps.net,
      deps.S,
      ac.signal,
      null,
      null,
      deps.addLog,
      deps.setStatus,
    );

    expect(items).toHaveLength(3);
    expect(items[0].id).toBe("a");
    expect(items[2].id).toBe("c");
    // First call: offset=0, limit=2
    expect(deps.net.fetchJson.mock.calls[0][0]).toContain("offset=0");
    expect(deps.net.fetchJson.mock.calls[0][0]).toContain("limit=2");
    // Second call: offset=2
    expect(deps.net.fetchJson.mock.calls[1][0]).toContain("offset=2");
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
      deps.addLog,
      deps.setStatus,
    );

    expect(items).toHaveLength(0);
    expect(deps.net.fetchJson).toHaveBeenCalledTimes(1);
  });

  it("stops when page has fewer items than pageSize", async () => {
    const deps = createMockDeps();
    // batch=50, pageSize=min(50,100)=50. Page returns 10 items < 50
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
      deps.addLog,
      deps.setStatus,
    );

    expect(items).toHaveLength(10);
    expect(deps.net.fetchJson).toHaveBeenCalledTimes(1);
  });

  it("respects knownIds for early termination (2 consecutive known pages)", async () => {
    const deps = createMockDeps();
    // Set batch=1 so pageSize=1, so 1-item pages count as full
    deps.S.settings.batch = 1 as any;
    const knownIds = new Set(["a", "b"]);

    deps.net.fetchJson
      .mockResolvedValueOnce({ items: [{ id: "a", title: "A", update_time: 1 }] })
      .mockResolvedValueOnce({ items: [{ id: "b", title: "B", update_time: 2 }] });
    const ac = new AbortController();

    const items = await scanConversations(
      deps.net,
      deps.S,
      ac.signal,
      null,
      knownIds,
      deps.addLog,
      deps.setStatus,
    );

    // Should stop after 2 consecutive pages of all-known items
    expect(deps.net.fetchJson).toHaveBeenCalledTimes(2);
    expect(deps.addLog).toHaveBeenCalledWith(expect.stringContaining("early-exit"));
  });

  it("resets consecutiveKnownPages when new items are found", async () => {
    const deps = createMockDeps();
    // Set batch=1 so pageSize=1, so 1-item pages count as full
    deps.S.settings.batch = 1 as any;
    const knownIds = new Set(["a"]);

    deps.net.fetchJson
      .mockResolvedValueOnce({ items: [{ id: "a", title: "A", update_time: 1 }] }) // all known - count=1
      .mockResolvedValueOnce({ items: [{ id: "b", title: "B", update_time: 2 }] }) // new item - resets
      .mockResolvedValueOnce({ items: [] }); // empty - stops
    const ac = new AbortController();

    await scanConversations(deps.net, deps.S, ac.signal, null, knownIds, deps.addLog, deps.setStatus);

    // 3 calls: first known, second new (resets counter), third empty (stops)
    expect(deps.net.fetchJson).toHaveBeenCalledTimes(3);
  });

  it("calls onPage callback with page items", async () => {
    const deps = createMockDeps();
    const onPage = vi.fn();
    deps.net.fetchJson
      .mockResolvedValueOnce({
        items: [{ id: "a", title: "A", update_time: 100 }],
      });
    const ac = new AbortController();

    await scanConversations(deps.net, deps.S, ac.signal, onPage, null, deps.addLog, deps.setStatus);

    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith([
      { id: "a", title: "A", update_time: 100, gizmo_id: null },
    ]);
  });

  it("caps page size at 100 and shows status message", async () => {
    const deps = createMockDeps();
    deps.S.settings.batch = 200 as any;
    deps.net.fetchJson.mockResolvedValueOnce({ items: [] });
    const ac = new AbortController();

    await scanConversations(deps.net, deps.S, ac.signal, null, null, deps.addLog, deps.setStatus);

    expect(deps.net.fetchJson.mock.calls[0][0]).toContain("limit=100");
    expect(deps.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("capped at 100"),
    );
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
      deps.addLog,
      deps.setStatus,
    );

    expect(items[0].gizmo_id).toBe("g1");
    expect(items[1].gizmo_id).toBe("p1");
    expect(items[2].gizmo_id).toBeNull();
  });

  it("stops when offset reaches data.total", async () => {
    const deps = createMockDeps();
    deps.S.settings.batch = 2 as any;
    deps.net.fetchJson.mockResolvedValueOnce({
      items: [
        { id: "a", title: "A", update_time: 1 },
        { id: "b", title: "B", update_time: 2 },
      ],
      total: 2,
    });
    const ac = new AbortController();

    const items = await scanConversations(
      deps.net,
      deps.S,
      ac.signal,
      null,
      null,
      deps.addLog,
      deps.setStatus,
    );

    expect(items).toHaveLength(2);
    expect(deps.net.fetchJson).toHaveBeenCalledTimes(1);
  });
});
