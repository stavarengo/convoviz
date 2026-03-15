import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PendingItem, FileRef } from "../../src/types";
import type { AttachmentItem } from "../../src/export/attachment-worker";
import type { Queue } from "../../src/export/queue";
import { createChatWorker } from "../../src/export/chat-worker";

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

describe("createChatWorker", () => {
  let mockNet: { fetchJson: ReturnType<typeof vi.fn> };
  let mockExportBlobStore: { putConv: ReturnType<typeof vi.fn> };
  let mockAttachmentQueue: { enqueue: ReturnType<typeof vi.fn> };
  let mockProgress: { exported: Record<string, number> };
  let mockExtractFileRefs: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNet = {
      fetchJson: vi.fn(),
    };
    mockExportBlobStore = {
      putConv: vi.fn().mockResolvedValue(undefined),
    };
    mockAttachmentQueue = {
      enqueue: vi.fn(),
    };
    mockProgress = {
      exported: {},
    };
    mockExtractFileRefs = vi.fn();
  });

  const buildWorker = () =>
    createChatWorker({
      net: mockNet,
      exportBlobStore: mockExportBlobStore,
      attachmentQueue: mockAttachmentQueue as unknown as Queue<AttachmentItem>,
      progress: mockProgress,
      extractFileRefs: mockExtractFileRefs,
    });

  describe("success path: JSON fetched + file refs extracted + pushed to attachment queue + stored to IDB", () => {
    it("fetches conversation, extracts file refs, enqueues attachments, and stores JSON", async () => {
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

      // Verify attachment items were enqueued
      expect(mockAttachmentQueue.enqueue).toHaveBeenCalledTimes(1);
      const enqueuedItems = mockAttachmentQueue.enqueue.mock.calls[0][0] as AttachmentItem[];
      expect(enqueuedItems).toHaveLength(2);
      expect(enqueuedItems[0]).toEqual({
        id: "file-1",
        name: "report.pdf",
        conversationId: "conv-1",
        conversationTitle: "My Chat",
      });
      expect(enqueuedItems[1]).toEqual({
        id: "file-2",
        name: null,
        conversationId: "conv-1",
        conversationTitle: "My Chat",
      });

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
    it("stores conversation but does not enqueue any attachments", async () => {
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

      // No attachments should be enqueued
      expect(mockAttachmentQueue.enqueue).not.toHaveBeenCalled();

      // Progress updated
      expect(mockProgress.exported["conv-2"]).toBe(1700000000);
    });
  });

  describe("network error propagation", () => {
    it("propagates network errors from fetchJson", async () => {
      mockNet.fetchJson.mockRejectedValue(new Error("Network timeout"));

      const item = makePendingItem();
      const signal = new AbortController().signal;

      const worker = buildWorker();
      await expect(worker(item, signal)).rejects.toThrow("Network timeout");

      // Nothing stored or enqueued on error
      expect(mockExportBlobStore.putConv).not.toHaveBeenCalled();
      expect(mockAttachmentQueue.enqueue).not.toHaveBeenCalled();
    });
  });
});
