// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import type { DiscoveryStore } from "../../src/state/discovery-store";
import type { EventBus } from "../../src/events/bus";
import type { EventMap } from "../../src/events/types";

interface MockNet {
  fetchJson: ReturnType<typeof vi.fn>;
  getToken: ReturnType<typeof vi.fn>;
}

function createMockNet(): MockNet {
  return {
    fetchJson: vi.fn(),
    getToken: vi.fn().mockResolvedValue("mock-token"),
  };
}

function createMockEventBus(): EventBus & {
  emitted: Array<{ event: keyof EventMap; payload: unknown }>;
} {
  const emitted: Array<{ event: keyof EventMap; payload: unknown }> = [];
  const listeners = new Map<keyof EventMap, Array<(payload: never) => void>>();

  return {
    emitted,
    on<K extends keyof EventMap>(
      event: K,
      listener: (payload: EventMap[K]) => void,
    ): () => void {
      let arr = listeners.get(event);
      if (!arr) {
        arr = [];
        listeners.set(event, arr);
      }
      arr.push(listener as (payload: never) => void);
      return () => {
        const a = listeners.get(event);
        if (a) {
          const idx = a.indexOf(listener as (payload: never) => void);
          if (idx !== -1) a.splice(idx, 1);
        }
      };
    },
    emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
      emitted.push({ event, payload });
      const arr = listeners.get(event);
      if (arr) {
        for (const fn of [...arr]) {
          (fn as (p: EventMap[K]) => void)(payload);
        }
      }
    },
    off<K extends keyof EventMap>(
      event: K,
      listener: (payload: EventMap[K]) => void,
    ): void {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(listener as (payload: never) => void);
        if (idx !== -1) arr.splice(idx, 1);
      }
    },
    clear(): void {
      listeners.clear();
    },
  };
}

/** Build a gizmo sidebar API response page */
function makeGizmoPage(
  items: Array<{
    gizmoId: string;
    name: string;
    emoji?: string;
    theme?: string;
    instructions?: string;
    files?: Array<{
      file_id: string;
      name: string;
      type: string;
      size: number;
    }>;
  }>,
  cursor: string | null = null,
) {
  return {
    items: items.map((it) => ({
      gizmo: {
        gizmo: {
          id: it.gizmoId,
          name: it.name,
          instructions: it.instructions ?? "",
          display: {
            name: it.name,
            emoji: it.emoji ?? "",
            theme: it.theme ?? "",
          },
        },
        files: (it.files ?? []).map((f) => ({
          file_id: f.file_id,
          name: f.name,
          type: f.type,
          size: f.size,
        })),
      },
    })),
    cursor,
  };
}

describe("ProjectScanner", () => {
  let discoveryStore: DiscoveryStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../src/state/discovery-store");
    discoveryStore = mod.createDiscoveryStore();
    await discoveryStore.init();
    await discoveryStore.clear();
  });

  async function importProjectScanner() {
    return import("../../src/scan/project-scanner");
  }

  describe("project discovery flow", () => {
    it("paginates the sidebar API and emits project-discovered for each project", async () => {
      const { createProjectScanner } = await importProjectScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      // Page 1 with cursor, page 2 without cursor (end)
      net.fetchJson
        .mockResolvedValueOnce(
          makeGizmoPage(
            [
              {
                gizmoId: "g1",
                name: "Project Alpha",
                emoji: "A",
                theme: "blue",
                instructions: "Do stuff",
                files: [
                  { file_id: "f1", name: "readme.md", type: "text", size: 100 },
                ],
              },
              {
                gizmoId: "g2",
                name: "Project Beta",
                files: [],
              },
            ],
            "next-cursor",
          ),
        )
        .mockResolvedValueOnce(
          makeGizmoPage(
            [
              {
                gizmoId: "g3",
                name: "Project Gamma",
                files: [
                  { file_id: "f2", name: "data.csv", type: "csv", size: 500 },
                  { file_id: "f3", name: "config.json", type: "json", size: 50 },
                ],
              },
            ],
            null,
          ),
        );

      const scanner = createProjectScanner({
        net,
        discoveryStore,
        eventBus: bus,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      // Should have called fetchJson twice (two pages)
      expect(net.fetchJson).toHaveBeenCalledTimes(2);

      // First URL should be the sidebar API without cursor
      const url1 = net.fetchJson.mock.calls[0][0] as string;
      expect(url1).toContain("/backend-api/gizmos/snorlax/sidebar");
      expect(url1).not.toContain("cursor");

      // Second URL should include cursor
      const url2 = net.fetchJson.mock.calls[1][0] as string;
      expect(url2).toContain("cursor=next-cursor");

      // Three project-discovered events
      const projectEvents = bus.emitted.filter(
        (e) => e.event === "project-discovered",
      );
      expect(projectEvents).toHaveLength(3);

      const payloads = projectEvents.map(
        (e) => e.payload as EventMap["project-discovered"],
      );
      expect(payloads[0].gizmoId).toBe("g1");
      expect(payloads[0].name).toBe("Project Alpha");
      expect(payloads[0].files).toHaveLength(1);
      expect(payloads[0].files[0].fileId).toBe("f1");

      expect(payloads[1].gizmoId).toBe("g2");
      expect(payloads[1].name).toBe("Project Beta");
      expect(payloads[1].files).toHaveLength(0);

      expect(payloads[2].gizmoId).toBe("g3");
      expect(payloads[2].files).toHaveLength(2);

      // scanner-complete event
      const completeEvents = bus.emitted.filter(
        (e) => e.event === "scanner-complete",
      );
      expect(completeEvents).toHaveLength(1);
      expect(
        (completeEvents[0].payload as { scannerId: string; itemCount: number })
          .itemCount,
      ).toBe(3);
    });

    it("persists each project to discovery store before emitting event", async () => {
      const { createProjectScanner } = await importProjectScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      const operations: string[] = [];

      const origPut = discoveryStore.putProject.bind(discoveryStore);
      discoveryStore.putProject = async (record) => {
        operations.push(`put:${record.gizmoId}`);
        await origPut(record);
      };

      const origEmit = bus.emit.bind(bus);
      bus.emit = ((event: keyof EventMap, payload: EventMap[keyof EventMap]) => {
        if (event === "project-discovered") {
          operations.push(
            `emit:project-discovered:${(payload as { gizmoId: string }).gizmoId}`,
          );
        }
        return origEmit(event, payload);
      }) as typeof bus.emit;

      net.fetchJson.mockResolvedValueOnce(
        makeGizmoPage(
          [{ gizmoId: "g1", name: "Proj", files: [] }],
          null,
        ),
      );

      const scanner = createProjectScanner({
        net,
        discoveryStore,
        eventBus: bus,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      const putIdx = operations.indexOf("put:g1");
      const emitIdx = operations.indexOf("emit:project-discovered:g1");
      expect(putIdx).toBeGreaterThanOrEqual(0);
      expect(emitIdx).toBeGreaterThanOrEqual(0);
      expect(putIdx).toBeLessThan(emitIdx);
    });

    it("skips gizmos without an id", async () => {
      const { createProjectScanner } = await importProjectScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      // A malformed gizmo with no id
      net.fetchJson.mockResolvedValueOnce({
        items: [
          {
            gizmo: {
              gizmo: { id: null, name: "Bad" },
              files: [],
            },
          },
          {
            gizmo: {
              gizmo: { id: "g1", name: "Good", display: { name: "Good" } },
              files: [],
            },
          },
        ],
        cursor: null,
      });

      const scanner = createProjectScanner({
        net,
        discoveryStore,
        eventBus: bus,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      const projectEvents = bus.emitted.filter(
        (e) => e.event === "project-discovered",
      );
      expect(projectEvents).toHaveLength(1);
      expect(
        (projectEvents[0].payload as { gizmoId: string }).gizmoId,
      ).toBe("g1");
    });
  });

  describe("abort", () => {
    it("stops scanning on abort without emitting scanner-complete", async () => {
      const { createProjectScanner } = await importProjectScanner();
      const net = createMockNet();
      const bus = createMockEventBus();
      const ac = new AbortController();

      // First page succeeds, second aborts
      net.fetchJson
        .mockResolvedValueOnce(
          makeGizmoPage(
            [{ gizmoId: "g1", name: "P1", files: [] }],
            "next",
          ),
        )
        .mockImplementationOnce(async () => {
          ac.abort();
          throw new DOMException("Aborted", "AbortError");
        });

      const scanner = createProjectScanner({
        net,
        discoveryStore,
        eventBus: bus,
      });

      await scanner.start(ac.signal);

      // First project still discovered
      const projectEvents = bus.emitted.filter(
        (e) => e.event === "project-discovered",
      );
      expect(projectEvents).toHaveLength(1);

      // No scanner-complete
      const completeEvents = bus.emitted.filter(
        (e) => e.event === "scanner-complete",
      );
      expect(completeEvents).toHaveLength(0);
    });
  });

  describe("project-discovered triggers conversation scanner creation", () => {
    it("listener can create and start a conversation scanner for the project gizmoId", async () => {
      const { createProjectScanner } = await importProjectScanner();
      const { createConversationScanner } = await import(
        "../../src/scan/scanner"
      );
      const net = createMockNet();
      const bus = createMockEventBus();

      const spawnedScanners: string[] = [];

      // Register a listener for project-discovered that spawns a conversation scanner
      bus.on("project-discovered", (payload) => {
        spawnedScanners.push(payload.gizmoId);
        // In real bootstrap, we'd call createConversationScanner and start it.
        // Here we just verify the event fires with the right payload.
      });

      net.fetchJson.mockResolvedValueOnce(
        makeGizmoPage(
          [
            { gizmoId: "g1", name: "P1", files: [] },
            { gizmoId: "g2", name: "P2", files: [] },
          ],
          null,
        ),
      );

      const scanner = createProjectScanner({
        net,
        discoveryStore,
        eventBus: bus,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      expect(spawnedScanners).toEqual(["g1", "g2"]);
    });
  });

  describe("knowledge file discovery with dedup", () => {
    it("emits knowledge-file-discovered for files not yet downloaded", async () => {
      const { discoverKnowledgeFiles } = await importProjectScanner();
      const bus = createMockEventBus();

      const blobStore = {
        hasFilePrefix: vi.fn().mockResolvedValue(false),
      };

      await discoverKnowledgeFiles({
        project: {
          gizmoId: "g1",
          name: "Project Alpha",
          files: [
            { fileId: "f1", name: "readme.md", type: "text", size: 100 },
            { fileId: "f2", name: "data.csv", type: "csv", size: 500 },
          ],
        },
        eventBus: bus,
        exportBlobStore: blobStore,
        deadFileIds: new Set<string>(),
      });

      const kfEvents = bus.emitted.filter(
        (e) => e.event === "knowledge-file-discovered",
      );
      expect(kfEvents).toHaveLength(2);

      const kfPayloads = kfEvents.map(
        (e) => e.payload as EventMap["knowledge-file-discovered"],
      );
      expect(kfPayloads[0]).toEqual({
        fileId: "f1",
        projectId: "g1",
        projectName: "Project Alpha",
        fileName: "readme.md",
        fileType: "text",
        fileSize: 100,
      });
      expect(kfPayloads[1].fileId).toBe("f2");
    });

    it("skips files that are already downloaded (blob store check)", async () => {
      const { discoverKnowledgeFiles } = await importProjectScanner();
      const bus = createMockEventBus();

      // f1 already exists in blob store, f2 does not
      const blobStore = {
        hasFilePrefix: vi.fn().mockImplementation(async (prefix: string) => {
          return prefix.includes("readme");
        }),
      };

      await discoverKnowledgeFiles({
        project: {
          gizmoId: "g1",
          name: "Project Alpha",
          files: [
            { fileId: "f1", name: "readme.md", type: "text", size: 100 },
            { fileId: "f2", name: "data.csv", type: "csv", size: 500 },
          ],
        },
        eventBus: bus,
        exportBlobStore: blobStore,
        deadFileIds: new Set<string>(),
      });

      const kfEvents = bus.emitted.filter(
        (e) => e.event === "knowledge-file-discovered",
      );
      // Only f2 should be emitted (f1 is already downloaded)
      expect(kfEvents).toHaveLength(1);
      expect(
        (kfEvents[0].payload as EventMap["knowledge-file-discovered"]).fileId,
      ).toBe("f2");
    });

    it("skips files that are dead-lettered", async () => {
      const { discoverKnowledgeFiles } = await importProjectScanner();
      const bus = createMockEventBus();

      const blobStore = {
        hasFilePrefix: vi.fn().mockResolvedValue(false),
      };

      await discoverKnowledgeFiles({
        project: {
          gizmoId: "g1",
          name: "Project Alpha",
          files: [
            { fileId: "f1", name: "readme.md", type: "text", size: 100 },
            { fileId: "f2", name: "data.csv", type: "csv", size: 500 },
          ],
        },
        eventBus: bus,
        exportBlobStore: blobStore,
        deadFileIds: new Set(["f1"]),
      });

      const kfEvents = bus.emitted.filter(
        (e) => e.event === "knowledge-file-discovered",
      );
      // Only f2 should be emitted (f1 is dead-lettered)
      expect(kfEvents).toHaveLength(1);
      expect(
        (kfEvents[0].payload as EventMap["knowledge-file-discovered"]).fileId,
      ).toBe("f2");
    });

    it("end-to-end: project-discovered listener triggers knowledge file discovery", async () => {
      const { createProjectScanner, discoverKnowledgeFiles } =
        await importProjectScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      const blobStore = {
        hasFilePrefix: vi.fn().mockResolvedValue(false),
      };

      // Collect promises from async listeners so we can await them
      const pending: Promise<void>[] = [];

      bus.on("project-discovered", (payload) => {
        const p = discoverKnowledgeFiles({
          project: payload,
          eventBus: bus,
          exportBlobStore: blobStore,
          deadFileIds: new Set<string>(),
        });
        pending.push(p);
      });

      net.fetchJson.mockResolvedValueOnce(
        makeGizmoPage(
          [
            {
              gizmoId: "g1",
              name: "Project Alpha",
              files: [
                { file_id: "f1", name: "readme.md", type: "text", size: 100 },
              ],
            },
          ],
          null,
        ),
      );

      const scanner = createProjectScanner({
        net,
        discoveryStore,
        eventBus: bus,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);
      await Promise.all(pending);

      const kfEvents = bus.emitted.filter(
        (e) => e.event === "knowledge-file-discovered",
      );
      expect(kfEvents).toHaveLength(1);
      expect(
        (kfEvents[0].payload as EventMap["knowledge-file-discovered"]).fileId,
      ).toBe("f1");
    });
  });
});
