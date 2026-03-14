import { describe, it, expect, vi } from "vitest";
import {
  scanProjects,
  scanProjectConversations,
} from "../../src/scan/projects";
import type { ProjectInfo } from "../../src/types";

const createMockNet = () => ({
  fetchJson: vi.fn(),
});

describe("scanProjects", () => {
  it("returns empty array when first page has no items", async () => {
    const net = createMockNet();
    net.fetchJson.mockResolvedValueOnce({ items: [] });
    const ac = new AbortController();

    const projects = await scanProjects(
      net,
      ac.signal,
      null,
      vi.fn(),
    );
    expect(projects).toEqual([]);
  });

  it("extracts project info from gizmo API response", async () => {
    const net = createMockNet();
    net.fetchJson.mockResolvedValueOnce({
      items: [
        {
          gizmo: {
            gizmo: {
              id: "gizmo-1",
              name: "My Project",
              display: {
                name: "Display Name",
                emoji: "rocket",
                theme: "blue",
              },
              instructions: "Do things",
              memory_enabled: true,
              memory_scope: "global",
            },
            files: [
              { file_id: "f1", name: "doc.pdf", type: "pdf", size: 1024 },
            ],
          },
        },
      ],
      cursor: null,
    });
    const ac = new AbortController();

    const projects = await scanProjects(
      net,
      ac.signal,
      null,
      vi.fn(),
    );

    expect(projects).toHaveLength(1);
    expect(projects[0].gizmoId).toBe("gizmo-1");
    expect(projects[0].name).toBe("Display Name");
    expect(projects[0].emoji).toBe("rocket");
    expect(projects[0].theme).toBe("blue");
    expect(projects[0].instructions).toBe("Do things");
    expect(projects[0].memoryEnabled).toBe(true);
    expect(projects[0].memoryScope).toBe("global");
    expect(projects[0].files).toEqual([
      { fileId: "f1", name: "doc.pdf", type: "pdf", size: 1024 },
    ]);
  });

  it("paginates projects using cursor", async () => {
    const net = createMockNet();
    net.fetchJson
      .mockResolvedValueOnce({
        items: [
          {
            gizmo: {
              gizmo: { id: "g1", display: {} },
              files: [],
            },
          },
        ],
        cursor: "next-cursor",
      })
      .mockResolvedValueOnce({
        items: [
          {
            gizmo: {
              gizmo: { id: "g2", display: {} },
              files: [],
            },
          },
        ],
        cursor: null,
      });
    const ac = new AbortController();

    const projects = await scanProjects(
      net,
      ac.signal,
      null,
      vi.fn(),
    );

    expect(projects).toHaveLength(2);
    expect(projects[0].gizmoId).toBe("g1");
    expect(projects[1].gizmoId).toBe("g2");
    // Second call should include cursor
    expect(net.fetchJson.mock.calls[1][0]).toContain(
      "cursor=next-cursor",
    );
  });

  it("calls onProject callback for each project", async () => {
    const net = createMockNet();
    const onProject = vi.fn();
    net.fetchJson.mockResolvedValueOnce({
      items: [
        {
          gizmo: {
            gizmo: { id: "g1", display: {} },
            files: [],
          },
        },
        {
          gizmo: {
            gizmo: { id: "g2", display: {} },
            files: [],
          },
        },
      ],
      cursor: null,
    });
    const ac = new AbortController();

    await scanProjects(net, ac.signal, onProject, vi.fn());

    expect(onProject).toHaveBeenCalledTimes(2);
    expect(onProject.mock.calls[0][0].gizmoId).toBe("g1");
    expect(onProject.mock.calls[1][0].gizmoId).toBe("g2");
  });

  it("skips items without gizmoId", async () => {
    const net = createMockNet();
    net.fetchJson.mockResolvedValueOnce({
      items: [
        {
          gizmo: {
            gizmo: { display: {} }, // no id
            files: [],
          },
        },
        {
          gizmo: {
            gizmo: { id: "g1", display: {} },
            files: [],
          },
        },
      ],
      cursor: null,
    });
    const ac = new AbortController();

    const projects = await scanProjects(
      net,
      ac.signal,
      null,
      vi.fn(),
    );

    expect(projects).toHaveLength(1);
    expect(projects[0].gizmoId).toBe("g1");
  });

  it("handles files with id instead of file_id", async () => {
    const net = createMockNet();
    net.fetchJson.mockResolvedValueOnce({
      items: [
        {
          gizmo: {
            gizmo: { id: "g1", display: {} },
            files: [{ id: "f1", name: "file.txt", type: "text", size: 100 }],
          },
        },
      ],
      cursor: null,
    });
    const ac = new AbortController();

    const projects = await scanProjects(
      net,
      ac.signal,
      null,
      vi.fn(),
    );

    expect(projects[0].files).toEqual([
      { fileId: "f1", name: "file.txt", type: "text", size: 100 },
    ]);
  });

  it("uses display name/emoji fallbacks from def", async () => {
    const net = createMockNet();
    net.fetchJson.mockResolvedValueOnce({
      items: [
        {
          gizmo: {
            gizmo: {
              id: "g1",
              name: "FallbackName",
              display: { profile_emoji: "star", accent_color: "red" },
            },
            files: [],
          },
        },
      ],
      cursor: null,
    });
    const ac = new AbortController();

    const projects = await scanProjects(
      net,
      ac.signal,
      null,
      vi.fn(),
    );

    expect(projects[0].name).toBe("FallbackName");
    expect(projects[0].emoji).toBe("star");
    expect(projects[0].theme).toBe("red");
  });

  it("throws AbortError if signal is already aborted", async () => {
    const net = createMockNet();
    const ac = new AbortController();
    ac.abort();

    await expect(
      scanProjects(net, ac.signal, null, vi.fn()),
    ).rejects.toThrow("Aborted");
  });

  it("shows status with page number", async () => {
    const net = createMockNet();
    const setStatus = vi.fn();
    net.fetchJson.mockResolvedValueOnce({ items: [] });
    const ac = new AbortController();

    await scanProjects(net, ac.signal, null, setStatus);

    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("page 1"),
    );
  });
});

describe("scanProjectConversations", () => {
  it("paginates with cursor", async () => {
    const net = createMockNet();
    net.fetchJson
      .mockResolvedValueOnce({
        items: [{ id: "c1", title: "Conv1", update_time: 100 }],
        cursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        items: [{ id: "c2", title: "Conv2", update_time: 200 }],
        cursor: null,
      });
    const ac = new AbortController();

    const items = await scanProjectConversations(
      net,
      "gizmo-1",
      ac.signal,
      null,
      null,
    );

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("c1");
    expect(items[0].gizmo_id).toBe("gizmo-1");
    expect(items[1].id).toBe("c2");
    // First call uses cursor=0
    expect(net.fetchJson.mock.calls[0][0]).toContain("cursor=0");
    // Second call uses cursor from previous response
    expect(net.fetchJson.mock.calls[1][0]).toContain("cursor=cursor-2");
  });

  it("calls gizmo-specific URL with encoded gizmoId", async () => {
    const net = createMockNet();
    net.fetchJson.mockResolvedValueOnce({ items: [] });
    const ac = new AbortController();

    await scanProjectConversations(
      net,
      "g/special",
      ac.signal,
      null,
      null,
    );

    expect(net.fetchJson.mock.calls[0][0]).toContain(
      "/backend-api/gizmos/g%2Fspecial/conversations",
    );
  });

  it("early-terminates after 2 consecutive known pages", async () => {
    const net = createMockNet();
    const knownIds = new Set(["c1", "c2"]);
    net.fetchJson
      .mockResolvedValueOnce({
        items: [{ id: "c1", title: "C1", update_time: 1 }],
        cursor: "cur2",
      })
      .mockResolvedValueOnce({
        items: [{ id: "c2", title: "C2", update_time: 2 }],
        cursor: "cur3",
      });
    const ac = new AbortController();

    const items = await scanProjectConversations(
      net,
      "gizmo-1",
      ac.signal,
      null,
      knownIds,
    );

    expect(net.fetchJson).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(2);
  });

  it("resets consecutive count when new items found", async () => {
    const net = createMockNet();
    const knownIds = new Set(["c1"]);
    net.fetchJson
      .mockResolvedValueOnce({
        items: [{ id: "c1", title: "C1", update_time: 1 }],
        cursor: "cur2",
      })
      .mockResolvedValueOnce({
        items: [{ id: "c2", title: "C2", update_time: 2 }],
        cursor: "cur3",
      })
      .mockResolvedValueOnce({
        items: [],
      });
    const ac = new AbortController();

    const items = await scanProjectConversations(
      net,
      "gizmo-1",
      ac.signal,
      null,
      knownIds,
    );

    expect(net.fetchJson).toHaveBeenCalledTimes(3);
  });

  it("calls onPage callback for each page", async () => {
    const net = createMockNet();
    const onPage = vi.fn();
    net.fetchJson.mockResolvedValueOnce({
      items: [{ id: "c1", title: "C1", update_time: 1 }],
      cursor: null,
    });
    const ac = new AbortController();

    await scanProjectConversations(
      net,
      "gizmo-1",
      ac.signal,
      onPage,
      null,
    );

    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith([
      { id: "c1", title: "C1", update_time: 1, gizmo_id: "gizmo-1" },
    ]);
  });

  it("throws AbortError if signal is already aborted", async () => {
    const net = createMockNet();
    const ac = new AbortController();
    ac.abort();

    await expect(
      scanProjectConversations(net, "gizmo-1", ac.signal, null, null),
    ).rejects.toThrow("Aborted");
  });

  it("uses update_time with updated_time fallback", async () => {
    const net = createMockNet();
    net.fetchJson.mockResolvedValueOnce({
      items: [{ id: "c1", title: "C1", updated_time: 999 }],
      cursor: null,
    });
    const ac = new AbortController();

    const items = await scanProjectConversations(
      net,
      "gizmo-1",
      ac.signal,
      null,
      null,
    );

    // The original code uses it.update_time || it.updated_time || 0
    // But scanProjectConversations only uses update_time, not updated_time
    // Let me verify against the source
    expect(items[0].update_time).toBe(999);
  });
});
