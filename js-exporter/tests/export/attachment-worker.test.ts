import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AttachmentItem } from "../../src/export/attachment-worker";

const makeAttachmentItem = (
  overrides: Partial<AttachmentItem> = {},
): AttachmentItem => ({
  id: "file-1",
  name: "report.pdf",
  conversationId: "conv-1",
  conversationTitle: "My Chat",
  ...overrides,
});

describe("createAttachmentWorker", () => {
  let mockNet: {
    fetchJson: ReturnType<typeof vi.fn>;
    fetchBlob: ReturnType<typeof vi.fn>;
  };
  let mockExportBlobStore: {
    putFile: ReturnType<typeof vi.fn>;
    putFileMeta: ReturnType<typeof vi.fn>;
    hasFilePrefix: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNet = {
      fetchJson: vi.fn(),
      fetchBlob: vi.fn(),
    };
    mockExportBlobStore = {
      putFile: vi.fn().mockResolvedValue(undefined),
      putFileMeta: vi.fn().mockResolvedValue(undefined),
      hasFilePrefix: vi.fn().mockResolvedValue(false),
    };
  });

  // Lazy import so the module can be created after tests are defined
  const buildWorker = async () => {
    const { createAttachmentWorker } = await import(
      "../../src/export/attachment-worker"
    );
    return createAttachmentWorker({
      net: mockNet,
      exportBlobStore: mockExportBlobStore,
    });
  };

  describe("success path: metadata fetched + blob downloaded + stored", () => {
    it("fetches metadata, downloads blob, computes filename with name, stores to IDB", async () => {
      const meta = {
        download_url: "https://files.oaiusercontent.com/abc123",
      };
      const blob = new Blob(["file content"], { type: "application/pdf" });
      mockNet.fetchJson.mockResolvedValue(meta);
      mockNet.fetchBlob.mockResolvedValue(blob);

      const item = makeAttachmentItem({
        id: "file-1",
        name: "report.pdf",
      });
      const signal = new AbortController().signal;
      const worker = await buildWorker();
      await worker(item, signal);

      // Verify dedup check
      expect(mockExportBlobStore.hasFilePrefix).toHaveBeenCalledWith("file-1");

      // Verify metadata fetched
      expect(mockNet.fetchJson).toHaveBeenCalledWith(
        "/backend-api/files/download/file-1",
        { signal, auth: true },
      );

      // Verify blob downloaded with correct credentials (different origin)
      expect(mockNet.fetchBlob).toHaveBeenCalledWith(
        "https://files.oaiusercontent.com/abc123",
        { signal, auth: false, credentials: "omit" },
      );

      // Verify stored with filename: {id}_{sanitizedName}
      expect(mockExportBlobStore.putFile).toHaveBeenCalledWith(
        "file-1_report.pdf",
        blob,
      );
    });

    it("computes filename with extension from blob type when name is null", async () => {
      const meta = {
        download_url: "/download/internal-file",
      };
      const blob = new Blob(["img data"], { type: "image/png" });
      mockNet.fetchJson.mockResolvedValue(meta);
      mockNet.fetchBlob.mockResolvedValue(blob);

      const item = makeAttachmentItem({
        id: "file-2",
        name: null,
      });
      const signal = new AbortController().signal;
      const worker = await buildWorker();
      await worker(item, signal);

      // Same-origin URL -> credentials: "same-origin"
      expect(mockNet.fetchBlob).toHaveBeenCalledWith(
        "/download/internal-file",
        { signal, auth: false, credentials: "same-origin" },
      );

      // Filename: {id}.{ext from blob type}
      expect(mockExportBlobStore.putFile).toHaveBeenCalledWith(
        "file-2.png",
        blob,
      );
    });

    it("falls back to 'bin' extension when blob has no type", async () => {
      const meta = {
        download_url: "https://cdn.example.com/data",
      };
      const blob = new Blob(["raw data"]);
      mockNet.fetchJson.mockResolvedValue(meta);
      mockNet.fetchBlob.mockResolvedValue(blob);

      const item = makeAttachmentItem({
        id: "file-3",
        name: null,
      });
      const signal = new AbortController().signal;
      const worker = await buildWorker();
      await worker(item, signal);

      expect(mockExportBlobStore.putFile).toHaveBeenCalledWith(
        "file-3.bin",
        blob,
      );
    });
  });

  describe("file metadata: writes type and conversationId", () => {
    it("writes attachment metadata entry alongside the file blob", async () => {
      const meta = {
        download_url: "https://files.oaiusercontent.com/abc123",
      };
      const blob = new Blob(["file content"], { type: "application/pdf" });
      mockNet.fetchJson.mockResolvedValue(meta);
      mockNet.fetchBlob.mockResolvedValue(blob);

      const item = makeAttachmentItem({
        id: "file-1",
        name: "report.pdf",
        conversationId: "conv-42",
      });
      const signal = new AbortController().signal;
      const worker = await buildWorker();
      await worker(item, signal);

      expect(mockExportBlobStore.putFileMeta).toHaveBeenCalledWith({
        key: "file-1_report.pdf",
        type: "attachment",
        conversationId: "conv-42",
      });
    });

    it("does not write metadata when file is skipped by dedup", async () => {
      mockExportBlobStore.hasFilePrefix.mockResolvedValue(true);

      const item = makeAttachmentItem({ id: "file-1" });
      const signal = new AbortController().signal;
      const worker = await buildWorker();
      await worker(item, signal);

      expect(mockExportBlobStore.putFileMeta).not.toHaveBeenCalled();
    });
  });

  describe("dedup skip: file already in IDB", () => {
    it("skips download when file key already exists in blob store", async () => {
      mockExportBlobStore.hasFilePrefix.mockResolvedValue(true);

      const item = makeAttachmentItem({ id: "file-1" });
      const signal = new AbortController().signal;
      const worker = await buildWorker();
      await worker(item, signal);

      // Dedup check was performed
      expect(mockExportBlobStore.hasFilePrefix).toHaveBeenCalledWith("file-1");

      // No network calls should be made
      expect(mockNet.fetchJson).not.toHaveBeenCalled();
      expect(mockNet.fetchBlob).not.toHaveBeenCalled();
      expect(mockExportBlobStore.putFile).not.toHaveBeenCalled();
    });
  });

  describe("missing download_url error", () => {
    it("throws a descriptive error when metadata has no download_url", async () => {
      mockNet.fetchJson.mockResolvedValue({ status: "pending" });

      const item = makeAttachmentItem({ id: "file-4" });
      const signal = new AbortController().signal;
      const worker = await buildWorker();

      await expect(worker(item, signal)).rejects.toThrow(
        /no download_url/i,
      );

      // No blob download or storage should have happened
      expect(mockNet.fetchBlob).not.toHaveBeenCalled();
      expect(mockExportBlobStore.putFile).not.toHaveBeenCalled();
    });
  });

  describe("network error propagation", () => {
    it("propagates errors from metadata fetch", async () => {
      mockNet.fetchJson.mockRejectedValue(new Error("HTTP 500"));

      const item = makeAttachmentItem();
      const signal = new AbortController().signal;
      const worker = await buildWorker();

      await expect(worker(item, signal)).rejects.toThrow("HTTP 500");
      expect(mockNet.fetchBlob).not.toHaveBeenCalled();
      expect(mockExportBlobStore.putFile).not.toHaveBeenCalled();
    });

    it("propagates errors from blob download", async () => {
      mockNet.fetchJson.mockResolvedValue({
        download_url: "https://cdn.example.com/file",
      });
      mockNet.fetchBlob.mockRejectedValue(new Error("Connection reset"));

      const item = makeAttachmentItem();
      const signal = new AbortController().signal;
      const worker = await buildWorker();

      await expect(worker(item, signal)).rejects.toThrow("Connection reset");
      expect(mockExportBlobStore.putFile).not.toHaveBeenCalled();
    });
  });
});
