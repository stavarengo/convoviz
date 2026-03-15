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
    hasFilePrefix: vi.fn().mockResolvedValue(false),
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

      expect(deps.S.progress.knowledgeFilesPending.length).toBe(1);
      expect(deps.S.progress.knowledgeFilesPending[0].fileId).toBe("f1");
      expect(deps.S.progress.knowledgeFilesPending[0].projectId).toBe("p1");
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

});
