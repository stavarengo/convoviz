import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PendingItem, FileRef } from "../../src/types";
import { createChatWorker } from "../../src/export/chat-worker";
import type { EventBus } from "../../src/events/bus";
import type { EventMap } from "../../src/events/types";
import type { DiscoveryStore } from "../../src/state/discovery-store";

const makePendingItem = (
  overrides: Partial<PendingItem> = {},
): PendingItem => ({
  id: "conv-1",
  title: "Test Conversation",
  update_time: 1700000000,
  gizmo_id: null,
  ...overrides,
});

const makeConversationJson = (fileRefs: { id: string; name: string | null }[] = []) => {
  const mapping: Record<string, unknown> = {};
  for (const ref of fileRefs) {
    mapping["node-" + ref.id] = {
      message: {
        metadata: {
          attachments: [{ id: ref.id, name: ref.name }],
        },
        content: { parts: [] },
      },
    };
  }
  return { mapping };
};

function createMockEventBus(): EventBus & { emitted: Array<{ event: string; payload: unknown }> } {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    emitted,
    on: vi.fn(() => () => {}),
    emit: vi.fn((event: string, payload: unknown) => {
      emitted.push({ event, payload });
    }) as EventBus["emit"],
    off: vi.fn() as EventBus["off"],
    clear: vi.fn(),
  };
}

function createMockDiscoveryStore(): Pick<DiscoveryStore, "getConversation"> {
  return {
    getConversation: vi.fn().mockResolvedValue(null),
  };
}

describe("createChatWorker", () => {
  let mockNet: { fetchJson: ReturnType<typeof vi.fn> };
  let mockExportBlobStore: { putConv: ReturnType<typeof vi.fn> };
  let mockEventBus: ReturnType<typeof createMockEventBus>;
  let mockProgress: { exported: Record<string, number> };
  let mockExtractFileRefs: ReturnType<typeof vi.fn>;
  let mockDiscoveryStore: ReturnType<typeof createMockDiscoveryStore>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNet = {
      fetchJson: vi.fn(),
    };
    mockExportBlobStore = {
      putConv: vi.fn().mockResolvedValue(undefined),
    };
    mockEventBus = createMockEventBus();
    mockProgress = {
      exported: {},
    };
    mockExtractFileRefs = vi.fn();
    mockDiscoveryStore = createMockDiscoveryStore();
  });

  const buildWorker = () =>
    createChatWorker({
      net: mockNet,
      exportBlobStore: mockExportBlobStore,
      eventBus: mockEventBus,
      progress: mockProgress,
      extractFileRefs: mockExtractFileRefs,
      discoveryStore: mockDiscoveryStore,
    });

  describe("success path: emits events instead of direct queue push", () => {
    it("fetches conversation, emits conversation-exported and conversation-files-discovered events", async () => {
      const convJson = makeConversationJson([
        { id: "file-1", name: "report.pdf" },
        { id: "file-2", name: null },
      ]);
      mockNet.fetchJson.mockResolvedValue(convJson);
      mockExtractFileRefs.mockReturnValue([
        { id: "file-1", name: "report.pdf" },
        { id: "file-2", name: null },
      ] as FileRef[]);

      const item = makePendingItem({ id: "conv-1", title: "My Chat" });
      const signal = new AbortController().signal;

      const worker = buildWorker();
      await worker(item, signal);

      // Verify conversation JSON was fetched
      expect(mockNet.fetchJson).toHaveBeenCalledWith(
        "/backend-api/conversation/conv-1",
        { signal, auth: true },
      );

      // Verify extractFileRefs was called with the JSON
      expect(mockExtractFileRefs).toHaveBeenCalledWith(convJson);

      // Verify conversation-files-discovered event was emitted with file refs
      const filesEvent = mockEventBus.emitted.find(
        (e) => e.event === "conversation-files-discovered",
      );
      expect(filesEvent).toBeDefined();
      const filesPayload = filesEvent!.payload as EventMap["conversation-files-discovered"];
      expect(filesPayload.conversationId).toBe("conv-1");
      expect(filesPayload.conversationTitle).toBe("My Chat");
      expect(filesPayload.files).toHaveLength(2);
      expect(filesPayload.files[0]).toEqual({ id: "file-1", name: "report.pdf" });
      expect(filesPayload.files[1]).toEqual({ id: "file-2", name: null });

      // Verify conversation-exported event was emitted
      const exportedEvent = mockEventBus.emitted.find(
        (e) => e.event === "conversation-exported",
      );
      expect(exportedEvent).toBeDefined();
      expect((exportedEvent!.payload as EventMap["conversation-exported"]).id).toBe("conv-1");

      // Verify conversation JSON was stored in IDB
      expect(mockExportBlobStore.putConv).toHaveBeenCalledWith(
        "conv-1",
        JSON.stringify(convJson),
      );

      // Verify progress was updated
      expect(mockProgress.exported["conv-1"]).toBe(1700000000);
    });
  });

  describe("conversation with no file refs", () => {
    it("emits conversation-exported but not conversation-files-discovered when no files", async () => {
      const convJson = makeConversationJson();
      mockNet.fetchJson.mockResolvedValue(convJson);
      mockExtractFileRefs.mockReturnValue([]);

      const item = makePendingItem({ id: "conv-2", title: "Empty Chat" });
      const signal = new AbortController().signal;

      const worker = buildWorker();
      await worker(item, signal);

      // Verify conversation JSON was fetched and stored
      expect(mockNet.fetchJson).toHaveBeenCalledOnce();
      expect(mockExportBlobStore.putConv).toHaveBeenCalledWith(
        "conv-2",
        JSON.stringify(convJson),
      );

      // No files-discovered event should be emitted
      const filesEvent = mockEventBus.emitted.find(
        (e) => e.event === "conversation-files-discovered",
      );
      expect(filesEvent).toBeUndefined();

      // conversation-exported event should still be emitted
      const exportedEvent = mockEventBus.emitted.find(
        (e) => e.event === "conversation-exported",
      );
      expect(exportedEvent).toBeDefined();

      // Progress updated
      expect(mockProgress.exported["conv-2"]).toBe(1700000000);
    });
  });

  describe("network error propagation", () => {
    it("propagates network errors from fetchJson without emitting events", async () => {
      mockNet.fetchJson.mockRejectedValue(new Error("Network timeout"));

      const item = makePendingItem();
      const signal = new AbortController().signal;

      const worker = buildWorker();
      await expect(worker(item, signal)).rejects.toThrow("Network timeout");

      // Nothing stored or emitted on error
      expect(mockExportBlobStore.putConv).not.toHaveBeenCalled();
      expect(mockEventBus.emitted).toHaveLength(0);
    });
  });

  describe("worker-level dedup via discovery store", () => {
    it("skips fetch when discovery store shows conversation already exported with same updateTime", async () => {
      // Discovery store returns a record with status 'exported' and matching updateTime
      (mockDiscoveryStore.getConversation as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "conv-1",
        title: "Test Conversation",
        updateTime: 1700000000,
        gizmoId: null,
        status: "exported",
        exportedAt: 1700000100,
      });

      const item = makePendingItem({ id: "conv-1", update_time: 1700000000 });
      const signal = new AbortController().signal;

      const worker = buildWorker();
      await worker(item, signal);

      // No network call should be made
      expect(mockNet.fetchJson).not.toHaveBeenCalled();
      // No blob storage
      expect(mockExportBlobStore.putConv).not.toHaveBeenCalled();
      // No events emitted
      expect(mockEventBus.emitted).toHaveLength(0);
      // No progress update
      expect(mockProgress.exported).toEqual({});
    });

    it("proceeds with fetch when discovery store shows conversation exported but updateTime differs", async () => {
      // Discovery store returns 'exported' but with a different updateTime (conversation was updated)
      (mockDiscoveryStore.getConversation as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "conv-1",
        title: "Test Conversation",
        updateTime: 1699999999,
        gizmoId: null,
        status: "exported",
        exportedAt: 1700000100,
      });

      const convJson = makeConversationJson();
      mockNet.fetchJson.mockResolvedValue(convJson);
      mockExtractFileRefs.mockReturnValue([]);

      const item = makePendingItem({ id: "conv-1", update_time: 1700000000 });
      const signal = new AbortController().signal;

      const worker = buildWorker();
      await worker(item, signal);

      // Should proceed with fetch since updateTime differs
      expect(mockNet.fetchJson).toHaveBeenCalledOnce();
      expect(mockExportBlobStore.putConv).toHaveBeenCalled();
    });

    it("proceeds with fetch when discovery store shows conversation with status 'new'", async () => {
      (mockDiscoveryStore.getConversation as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "conv-1",
        title: "Test Conversation",
        updateTime: 1700000000,
        gizmoId: null,
        status: "new",
        exportedAt: null,
      });

      const convJson = makeConversationJson();
      mockNet.fetchJson.mockResolvedValue(convJson);
      mockExtractFileRefs.mockReturnValue([]);

      const item = makePendingItem({ id: "conv-1", update_time: 1700000000 });
      const signal = new AbortController().signal;

      const worker = buildWorker();
      await worker(item, signal);

      // Should proceed since status is 'new', not 'exported'
      expect(mockNet.fetchJson).toHaveBeenCalledOnce();
    });

    it("proceeds with fetch when discovery store returns null (no record)", async () => {
      // Default mock returns null
      const convJson = makeConversationJson();
      mockNet.fetchJson.mockResolvedValue(convJson);
      mockExtractFileRefs.mockReturnValue([]);

      const item = makePendingItem({ id: "conv-1", update_time: 1700000000 });
      const signal = new AbortController().signal;

      const worker = buildWorker();
      await worker(item, signal);

      // Should proceed since no record exists
      expect(mockNet.fetchJson).toHaveBeenCalledOnce();
    });
  });
});
