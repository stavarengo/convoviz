// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

import type {
  ConversationRecord,
  ProjectRecord,
  ScannerState,
} from "../../src/state/discovery-store";

describe("DiscoveryStore", () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clear IDB data between tests (fake-indexeddb shares state globally)
    const mod = await import("../../src/state/discovery-store");
    const store = mod.createDiscoveryStore();
    await store.init();
    await store.clear();
    vi.resetModules();
  });

  async function createStore() {
    const mod = await import("../../src/state/discovery-store");
    const store = mod.createDiscoveryStore();
    await store.init();
    return store;
  }

  // --- Conversations ---

  describe("conversations", () => {
    it("putConversation + getConversation round-trips a record", async () => {
      const store = await createStore();
      const record: ConversationRecord = {
        id: "conv-1",
        title: "My Chat",
        updateTime: 1700000000,
        gizmoId: null,
        status: "new",
        exportedAt: null,
      };
      await store.putConversation(record);
      const loaded = await store.getConversation("conv-1");
      expect(loaded).toEqual(record);
    });

    it("getConversation returns null for non-existent id", async () => {
      const store = await createStore();
      const result = await store.getConversation("non-existent");
      expect(result).toBeNull();
    });

    it("putConversation overwrites existing record", async () => {
      const store = await createStore();
      await store.putConversation({
        id: "conv-1",
        title: "Original",
        updateTime: 1700000000,
        gizmoId: null,
        status: "new",
        exportedAt: null,
      });
      await store.putConversation({
        id: "conv-1",
        title: "Updated",
        updateTime: 1700000001,
        gizmoId: "g1",
        status: "needs-update",
        exportedAt: null,
      });
      const loaded = await store.getConversation("conv-1");
      expect(loaded!.title).toBe("Updated");
      expect(loaded!.updateTime).toBe(1700000001);
      expect(loaded!.gizmoId).toBe("g1");
      expect(loaded!.status).toBe("needs-update");
    });

    it("getAllConversations returns all stored records", async () => {
      const store = await createStore();
      await store.putConversation({
        id: "a",
        title: "A",
        updateTime: 1,
        gizmoId: null,
        status: "new",
        exportedAt: null,
      });
      await store.putConversation({
        id: "b",
        title: "B",
        updateTime: 2,
        gizmoId: null,
        status: "exported",
        exportedAt: 100,
      });
      const all = await store.getAllConversations();
      expect(all).toHaveLength(2);
      const ids = all.map((r) => r.id).sort();
      expect(ids).toEqual(["a", "b"]);
    });

    it("getAllConversations returns empty array when store is empty", async () => {
      const store = await createStore();
      const all = await store.getAllConversations();
      expect(all).toEqual([]);
    });
  });

  // --- Projects ---

  describe("projects", () => {
    it("putProject + getProject round-trips a record", async () => {
      const store = await createStore();
      const record: ProjectRecord = {
        gizmoId: "gizmo-1",
        name: "My Project",
        emoji: "🤖",
        theme: "dark",
        instructions: "Be helpful",
        files: [
          { fileId: "f1", name: "readme.txt", type: "text/plain", size: 100 },
        ],
        discoveredAt: 1700000000,
      };
      await store.putProject(record);
      const loaded = await store.getProject("gizmo-1");
      expect(loaded).toEqual(record);
    });

    it("getProject returns null for non-existent gizmoId", async () => {
      const store = await createStore();
      const result = await store.getProject("non-existent");
      expect(result).toBeNull();
    });

    it("putProject overwrites existing record", async () => {
      const store = await createStore();
      await store.putProject({
        gizmoId: "g1",
        name: "Original",
        emoji: "",
        theme: "",
        instructions: "",
        files: [],
        discoveredAt: 1,
      });
      await store.putProject({
        gizmoId: "g1",
        name: "Updated",
        emoji: "🚀",
        theme: "light",
        instructions: "New instructions",
        files: [{ fileId: "f2", name: "doc.pdf", type: "application/pdf", size: 500 }],
        discoveredAt: 2,
      });
      const loaded = await store.getProject("g1");
      expect(loaded!.name).toBe("Updated");
      expect(loaded!.files).toHaveLength(1);
    });

    it("getAllProjects returns all stored records", async () => {
      const store = await createStore();
      await store.putProject({
        gizmoId: "g1",
        name: "P1",
        emoji: "",
        theme: "",
        instructions: "",
        files: [],
        discoveredAt: 1,
      });
      await store.putProject({
        gizmoId: "g2",
        name: "P2",
        emoji: "",
        theme: "",
        instructions: "",
        files: [],
        discoveredAt: 2,
      });
      const all = await store.getAllProjects();
      expect(all).toHaveLength(2);
      const ids = all.map((r) => r.gizmoId).sort();
      expect(ids).toEqual(["g1", "g2"]);
    });

    it("getAllProjects returns empty array when store is empty", async () => {
      const store = await createStore();
      const all = await store.getAllProjects();
      expect(all).toEqual([]);
    });
  });

  // --- Scanners ---

  describe("scanners", () => {
    it("putScannerState + getScannerState round-trips a record", async () => {
      const store = await createStore();
      const state: ScannerState = {
        scannerId: "scan-main",
        offset: 50,
        limit: 25,
        total: 200,
        lastRunAt: 1700000000,
        status: "active",
      };
      await store.putScannerState(state);
      const loaded = await store.getScannerState("scan-main");
      expect(loaded).toEqual(state);
    });

    it("getScannerState returns null for non-existent scannerId", async () => {
      const store = await createStore();
      const result = await store.getScannerState("non-existent");
      expect(result).toBeNull();
    });

    it("putScannerState overwrites existing state", async () => {
      const store = await createStore();
      await store.putScannerState({
        scannerId: "s1",
        offset: 0,
        limit: 25,
        total: null,
        lastRunAt: 1,
        status: "active",
      });
      await store.putScannerState({
        scannerId: "s1",
        offset: 75,
        limit: 25,
        total: 300,
        lastRunAt: 2,
        status: "active",
      });
      const loaded = await store.getScannerState("s1");
      expect(loaded!.offset).toBe(75);
      expect(loaded!.total).toBe(300);
    });

    it("deleteScannerState removes the state", async () => {
      const store = await createStore();
      await store.putScannerState({
        scannerId: "s1",
        offset: 50,
        limit: 25,
        total: 100,
        lastRunAt: 1,
        status: "complete",
      });
      await store.deleteScannerState("s1");
      const loaded = await store.getScannerState("s1");
      expect(loaded).toBeNull();
    });

    it("deleteScannerState is a no-op for non-existent scannerId", async () => {
      const store = await createStore();
      // Should not throw
      await store.deleteScannerState("non-existent");
    });
  });

  // --- Clear ---

  describe("clear", () => {
    it("clears all stores", async () => {
      const store = await createStore();

      await store.putConversation({
        id: "c1",
        title: "C1",
        updateTime: 1,
        gizmoId: null,
        status: "new",
        exportedAt: null,
      });
      await store.putProject({
        gizmoId: "g1",
        name: "P1",
        emoji: "",
        theme: "",
        instructions: "",
        files: [],
        discoveredAt: 1,
      });
      await store.putScannerState({
        scannerId: "s1",
        offset: 0,
        limit: 25,
        total: null,
        lastRunAt: 1,
        status: "active",
      });

      await store.clear();

      expect(await store.getAllConversations()).toEqual([]);
      expect(await store.getAllProjects()).toEqual([]);
      expect(await store.getScannerState("s1")).toBeNull();
    });
  });

  // --- Seeding from ExportState ---

  describe("seedFromExportState", () => {
    it("seeds conversations from ExportState.progress.exported", async () => {
      const store = await createStore();

      const exported: Record<string, number> = {
        "conv-1": 1700000000,
        "conv-2": 1700000100,
      };

      await store.seedFromExportState(exported);

      const c1 = await store.getConversation("conv-1");
      expect(c1).not.toBeNull();
      expect(c1!.id).toBe("conv-1");
      expect(c1!.status).toBe("exported");
      expect(c1!.exportedAt).toBe(1700000000);
      expect(c1!.title).toBe("");
      expect(c1!.updateTime).toBe(0);
      expect(c1!.gizmoId).toBeNull();

      const c2 = await store.getConversation("conv-2");
      expect(c2).not.toBeNull();
      expect(c2!.status).toBe("exported");
      expect(c2!.exportedAt).toBe(1700000100);
    });

    it("does not overwrite existing conversation records when seeding", async () => {
      const store = await createStore();

      await store.putConversation({
        id: "conv-1",
        title: "Already Here",
        updateTime: 999,
        gizmoId: "g1",
        status: "needs-update",
        exportedAt: null,
      });

      await store.seedFromExportState({ "conv-1": 1700000000 });

      const c1 = await store.getConversation("conv-1");
      expect(c1!.title).toBe("Already Here");
      expect(c1!.status).toBe("needs-update");
    });

    it("seeds empty exported map without error", async () => {
      const store = await createStore();
      await store.seedFromExportState({});
      const all = await store.getAllConversations();
      expect(all).toEqual([]);
    });
  });
});
