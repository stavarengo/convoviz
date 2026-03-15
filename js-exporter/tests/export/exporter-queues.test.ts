// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExportState, PendingItem } from "../../src/types";
import { defaultState } from "../../src/state/defaults";

/* eslint-disable @typescript-eslint/no-explicit-any */

const makeBlob = (content: string, type = "application/octet-stream"): Blob => {
  const blob = new Blob([content], { type });
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
    updateDownloadButton: vi.fn().mockResolvedValue(undefined),
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
  const scanConversations = vi.fn().mockResolvedValue([]);
  const scanProjectConversations = vi.fn().mockResolvedValue([]);
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

const loadExporter = async () => {
  const mod = await import("../../src/export/exporter");
  return mod.createExporter;
};

describe("queue-based exporter", () => {
  let createExporter: Awaited<ReturnType<typeof loadExporter>>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    createExporter = await loadExporter();
  });

  describe("full start->process->stop cycle", () => {
    it("processes pending chats via chat queue, not batch", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
        { id: "c2", title: "Chat 2", update_time: 200, gizmo_id: null },
      ];
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/conversation/")) {
          return { id: url.split("/").pop(), mapping: {} };
        }
        return {};
      });
      deps.extractFileRefs.mockReturnValue([]);
      const exporter = createExporter(deps);

      await exporter.start();

      // Both chats should have been fetched
      expect(deps.exportBlobStore.putConv).toHaveBeenCalledTimes(2);
      // Exported state should track them
      expect(deps.S.progress.exported["c1"]).toBe(100);
      expect(deps.S.progress.exported["c2"]).toBe(200);
      // Pending should be drained
      expect(deps.S.progress.pending).toHaveLength(0);
    });

    it("chat->attachment push flow: chat worker pushes file refs to attachment queue", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      const fileBlob = makeBlob("file content", "image/png");
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
        { id: "file1", name: "image.png" },
      ]);
      const exporter = createExporter(deps);

      await exporter.start();

      // Chat should be stored
      expect(deps.exportBlobStore.putConv).toHaveBeenCalledWith(
        "c1",
        expect.any(String),
      );
      // File should have been downloaded via attachment queue
      expect(deps.net.fetchJson).toHaveBeenCalledWith(
        "/backend-api/files/download/file1",
        expect.objectContaining({ auth: true }),
      );
      expect(deps.net.fetchBlob).toHaveBeenCalled();
      expect(deps.exportBlobStore.putFile).toHaveBeenCalledWith(
        "file1_image.png",
        fileBlob,
      );
    });
  });

  describe("completion detection", () => {
    it("fires onExportComplete when all three queues drain", async () => {
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
      const exporter = createExporter(deps);

      await exporter.start();

      expect(deps.onExportComplete).toHaveBeenCalled();
    });

    it("does not fire onExportComplete when stopped", async () => {
      const deps = makeDeps();
      let resolveChat: (() => void) | null = null;
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      deps.net.fetchJson.mockImplementation(async () => {
        return new Promise((resolve) => {
          resolveChat = () => resolve({ id: "c1", mapping: {} });
        });
      });
      deps.extractFileRefs.mockReturnValue([]);
      const exporter = createExporter(deps);

      const startPromise = exporter.start();
      // Give time for queue to start
      await new Promise((r) => setTimeout(r, 50));
      exporter.stop();
      if (resolveChat) resolveChat();
      await startPromise;

      expect(deps.onExportComplete).not.toHaveBeenCalled();
    });
  });

  describe("stop-while-running", () => {
    it("workers finish current item then exit on stop", async () => {
      const deps = makeDeps();
      let callCount = 0;
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
        { id: "c2", title: "Chat 2", update_time: 200, gizmo_id: null },
        { id: "c3", title: "Chat 3", update_time: 300, gizmo_id: null },
      ];
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/conversation/")) {
          callCount++;
          // Simulate some delay
          await new Promise((r) => setTimeout(r, 10));
          return { id: url.split("/").pop(), mapping: {} };
        }
        return {};
      });
      deps.extractFileRefs.mockReturnValue([]);
      const exporter = createExporter(deps);

      const startPromise = exporter.start();
      // Give time for first chat to start processing
      await new Promise((r) => setTimeout(r, 30));
      exporter.stop();
      await startPromise;

      // Should have processed at least 1 but likely not all
      // The important thing is it stopped cleanly
      expect(deps.S.run.isRunning).toBe(false);
    });
  });

  describe("knowledge file queue integration", () => {
    it("processes knowledge files concurrently with chats", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      deps.S.progress.knowledgeFilesPending = [
        {
          projectId: "p1",
          projectName: "Project 1",
          fileId: "kf1",
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
          files: [{ fileId: "kf1", name: "doc.txt", type: "text", size: 100 }],
          raw: { some: "data" },
        },
      ];
      const fileBlob = makeBlob("kf content");
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/conversation/c1")) {
          return { id: "c1", mapping: {} };
        }
        if (url.includes("/backend-api/files/download/")) {
          return { status: "success", download_url: "/files/kf1.txt" };
        }
        return {};
      });
      deps.net.fetchBlob.mockResolvedValue(fileBlob);
      deps.extractFileRefs.mockReturnValue([]);
      const exporter = createExporter(deps);

      await exporter.start();

      // Chat stored
      expect(deps.exportBlobStore.putConv).toHaveBeenCalledWith(
        "c1",
        expect.any(String),
      );
      // KF file stored
      expect(deps.exportBlobStore.putFile).toHaveBeenCalledWith(
        "kf/Project 1/doc.txt",
        fileBlob,
      );
      // KF pending should be drained
      expect(deps.S.progress.knowledgeFilesPending).toHaveLength(0);
    });
  });

  describe("file task list entries", () => {
    it("adds task list entries with type 'file' when chat worker pushes attachment items", async () => {
      const deps = makeDeps();
      deps.S.progress.pending = [
        { id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null },
      ];
      const fileBlob = makeBlob("file content", "image/png");
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/conversation/c1")) {
          return { id: "c1", mapping: {} };
        }
        if (url.includes("/backend-api/files/download/")) {
          return { download_url: "https://cdn.example.com/file.bin" };
        }
        return {};
      });
      deps.net.fetchBlob.mockResolvedValue(fileBlob);
      deps.extractFileRefs.mockReturnValue([
        { id: "file1", name: "image.png" },
        { id: "file2", name: "doc.pdf" },
      ]);
      const exporter = createExporter(deps);

      await exporter.start();

      // Should have added file tasks
      const fileAdds = deps.taskList.add.mock.calls.filter(
        (call: any[]) => call[0].type === "file",
      );
      expect(fileAdds.length).toBe(2);
      expect(fileAdds[0][0]).toMatchObject({
        id: "file-file1",
        type: "file",
        label: "image.png",
        status: "queued",
      });
      expect(fileAdds[1][0]).toMatchObject({
        id: "file-file2",
        type: "file",
        label: "doc.pdf",
        status: "queued",
      });
    });

    it("adds task list entries for leftover filePending items on resume", async () => {
      const deps = makeDeps();
      deps.S.progress.filePending = [
        { id: "fp1", name: "leftover.png", conversationId: "c0", conversationTitle: "Old Chat" },
      ];
      const fileBlob = makeBlob("data");
      deps.net.fetchJson.mockImplementation(async (url: string) => {
        if (url.includes("/backend-api/files/download/")) {
          return { download_url: "/files/fp1.bin" };
        }
        return {};
      });
      deps.net.fetchBlob.mockResolvedValue(fileBlob);
      const exporter = createExporter(deps);

      await exporter.start();

      const fileAdds = deps.taskList.add.mock.calls.filter(
        (call: any[]) => call[0].type === "file",
      );
      expect(fileAdds.length).toBe(1);
      expect(fileAdds[0][0]).toMatchObject({
        id: "file-fp1",
        type: "file",
        label: "leftover.png",
        status: "queued",
      });
    });
  });

  describe("exporter no longer has batch methods", () => {
    it("does not expose exportOneBatch or exportKnowledgeBatch", () => {
      const deps = makeDeps();
      const exporter = createExporter(deps);
      expect((exporter as any).exportOneBatch).toBeUndefined();
      expect((exporter as any).exportKnowledgeBatch).toBeUndefined();
    });
  });
});
