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

describe("ConversationScanner", () => {
  let discoveryStore: DiscoveryStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../src/state/discovery-store");
    discoveryStore = mod.createDiscoveryStore();
    await discoveryStore.init();
    await discoveryStore.clear();
  });

  async function importScanner() {
    return import("../../src/scan/scanner");
  }

  function makePage(
    items: Array<{
      id: string;
      title?: string;
      update_time?: number;
      gizmo_id?: string | null;
    }>,
    total: number,
  ) {
    return {
      items: items.map((it) => ({
        id: it.id,
        title: it.title ?? `Chat ${it.id}`,
        update_time: it.update_time ?? 1700000000,
        gizmo_id: it.gizmo_id ?? null,
      })),
      total,
    };
  }

  describe("full pagination flow", () => {
    it("paginates through multiple pages and emits events for new conversations", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      // Page 1: 2 items, page 2: 1 item (total 3)
      net.fetchJson
        .mockResolvedValueOnce(
          makePage(
            [
              { id: "c1", title: "Chat 1", update_time: 100 },
              { id: "c2", title: "Chat 2", update_time: 200 },
            ],
            3,
          ),
        )
        .mockResolvedValueOnce(
          makePage([{ id: "c3", title: "Chat 3", update_time: 300 }], 3),
        );

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "test-scan",
        gizmoId: null,
        limit: 2,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      // Should have called fetchJson twice (two pages)
      expect(net.fetchJson).toHaveBeenCalledTimes(2);

      // All three conversations should be emitted as needs-export
      const exportEvents = bus.emitted.filter(
        (e) => e.event === "conversation-needs-export",
      );
      expect(exportEvents).toHaveLength(3);
      expect(exportEvents.map((e) => (e.payload as { id: string }).id)).toEqual(
        ["c1", "c2", "c3"],
      );

      // All three should be persisted in discovery store
      const c1 = await discoveryStore.getConversation("c1");
      expect(c1).not.toBeNull();
      expect(c1!.status).toBe("new");
      expect(c1!.title).toBe("Chat 1");
      expect(c1!.updateTime).toBe(100);

      // Scanner progress events
      const progressEvents = bus.emitted.filter(
        (e) => e.event === "scanner-progress",
      );
      expect(progressEvents).toHaveLength(2);

      // Scanner complete event
      const completeEvents = bus.emitted.filter(
        (e) => e.event === "scanner-complete",
      );
      expect(completeEvents).toHaveLength(1);
      expect(
        (completeEvents[0].payload as { scannerId: string; itemCount: number })
          .itemCount,
      ).toBe(3);

      // Scanner state should be deleted on completion
      const scannerState = await discoveryStore.getScannerState("test-scan");
      expect(scannerState).toBeNull();
    });

    it("stops when API returns empty page", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      net.fetchJson.mockResolvedValueOnce(
        makePage([{ id: "c1", update_time: 100 }], 1),
      );

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "test-scan",
        gizmoId: null,
        limit: 100,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      expect(net.fetchJson).toHaveBeenCalledTimes(1);
      const completeEvents = bus.emitted.filter(
        (e) => e.event === "scanner-complete",
      );
      expect(completeEvents).toHaveLength(1);
    });
  });

  describe("resume from saved state", () => {
    it("resumes from interrupted scanner state", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      // Pre-seed scanner state: offset=2, meaning page 1 was already processed
      await discoveryStore.putScannerState({
        scannerId: "resume-scan",
        offset: 2,
        limit: 2,
        total: 4,
        lastRunAt: Date.now(),
        status: "interrupted",
      });

      // Pre-seed conversations from the first page (already processed)
      await discoveryStore.putConversation({
        id: "c1",
        title: "Chat 1",
        updateTime: 100,
        gizmoId: null,
        status: "new",
        exportedAt: null,
      });
      await discoveryStore.putConversation({
        id: "c2",
        title: "Chat 2",
        updateTime: 200,
        gizmoId: null,
        status: "new",
        exportedAt: null,
      });

      // API returns page at offset=2 (the remaining items)
      net.fetchJson.mockResolvedValueOnce(
        makePage(
          [
            { id: "c3", title: "Chat 3", update_time: 300 },
            { id: "c4", title: "Chat 4", update_time: 400 },
          ],
          4,
        ),
      );

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "resume-scan",
        gizmoId: null,
        limit: 2,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      // Should start from offset=2
      expect(net.fetchJson).toHaveBeenCalledTimes(1);
      const url = net.fetchJson.mock.calls[0][0] as string;
      expect(url).toContain("offset=2");

      // Only new items should be emitted
      const exportEvents = bus.emitted.filter(
        (e) => e.event === "conversation-needs-export",
      );
      expect(exportEvents).toHaveLength(2);
    });
  });

  describe("dedup (existing record emits correct event type)", () => {
    it("emits conversation-needs-update for changed updateTime", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      // Pre-seed an existing conversation with different updateTime
      await discoveryStore.putConversation({
        id: "c1",
        title: "Old Title",
        updateTime: 100,
        gizmoId: null,
        status: "exported",
        exportedAt: 50,
      });

      net.fetchJson.mockResolvedValueOnce(
        makePage([{ id: "c1", title: "Updated Title", update_time: 200 }], 1),
      );

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "dedup-scan",
        gizmoId: null,
        limit: 100,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      const updateEvents = bus.emitted.filter(
        (e) => e.event === "conversation-needs-update",
      );
      expect(updateEvents).toHaveLength(1);
      expect((updateEvents[0].payload as { id: string }).id).toBe("c1");

      // Discovery store should be updated
      const c1 = await discoveryStore.getConversation("c1");
      expect(c1!.status).toBe("needs-update");
      expect(c1!.updateTime).toBe(200);
    });

    it("emits conversation-up-to-date for unchanged updateTime", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      await discoveryStore.putConversation({
        id: "c1",
        title: "Chat 1",
        updateTime: 100,
        gizmoId: null,
        status: "exported",
        exportedAt: 50,
      });

      net.fetchJson.mockResolvedValueOnce(
        makePage([{ id: "c1", title: "Chat 1", update_time: 100 }], 1),
      );

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "dedup-scan-2",
        gizmoId: null,
        limit: 100,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      const upToDateEvents = bus.emitted.filter(
        (e) => e.event === "conversation-up-to-date",
      );
      expect(upToDateEvents).toHaveLength(1);

      // No needs-export or needs-update events
      const exportEvents = bus.emitted.filter(
        (e) => e.event === "conversation-needs-export",
      );
      const updateEvents = bus.emitted.filter(
        (e) => e.event === "conversation-needs-update",
      );
      expect(exportEvents).toHaveLength(0);
      expect(updateEvents).toHaveLength(0);
    });

    it("handles mixed dedup: new, updated, and up-to-date in same page", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      await discoveryStore.putConversation({
        id: "existing-unchanged",
        title: "No Change",
        updateTime: 100,
        gizmoId: null,
        status: "exported",
        exportedAt: 50,
      });
      await discoveryStore.putConversation({
        id: "existing-changed",
        title: "Will Change",
        updateTime: 100,
        gizmoId: null,
        status: "exported",
        exportedAt: 50,
      });

      net.fetchJson.mockResolvedValueOnce(
        makePage(
          [
            { id: "brand-new", title: "New Chat", update_time: 300 },
            {
              id: "existing-changed",
              title: "Changed Chat",
              update_time: 200,
            },
            {
              id: "existing-unchanged",
              title: "No Change",
              update_time: 100,
            },
          ],
          3,
        ),
      );

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "mixed-scan",
        gizmoId: null,
        limit: 100,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      const needsExport = bus.emitted.filter(
        (e) => e.event === "conversation-needs-export",
      );
      const needsUpdate = bus.emitted.filter(
        (e) => e.event === "conversation-needs-update",
      );
      const upToDate = bus.emitted.filter(
        (e) => e.event === "conversation-up-to-date",
      );

      expect(needsExport).toHaveLength(1);
      expect((needsExport[0].payload as { id: string }).id).toBe("brand-new");
      expect(needsUpdate).toHaveLength(1);
      expect((needsUpdate[0].payload as { id: string }).id).toBe(
        "existing-changed",
      );
      expect(upToDate).toHaveLength(1);
      expect((upToDate[0].payload as { id: string }).id).toBe(
        "existing-unchanged",
      );
    });
  });

  describe("abort preserves state for resumption", () => {
    it("saves scanner state with interrupted status on abort", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      const ac = new AbortController();

      // First page succeeds, then abort before second page
      net.fetchJson.mockResolvedValueOnce(
        makePage(
          [
            { id: "c1", update_time: 100 },
            { id: "c2", update_time: 200 },
          ],
          4,
        ),
      );
      net.fetchJson.mockImplementationOnce(async () => {
        // Simulate abort during the second fetch
        ac.abort();
        throw new DOMException("Aborted", "AbortError");
      });

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "abort-scan",
        gizmoId: null,
        limit: 2,
      });

      await scanner.start(ac.signal);

      // Scanner state should remain in IDB with interrupted status
      const state = await discoveryStore.getScannerState("abort-scan");
      expect(state).not.toBeNull();
      expect(state!.status).toBe("interrupted");
      expect(state!.offset).toBe(2); // processed first page

      // No scanner-complete event should be emitted
      const completeEvents = bus.emitted.filter(
        (e) => e.event === "scanner-complete",
      );
      expect(completeEvents).toHaveLength(0);
    });
  });

  describe("project-specific parameterization", () => {
    it("includes gizmo_id in API URL when gizmoId is provided", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      net.fetchJson.mockResolvedValueOnce(
        makePage([{ id: "c1", update_time: 100, gizmo_id: "gizmo-abc" }], 1),
      );

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "project-scan",
        gizmoId: "gizmo-abc",
        limit: 100,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      const url = net.fetchJson.mock.calls[0][0] as string;
      expect(url).toContain("gizmo_id=gizmo-abc");
    });

    it("does NOT include gizmo_id in API URL when gizmoId is null", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      net.fetchJson.mockResolvedValueOnce(
        makePage([{ id: "c1", update_time: 100 }], 1),
      );

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "general-scan",
        gizmoId: null,
        limit: 100,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      const url = net.fetchJson.mock.calls[0][0] as string;
      expect(url).not.toContain("gizmo_id");
    });
  });

  describe("scanner state persistence after each page", () => {
    it("persists scanner state after each page is processed", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      const stateSnapshots: Array<{
        offset: number;
        status: string;
      } | null> = [];

      // Intercept putScannerState to capture intermediate states
      const origPut = discoveryStore.putScannerState.bind(discoveryStore);
      discoveryStore.putScannerState = async (state) => {
        await origPut(state);
        stateSnapshots.push({ offset: state.offset, status: state.status });
      };

      net.fetchJson
        .mockResolvedValueOnce(
          makePage(
            [
              { id: "c1", update_time: 100 },
              { id: "c2", update_time: 200 },
            ],
            4,
          ),
        )
        .mockResolvedValueOnce(
          makePage(
            [
              { id: "c3", update_time: 300 },
              { id: "c4", update_time: 400 },
            ],
            4,
          ),
        );

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "persist-scan",
        gizmoId: null,
        limit: 2,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      // Should have saved state after each page
      expect(stateSnapshots).toHaveLength(2);
      expect(stateSnapshots[0]).toEqual({ offset: 2, status: "active" });
      expect(stateSnapshots[1]).toEqual({ offset: 4, status: "active" });
    });
  });

  describe("conversation record persistence before events", () => {
    it("persists conversation to IDB before emitting event", async () => {
      const { createConversationScanner } = await importScanner();
      const net = createMockNet();
      const bus = createMockEventBus();

      // Track the order of operations
      const operations: string[] = [];

      const origPut = discoveryStore.putConversation.bind(discoveryStore);
      discoveryStore.putConversation = async (record) => {
        operations.push(`put:${record.id}`);
        await origPut(record);
      };

      const origEmit = bus.emit.bind(bus);
      bus.emit = ((event: keyof EventMap, payload: EventMap[keyof EventMap]) => {
        if (
          event === "conversation-needs-export" ||
          event === "conversation-needs-update" ||
          event === "conversation-up-to-date"
        ) {
          operations.push(`emit:${event}:${(payload as { id: string }).id}`);
        }
        return origEmit(event, payload);
      }) as typeof bus.emit;

      net.fetchJson.mockResolvedValueOnce(
        makePage([{ id: "c1", update_time: 100 }], 1),
      );

      const scanner = createConversationScanner({
        net,
        discoveryStore,
        eventBus: bus,
        scannerId: "order-scan",
        gizmoId: null,
        limit: 100,
      });

      const ac = new AbortController();
      await scanner.start(ac.signal);

      // Put must come before emit for crash resilience
      const putIdx = operations.indexOf("put:c1");
      const emitIdx = operations.indexOf(
        "emit:conversation-needs-export:c1",
      );
      expect(putIdx).toBeLessThan(emitIdx);
    });
  });
});
