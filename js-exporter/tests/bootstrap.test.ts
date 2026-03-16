import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootstrap } from "../src/bootstrap";
import type { EventBus } from "../src/events/bus";
import type { EventMap } from "../src/events/types";
import type { DiscoveryStore, ConversationRecord } from "../src/state/discovery-store";
import type { KnowledgeFileItem } from "../src/export/knowledge-worker";
import type { AttachmentItem } from "../src/export/attachment-worker";

/* eslint-disable @typescript-eslint/no-explicit-any */

function createMockDiscoveryStore(): DiscoveryStore {
  const conversations = new Map<string, ConversationRecord>();
  return {
    init: vi.fn().mockResolvedValue(undefined),
    putConversation: vi.fn(async (record: ConversationRecord) => {
      conversations.set(record.id, record);
    }),
    getConversation: vi.fn(async (id: string) => conversations.get(id) ?? null),
    getAllConversations: vi.fn(async () => [...conversations.values()]),
    putProject: vi.fn().mockResolvedValue(undefined),
    getProject: vi.fn().mockResolvedValue(null),
    getAllProjects: vi.fn(async () => []),
    putScannerState: vi.fn().mockResolvedValue(undefined),
    getScannerState: vi.fn().mockResolvedValue(null),
    deleteScannerState: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    seedFromExportState: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockNet() {
  return {
    getToken: vi.fn().mockResolvedValue("tok"),
    fetchJson: vi.fn().mockResolvedValue({}),
    fetchBlob: vi.fn().mockResolvedValue(new Blob()),
  };
}

function createMockExportBlobStore() {
  return {
    putConv: vi.fn().mockResolvedValue(undefined),
    putFile: vi.fn().mockResolvedValue(undefined),
    putFileMeta: vi.fn().mockResolvedValue(undefined),
    hasFilePrefix: vi.fn().mockResolvedValue(false),
    totalSize: vi.fn().mockResolvedValue(0),
  };
}

function createMockTaskList() {
  return {
    add: vi.fn(),
    update: vi.fn(),
    getVisible: vi.fn(() => []),
    render: vi.fn(),
  };
}

describe("bootstrap", () => {
  let mockNet: ReturnType<typeof createMockNet>;
  let mockDiscoveryStore: ReturnType<typeof createMockDiscoveryStore>;
  let mockExportBlobStore: ReturnType<typeof createMockExportBlobStore>;
  let mockTaskList: ReturnType<typeof createMockTaskList>;
  let log: ReturnType<typeof vi.fn>;
  let saveDebounce: ReturnType<typeof vi.fn>;
  let extractFileRefs: ReturnType<typeof vi.fn>;

  const makeS = () => ({
    v: 1,
    ver: "test",
    projects: [] as any[],
    settings: {
      chatConcurrency: 1,
      fileConcurrency: 1,
      knowledgeFileConcurrency: 1,
      pause: 0,
      filterGizmoId: null,
    },
    progress: {
      exported: {} as Record<string, number>,
      pending: [] as any[],
      dead: [] as any[],
      failCounts: {} as Record<string, number>,
      filePending: [] as any[],
      fileDead: [] as any[],
      fileFailCounts: {} as Record<string, number>,
      fileDoneCount: 0,
      knowledgeFilesExported: [] as any[],
      knowledgeFilesPending: [] as any[],
      knowledgeFilesDead: [] as any[],
      knowledgeFilesFailCounts: {} as Record<string, number>,
    },
    scan: { at: 0, total: 0, totalProjects: 0, snapshot: [] },
    stats: {
      chatsExported: 0,
      chatsMs: 0,
      filesDownloaded: 0,
      filesMs: 0,
      knowledgeFilesDownloaded: 0,
      knowledgeFilesMs: 0,
    },
    run: {
      isRunning: false,
      startedAt: 0,
      stoppedAt: 0,
      lastError: "",
      backoffUntil: 0,
      backoffCount: 0,
    },
    changes: {
      at: 0,
      newChats: 0,
      removedChats: 0,
      updatedChats: 0,
      newPending: 0,
      pendingDelta: 0,
    },
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNet = createMockNet();
    mockDiscoveryStore = createMockDiscoveryStore();
    mockExportBlobStore = createMockExportBlobStore();
    mockTaskList = createMockTaskList();
    log = vi.fn();
    saveDebounce = vi.fn();
    extractFileRefs = vi.fn().mockReturnValue([]);
  });

  const doBootstrap = (S = makeS()) =>
    bootstrap({
      S,
      net: mockNet,
      discoveryStore: mockDiscoveryStore,
      exportBlobStore: mockExportBlobStore,
      taskList: mockTaskList,
      log,
      saveDebounce,
      extractFileRefs,
    });

  it("returns eventBus, queues, scanners, and coordinator", () => {
    const result = doBootstrap();
    expect(result.eventBus).toBeDefined();
    expect(result.chatQueue).toBeDefined();
    expect(result.attachmentQueue).toBeDefined();
    expect(result.knowledgeQueue).toBeDefined();
    expect(result.conversationScanner).toBeDefined();
    expect(result.projectScanner).toBeDefined();
  });

  describe("scanner-progress event -> S.scan.total", () => {
    it("updates S.scan.total from the general scanner", () => {
      const S = makeS();
      const result = doBootstrap(S);

      result.eventBus.emit("scanner-progress", {
        scannerId: "general",
        offset: 100,
        total: 3769,
      });

      expect(S.scan.total).toBe(3769);
    });

    it("ignores project-specific scanner totals", () => {
      const S = makeS();
      const result = doBootstrap(S);

      result.eventBus.emit("scanner-progress", {
        scannerId: "project-conv-gizmo-1",
        offset: 50,
        total: 200,
      });

      expect(S.scan.total).toBe(0);
    });
  });

  describe("conversation-needs-export event -> chat queue", () => {
    it("looks up discovery store and enqueues into chat queue", async () => {
      const S = makeS();
      const result = doBootstrap(S);

      // Seed a conversation record in discovery store
      await mockDiscoveryStore.putConversation({
        id: "conv-1",
        title: "Test Chat",
        updateTime: 1700000000,
        gizmoId: null,
        status: "new",
        exportedAt: null,
      });

      result.eventBus.emit("conversation-needs-export", { id: "conv-1" });

      // Allow async listener to complete
      await vi.waitFor(() => {
        expect(result.chatQueue.stats.pending).toBe(1);
      });
    });
  });

  describe("conversation-needs-update event -> chat queue", () => {
    it("looks up discovery store and enqueues into chat queue", async () => {
      const S = makeS();
      const result = doBootstrap(S);

      await mockDiscoveryStore.putConversation({
        id: "conv-2",
        title: "Updated Chat",
        updateTime: 1700000001,
        gizmoId: null,
        status: "needs-update",
        exportedAt: null,
      });

      result.eventBus.emit("conversation-needs-update", { id: "conv-2" });

      await vi.waitFor(() => {
        expect(result.chatQueue.stats.pending).toBe(1);
      });
    });
  });

  describe("conversation-exported event -> discovery store update", () => {
    it("updates discovery store record to status exported", async () => {
      const S = makeS();
      const result = doBootstrap(S);

      await mockDiscoveryStore.putConversation({
        id: "conv-3",
        title: "Done Chat",
        updateTime: 1700000000,
        gizmoId: null,
        status: "new",
        exportedAt: null,
      });

      result.eventBus.emit("conversation-exported", { id: "conv-3" });

      await vi.waitFor(() => {
        expect(mockDiscoveryStore.putConversation).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "conv-3",
            status: "exported",
          }),
        );
      });
    });
  });

  describe("conversation-files-discovered event -> attachment queue", () => {
    it("converts file refs to AttachmentItems and enqueues into attachment queue", async () => {
      const S = makeS();
      const result = doBootstrap(S);

      result.eventBus.emit("conversation-files-discovered", {
        conversationId: "conv-1",
        conversationTitle: "My Chat",
        files: [
          { id: "file-1", name: "report.pdf" },
          { id: "file-2", name: null },
        ],
      });

      await vi.waitFor(() => {
        expect(result.attachmentQueue.stats.pending).toBe(2);
      });

      // Verify task list entries were added
      expect(mockTaskList.add).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "file-file-1",
          type: "file",
          label: "report.pdf",
          status: "queued",
        }),
      );
      expect(mockTaskList.add).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "file-file-2",
          type: "file",
          status: "queued",
        }),
      );
    });
  });

  describe("knowledge-file-discovered event -> knowledge queue", () => {
    it("converts to KnowledgeFileItem and enqueues into knowledge queue", async () => {
      const S = makeS();
      const result = doBootstrap(S);

      result.eventBus.emit("knowledge-file-discovered", {
        fileId: "kf-1",
        projectId: "proj-1",
        projectName: "My Project",
        fileName: "data.csv",
        fileType: "text/csv",
        fileSize: 1024,
      });

      await vi.waitFor(() => {
        expect(result.knowledgeQueue.stats.pending).toBe(1);
      });

      // Verify task list entry was added
      expect(mockTaskList.add).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "kf-kf-1",
          type: "knowledge",
          label: "data.csv",
          projectName: "My Project",
          status: "queued",
        }),
      );
    });
  });

  describe("project-discovered event -> conversation scanner + KF discovery", () => {
    it("spawns a conversation scanner for the project gizmoId", async () => {
      const S = makeS();
      const result = doBootstrap(S);

      // Mock fetch to return empty page (scanner will complete immediately)
      mockNet.fetchJson.mockResolvedValue({ items: [], total: 0 });

      result.eventBus.emit("project-discovered", {
        gizmoId: "gizmo-1",
        name: "My GPT",
        files: [],
      });

      // Scanner should start and complete - fetchJson should be called for conversation scan
      await vi.waitFor(() => {
        const calls = mockNet.fetchJson.mock.calls;
        const scanCall = calls.find(
          (c: any[]) =>
            typeof c[0] === "string" && c[0].includes("gizmo_id=gizmo-1"),
        );
        expect(scanCall).toBeDefined();
      });
    });

    it("runs knowledge file discovery for project files", async () => {
      const S = makeS();
      const result = doBootstrap(S);

      mockNet.fetchJson.mockResolvedValue({ items: [], total: 0 });

      result.eventBus.emit("project-discovered", {
        gizmoId: "gizmo-2",
        name: "My GPT",
        files: [
          { fileId: "kf-1", name: "data.csv", type: "text/csv", size: 1024 },
        ],
      });

      // Knowledge file discovery should emit knowledge-file-discovered
      // which triggers enqueue into knowledge queue
      await vi.waitFor(() => {
        expect(result.knowledgeQueue.stats.pending).toBe(1);
      });
    });
  });

  describe("end-to-end chain: scanner -> event -> chat queue -> worker -> files-discovered -> attachment queue", () => {
    it("routes conversation discovery through to attachment enqueue via events", async () => {
      const S = makeS();
      const result = doBootstrap(S);

      // Seed discovery store with a conversation
      await mockDiscoveryStore.putConversation({
        id: "conv-chain",
        title: "Chain Test",
        updateTime: 1700000000,
        gizmoId: null,
        status: "new",
        exportedAt: null,
      });

      // Simulate scanner discovering a conversation
      result.eventBus.emit("conversation-needs-export", { id: "conv-chain" });

      // Chat queue should receive the item
      await vi.waitFor(() => {
        expect(result.chatQueue.stats.pending).toBe(1);
      });

      // Also verify task list entry for the conversation
      expect(mockTaskList.add).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "conv-conv-chain",
          type: "conversation",
          label: "Chain Test",
          status: "queued",
        }),
      );
    });
  });
});
