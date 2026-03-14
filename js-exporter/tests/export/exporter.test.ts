// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExportState, PendingItem, KfPendingItem } from "../../src/types";
import { defaultState } from "../../src/state/defaults";

/* eslint-disable @typescript-eslint/no-explicit-any */

const makeBlob = (content: string, type = "application/octet-stream"): Blob => {
  const blob = new Blob([content], { type });
  // jsdom's Blob may not have arrayBuffer(); polyfill if needed
  if (typeof blob.arrayBuffer !== "function") {
    (blob as any).arrayBuffer = () =>
      new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(blob);
      });
  }
  return blob;
};

const makeDeps = () => {
  const S: ExportState = defaultState();
  const addLog = vi.fn();
  const saveDebounce = vi.fn();
  const net = {
    token: "tok",
    _tokenPromise: null,
    _consecutive429: 0,
    getToken: vi.fn().mockResolvedValue("tok"),
    _fetch: vi.fn(),
    fetchJson: vi.fn().mockResolvedValue({}),
    fetchBlob: vi.fn().mockResolvedValue(makeBlob("data")),
    download: vi.fn(),
  };
  const ui = {
    container: null,
    inject: vi.fn(),
    renderAll: vi.fn(),
    renderLogs: vi.fn(),
    renderProjects: vi.fn(),
    setStatus: vi.fn(),
    setBar: vi.fn(),
    ensureTick: vi.fn(),
  };
  const taskList = {
    add: vi.fn(),
    update: vi.fn(),
    getVisible: vi.fn().mockReturnValue([]),
    render: vi.fn(),
  };
  const exportBlobStore = {
    putConv: vi.fn().mockResolvedValue(undefined),
    putFile: vi.fn().mockResolvedValue(undefined),
    getAllConvKeys: vi.fn().mockResolvedValue([]),
    iterateConvs: vi.fn().mockResolvedValue(undefined),
    iterateFiles: vi.fn().mockResolvedValue(undefined),
    totalSize: vi.fn().mockResolvedValue(0),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  const scanConversations = vi
    .fn()
    .mockResolvedValue([]);
  const scanProjectConversations = vi
    .fn()
    .mockResolvedValue([]);
  const scanProjects = vi.fn().mockResolvedValue([]);
  const extractFileRefs = vi.fn().mockReturnValue([]);
  const computeChanges = vi.fn().mockReturnValue({
    at: 0,
    newChats: 0,
    removedChats: 0,
    updatedChats: 0,
    newPending: 0,
    pendingDelta: 0,
  });
  const assertOnChatGPT = vi.fn();
  const onExportComplete = vi.fn().mockResolvedValue(undefined);

  return {
    S,
    addLog,
    saveDebounce,
    net,
    ui,
    taskList,
    exportBlobStore,
    scanConversations,
    scanProjectConversations,
    scanProjects,
    extractFileRefs,
    computeChanges,
    assertOnChatGPT,
    onExportComplete,
  };
};

// Dynamic import to get fresh module
const loadExporter = async () => {
  const mod = await import("../../src/export/exporter");
  return mod.createExporter;
};

describe("createExporter", () => {
  let createExporter: Awaited<ReturnType<typeof loadExporter>>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    createExporter = await loadExporter();
  });

  describe("rescan()", () => {
    it("calls assertOnChatGPT and scan functions, updates state", async () => {
      const deps = makeDeps();
      const items: PendingItem[] = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      deps.scanConversations.mockResolvedValue(items);
      deps.scanProjects.mockResolvedValue([]);
      const exporter = createExporter(deps);

      await exporter.rescan(false);

      expect(deps.assertOnChatGPT).toHaveBeenCalled();
      expect(deps.scanConversations).toHaveBeenCalled();
      expect(deps.scanProjects).toHaveBeenCalled();
      expect(deps.taskList.add).toHaveBeenCalledWith(
        expect.objectContaining({ id: "scan", status: "active" }),
      );
      expect(deps.taskList.update).toHaveBeenCalledWith(
        "scan",
        expect.objectContaining({ status: "done" }),
      );
    });

    it("does not rescan while running unless forced", async () => {
      const deps = makeDeps();
      deps.S.run.isRunning = true;
      const exporter = createExporter(deps);

      await exporter.rescan(false);

      expect(deps.addLog).toHaveBeenCalledWith(
        "Can't rescan while running. Stop first.",
      );
      expect(deps.scanConversations).not.toHaveBeenCalled();
    });

    it("forces rescan even if running when force=true", async () => {
      const deps = makeDeps();
      deps.S.run.isRunning = true;
      deps.scanConversations.mockResolvedValue([]);
      deps.scanProjects.mockResolvedValue([]);
      const exporter = createExporter(deps);

      await exporter.rescan(true);

      expect(deps.scanConversations).toHaveBeenCalled();
    });

    it("deduplicates concurrent rescan calls", async () => {
      const deps = makeDeps();
      deps.scanConversations.mockResolvedValue([]);
      deps.scanProjects.mockResolvedValue([]);
      const exporter = createExporter(deps);

      const p1 = exporter.rescan(false);
      const p2 = exporter.rescan(false);
      await Promise.all([p1, p2]);

      // scanConversations should only be called once despite two rescan() calls
      expect(deps.scanConversations).toHaveBeenCalledTimes(1);
    });

    it("handles scan error gracefully", async () => {
      const deps = makeDeps();
      deps.scanConversations.mockRejectedValue(new Error("net fail"));
      const exporter = createExporter(deps);

      await exporter.rescan(false);

      expect(deps.S.run.lastError).toBe("net fail");
      expect(deps.taskList.update).toHaveBeenCalledWith(
        "scan",
        expect.objectContaining({ status: "failed" }),
      );
    });

    it("handles abort during scan", async () => {
      const deps = makeDeps();
      const abortErr = new DOMException("Aborted", "AbortError");
      deps.scanConversations.mockRejectedValue(abortErr);
      const exporter = createExporter(deps);

      await exporter.rescan(false);

      expect(deps.taskList.update).toHaveBeenCalledWith(
        "scan",
        expect.objectContaining({ status: "failed", error: "Stopped" }),
      );
      expect(deps.addLog).toHaveBeenCalledWith("Scan stopped.");
    });

    it("processes onPage callback to add pending items", async () => {
      const deps = makeDeps();
      deps.scanConversations.mockImplementation(
        async (
          _net: any,
          _S: any,
          _signal: any,
          onPage: any,
        ) => {
          const items = [
            { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
          ];
          if (onPage) onPage(items);
          return items;
        },
      );
      deps.scanProjects.mockResolvedValue([]);
      const exporter = createExporter(deps);

      await exporter.rescan(false);

      expect(deps.S.progress.pending.length).toBe(1);
      expect(deps.S.progress.pending[0].id).toBe("c1");
    });

    it("skips dead items in onPage", async () => {
      const deps = makeDeps();
      deps.S.progress.dead = [
        { id: "dead1", title: "Dead", update_time: 0, gizmo_id: null, lastError: "err" },
      ];
      deps.scanConversations.mockImplementation(
        async (_net: any, _S: any, _signal: any, onPage: any) => {
          const items = [
            { id: "dead1", title: "Dead", update_time: 100, gizmo_id: null },
            { id: "c2", title: "Chat 2", update_time: 100, gizmo_id: null },
          ];
          if (onPage) onPage(items);
          return items;
        },
      );
      deps.scanProjects.mockResolvedValue([]);
      const exporter = createExporter(deps);

      await exporter.rescan(false);

      expect(deps.S.progress.pending.length).toBe(1);
      expect(deps.S.progress.pending[0].id).toBe("c2");
    });

    it("builds kfPending from project files", async () => {
      const deps = makeDeps();
      deps.scanConversations.mockResolvedValue([]);
      deps.scanProjects.mockResolvedValue([
        {
          gizmoId: "p1",
          name: "Project 1",
          emoji: "",
          theme: "",
          instructions: "",
          memoryEnabled: false,
          memoryScope: "",
          files: [
            { fileId: "f1", name: "file1.txt", type: "text", size: 100 },
          ],
          raw: {},
        },
      ]);
      const exporter = createExporter(deps);

      await exporter.rescan(false);

      expect(deps.S.progress.kfPending.length).toBe(1);
      expect(deps.S.progress.kfPending[0].fileId).toBe("f1");
      expect(deps.S.progress.kfPending[0].projectId).toBe("p1");
    });

    it("computes changes from previous snapshot", async () => {
      const deps = makeDeps();
      deps.S.scan.snapshot = [["old1", 50]];
      const items = [{ id: "c1", title: "Chat", update_time: 100, gizmo_id: null }];
      deps.scanConversations.mockResolvedValue(items);
      deps.scanProjects.mockResolvedValue([]);
      const exporter = createExporter(deps);

      await exporter.rescan(false);

      expect(deps.computeChanges).toHaveBeenCalled();
    });
  });

  describe("start() / stop()", () => {
    it("sets running state and processes pending items", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/conversation/c1")) {
          return { mapping: {} };
        }
        return {};
      });
      deps.extractFileRefs.mockReturnValue([]);
      const exporter = createExporter(deps);

      await exporter.start();

      expect(deps.S.run.isRunning).toBe(false);
      expect(deps.S.run.lastPhase).toBe("idle");
    });

    it("stop() sets stopRequested and aborts", async () => {
      const deps = makeDeps();
      const exporter = createExporter(deps);

      // Not running, so stop just logs
      exporter.stop();
      expect(deps.addLog).toHaveBeenCalledWith("Not running.");
    });

    it("does not start if already running", async () => {
      const deps = makeDeps();
      deps.S.run.isRunning = true;
      const exporter = createExporter(deps);

      await exporter.start();

      expect(deps.addLog).toHaveBeenCalledWith("Already running.");
    });

    it("stop() aborts when running", async () => {
      const deps = makeDeps();
      let resolveScan: () => void = () => {};
      deps.scanConversations.mockReturnValue(
        new Promise<PendingItem[]>((resolve) => {
          resolveScan = () => resolve([]);
        }),
      );
      deps.scanProjects.mockResolvedValue([]);
      const exporter = createExporter(deps);

      // Start will trigger a rescan and wait for scan
      const startPromise = exporter.start();

      // Now stop while scan is in progress
      exporter.stop();
      expect(deps.addLog).toHaveBeenCalledWith("Stop requested\u2026");

      // Resolve the scan so start can finish
      resolveScan();
      await startPromise;
    });
  });

  describe("exportOneBatch()", () => {
    it("accumulates conversations in IDB instead of downloading ZIP", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      const convJson = { id: "c1", mapping: {} };
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/conversation/c1")) {
          return convJson;
        }
        return {};
      });
      deps.extractFileRefs.mockReturnValue([]);
      deps.exportBlobStore.totalSize.mockResolvedValue(1234);
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportOneBatch(ac.signal);

      // Should NOT have downloaded a ZIP
      expect(deps.net.download).not.toHaveBeenCalled();
      // Should have stored conversation in IDB
      expect(deps.exportBlobStore.putConv).toHaveBeenCalledWith(
        "c1",
        JSON.stringify(convJson),
      );
      // Should have called totalSize to update UI
      expect(deps.exportBlobStore.totalSize).toHaveBeenCalled();
      // Item should be exported
      expect(deps.S.progress.exported["c1"]).toBe(100);
      expect(deps.S.stats.batches).toBe(1);
      expect(deps.S.stats.chats).toBe(1);
    });

    it("stores file assets in IDB with zip-relative paths", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      const fileBlob = makeBlob("file content", "text/plain");
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/conversation/c1")) {
          return { id: "c1", mapping: {} };
        }
        if (url.includes("/backend-api/files/download/file1")) {
          return { download_url: "https://cdn.example.com/file1.bin" };
        }
        return {};
      });
      deps.net.fetchBlob.mockResolvedValue(fileBlob);
      deps.extractFileRefs.mockReturnValue([
        { id: "file1", name: "readme.txt" },
      ]);
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportOneBatch(ac.signal);

      // File download was attempted
      expect(deps.net.fetchJson).toHaveBeenCalledWith(
        "/backend-api/files/download/file1",
        expect.objectContaining({ auth: true }),
      );
      expect(deps.net.fetchBlob).toHaveBeenCalled();
      // Should NOT have downloaded a ZIP
      expect(deps.net.download).not.toHaveBeenCalled();
      // Asset should be stored in IDB with zip-relative path
      expect(deps.exportBlobStore.putFile).toHaveBeenCalledWith(
        "file1_readme.txt",
        fileBlob,
      );
    });

    it("moves failed items to dead after 3 failures", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      deps.S.progress.failCounts = { c1: 2 };
      deps.net.fetchJson.mockRejectedValue(new Error("server error"));
      deps.extractFileRefs.mockReturnValue([]);
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportOneBatch(ac.signal);

      expect(deps.S.progress.dead.length).toBe(1);
      expect(deps.S.progress.dead[0].id).toBe("c1");
      expect(deps.S.progress.dead[0].lastError).toBe("server error");
    });

    it("requeues items that failed fewer than 3 times", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      deps.S.progress.failCounts = {};
      deps.net.fetchJson.mockRejectedValue(new Error("temporary error"));
      deps.extractFileRefs.mockReturnValue([]);
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportOneBatch(ac.signal);

      expect(deps.S.progress.dead.length).toBe(0);
      expect(deps.S.progress.pending.length).toBe(1);
      expect(deps.S.progress.failCounts["c1"]).toBe(1);
    });

    it("filters by gizmo_id when filterGizmoId is set", async () => {
      const deps = makeDeps();
      deps.S.settings.filterGizmoId = "g1";
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: "g1" },
        { id: "c2", title: "Chat 2", update_time: 200, gizmo_id: "g2" },
      ];
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/conversation/")) {
          return { id: "c1", mapping: {} };
        }
        return {};
      });
      deps.extractFileRefs.mockReturnValue([]);
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportOneBatch(ac.signal);

      // Only c1 (gizmo g1) should have been fetched
      expect(deps.net.fetchJson).toHaveBeenCalledWith(
        "/backend-api/conversation/c1",
        expect.anything(),
      );
      expect(deps.net.fetchJson).not.toHaveBeenCalledWith(
        "/backend-api/conversation/c2",
        expect.anything(),
      );
    });

    it("stops with no-progress detection when all items fail", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      deps.S.progress.failCounts = {};
      deps.net.fetchJson.mockRejectedValue(new Error("fail"));
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportOneBatch(ac.signal);

      // All items requeued, no successes => should detect no progress
      expect(deps.addLog).toHaveBeenCalledWith(
        expect.stringContaining("No progress"),
      );
    });

    it("returns early when batch is empty", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [];
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportOneBatch(ac.signal);

      expect(deps.net.fetchJson).not.toHaveBeenCalled();
      expect(deps.net.download).not.toHaveBeenCalled();
    });
  });

  describe("exportKnowledgeBatch()", () => {
    it("accumulates KF files in IDB instead of downloading ZIP", async () => {
      const deps = makeDeps();
      deps.S.progress.kfPending = [
        {
          projectId: "p1",
          projectName: "Project 1",
          fileId: "f1",
          fileName: "doc.txt",
          fileType: "text",
          fileSize: 100,
        },
      ];
      deps.S.projects = [
        {
          gizmoId: "p1",
          name: "Project 1",
          emoji: "",
          theme: "",
          instructions: "",
          memoryEnabled: false,
          memoryScope: "",
          files: [{ fileId: "f1", name: "doc.txt", type: "text", size: 100 }],
          raw: { some: "data" },
        },
      ];
      const fileBlob = makeBlob("content");
      deps.net.fetchJson.mockResolvedValue({
        status: "success",
        download_url: "/files/f1.txt",
      });
      deps.net.fetchBlob.mockResolvedValue(fileBlob);
      deps.exportBlobStore.totalSize.mockResolvedValue(5000);
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportKnowledgeBatch(ac.signal);

      // Should NOT have downloaded a ZIP
      expect(deps.net.download).not.toHaveBeenCalled();
      // KF binary file should be stored in IDB under kf/<projectName>/<filename>
      expect(deps.exportBlobStore.putFile).toHaveBeenCalledWith(
        "kf/Project 1/doc.txt",
        fileBlob,
      );
      // Project metadata should be stored in IDB
      expect(deps.exportBlobStore.putFile).toHaveBeenCalledWith(
        "kf/Project 1/project.json",
        expect.any(Blob),
      );
      // Should have called totalSize to update UI
      expect(deps.exportBlobStore.totalSize).toHaveBeenCalled();
      // kfExported and stats should still be updated
      expect(deps.S.progress.kfExported.length).toBe(1);
      expect(deps.S.stats.kfBatches).toBe(1);
      expect(deps.S.stats.kfFiles).toBe(1);
    });

    it("dead-letters file_not_found items immediately", async () => {
      const deps = makeDeps();
      deps.S.progress.kfPending = [
        {
          projectId: "p1",
          projectName: "Project 1",
          fileId: "f1",
          fileName: "doc.txt",
          fileType: "text",
          fileSize: 100,
        },
      ];
      deps.net.fetchJson.mockResolvedValue({
        status: "error",
        error_code: "file_not_found",
      });
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportKnowledgeBatch(ac.signal);

      expect(deps.S.progress.kfDead.length).toBe(1);
      expect(deps.S.progress.kfDead[0].lastError).toBe("file_not_found");
      expect(deps.net.download).not.toHaveBeenCalled();
    });

    it("filters by projectId when filterGizmoId is set", async () => {
      const deps = makeDeps();
      deps.S.settings.filterGizmoId = "p1";
      deps.S.progress.kfPending = [
        {
          projectId: "p1",
          projectName: "Project 1",
          fileId: "f1",
          fileName: "doc.txt",
          fileType: "text",
          fileSize: 100,
        },
        {
          projectId: "p2",
          projectName: "Project 2",
          fileId: "f2",
          fileName: "other.txt",
          fileType: "text",
          fileSize: 200,
        },
      ];
      deps.net.fetchJson.mockResolvedValue({
        status: "success",
        download_url: "/files/f1.txt",
      });
      deps.net.fetchBlob.mockResolvedValue(makeBlob("content"));
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportKnowledgeBatch(ac.signal);

      // Only f1 should have been processed (project p1)
      expect(deps.net.fetchJson).toHaveBeenCalledWith(
        expect.stringContaining("f1"),
        expect.anything(),
      );
      expect(deps.net.fetchJson).not.toHaveBeenCalledWith(
        expect.stringContaining("f2"),
        expect.anything(),
      );
    });

    it("returns early when kfPending batch is empty", async () => {
      const deps = makeDeps();
      deps.S.progress.kfPending = [];
      const ac = new AbortController();
      const exporter = createExporter(deps);

      await exporter.exportKnowledgeBatch(ac.signal);

      expect(deps.net.fetchJson).not.toHaveBeenCalled();
      expect(deps.net.download).not.toHaveBeenCalled();
    });
  });

  describe("auto-trigger download on export completion", () => {
    it("calls onExportComplete when all pending conversations are exported", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/conversation/c1")) {
          return { id: "c1", mapping: {} };
        }
        return {};
      });
      deps.extractFileRefs.mockReturnValue([]);
      deps.exportBlobStore.totalSize.mockResolvedValue(1000);
      const exporter = createExporter(deps);

      await exporter.start();

      expect(deps.onExportComplete).toHaveBeenCalled();
    });

    it("does not call onExportComplete when export is stopped", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/conversation/c1")) {
          // Simulate a stop during processing
          return { id: "c1", mapping: {} };
        }
        return {};
      });
      deps.extractFileRefs.mockReturnValue([]);
      const exporter = createExporter(deps);

      // Mark as stopped before start finishes
      const startP = exporter.start();
      // The exporter will process the batch, then check stopRequested
      // Simulate stop by calling stop right away
      exporter.stop();
      await startP;

      expect(deps.onExportComplete).not.toHaveBeenCalled();
    });
  });

  describe("abort signal propagation", () => {
    it("exportOneBatch stops on abort", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
        { id: "c2", title: "Chat 2", update_time: 200, gizmo_id: null },
      ];
      const ac = new AbortController();
      let callCount = 0;
      deps.net.fetchJson.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          ac.abort();
          throw new DOMException("Aborted", "AbortError");
        }
        return { mapping: {} };
      });
      deps.extractFileRefs.mockReturnValue([]);
      const exporter = createExporter(deps);

      await exporter.exportOneBatch(ac.signal);

      // Should not have thrown, but should have handled the abort
      expect(callCount).toBe(1);
    });
  });
});
