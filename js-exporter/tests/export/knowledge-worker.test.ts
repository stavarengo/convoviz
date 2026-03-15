import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeFileItem } from "../../src/export/knowledge-worker";

const makeKnowledgeFileItem = (
  overrides: Partial<KnowledgeFileItem> = {},
): KnowledgeFileItem => ({
  id: "file-abc",
  projectId: "proj-1",
  projectName: "My GPT",
  fileId: "file-abc",
  fileName: "data.csv",
  fileType: "text/csv",
  fileSize: 1024,
  ...overrides,
});

describe("createKnowledgeWorker", () => {
  let mockNet: {
    fetchJson: ReturnType<typeof vi.fn>;
    fetchBlob: ReturnType<typeof vi.fn>;
  };
  let mockExportBlobStore: {
    putFile: ReturnType<typeof vi.fn>;
  };
  let mockProjects: Array<{
    gizmoId: string;
    name: string;
    raw: unknown;
  }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNet = {
      fetchJson: vi.fn(),
      fetchBlob: vi.fn(),
    };
    mockExportBlobStore = {
      putFile: vi.fn().mockResolvedValue(undefined),
    };
    mockProjects = [
      { gizmoId: "proj-1", name: "My GPT", raw: { id: "proj-1", title: "My GPT" } },
    ];
  });

  const buildWorker = async () => {
    const { createKnowledgeWorker } = await import(
      "../../src/export/knowledge-worker"
    );
    return createKnowledgeWorker({
      net: mockNet,
      exportBlobStore: mockExportBlobStore,
      projects: mockProjects,
    });
  };

  describe("success path: metadata + blob + stored", () => {
    it("fetches metadata, downloads blob, stores to IDB with kf/ prefix", async () => {
      const meta = {
        status: "success",
        download_url: "https://files.oaiusercontent.com/kf-123",
      };
      const blob = new Blob(["csv data"], { type: "text/csv" });
      mockNet.fetchJson.mockResolvedValue(meta);
      mockNet.fetchBlob.mockResolvedValue(blob);

      const item = makeKnowledgeFileItem();
      const signal = new AbortController().signal;
      const worker = await buildWorker();
      await worker(item, signal);

      // Verify metadata fetched with correct URL
      expect(mockNet.fetchJson).toHaveBeenCalledWith(
        "/backend-api/files/download/file-abc?gizmo_id=proj-1&inline=false",
        { signal, auth: true },
      );

      // Verify blob downloaded
      expect(mockNet.fetchBlob).toHaveBeenCalledWith(
        "https://files.oaiusercontent.com/kf-123",
        expect.objectContaining({ signal, auth: false }),
      );

      // Verify stored at kf/{sanitizedProjectName}/{sanitizedFileName}
      expect(mockExportBlobStore.putFile).toHaveBeenCalledWith(
        "kf/My GPT/data.csv",
        blob,
      );
    });

    it("stores project.json for the project", async () => {
      const meta = {
        status: "success",
        download_url: "https://files.oaiusercontent.com/kf-123",
      };
      const blob = new Blob(["csv data"], { type: "text/csv" });
      mockNet.fetchJson.mockResolvedValue(meta);
      mockNet.fetchBlob.mockResolvedValue(blob);

      const item = makeKnowledgeFileItem();
      const signal = new AbortController().signal;
      const worker = await buildWorker();
      await worker(item, signal);

      // Verify project.json was written
      const calls = mockExportBlobStore.putFile.mock.calls;
      const projectJsonCall = calls.find(
        (c: [string, Blob]) => c[0] === "kf/My GPT/project.json",
      );
      expect(projectJsonCall).toBeDefined();

      // Verify it contains the project raw data
      const projBlob = projectJsonCall![1] as Blob;
      const text = await projBlob.text();
      expect(JSON.parse(text)).toEqual({ id: "proj-1", title: "My GPT" });
    });
  });

  describe("project.json idempotent write", () => {
    it("writes project.json on every call (idempotent, same data each time)", async () => {
      const meta = {
        status: "success",
        download_url: "https://files.oaiusercontent.com/kf-123",
      };
      const blob = new Blob(["csv data"], { type: "text/csv" });
      mockNet.fetchJson.mockResolvedValue(meta);
      mockNet.fetchBlob.mockResolvedValue(blob);

      const worker = await buildWorker();
      const signal = new AbortController().signal;

      // Call twice for different files from the same project
      await worker(makeKnowledgeFileItem({ id: "file-1", fileId: "file-1", fileName: "a.csv" }), signal);
      await worker(makeKnowledgeFileItem({ id: "file-2", fileId: "file-2", fileName: "b.csv" }), signal);

      // project.json should be written twice (idempotent)
      const projectJsonCalls = mockExportBlobStore.putFile.mock.calls.filter(
        (c: [string, Blob]) => c[0] === "kf/My GPT/project.json",
      );
      expect(projectJsonCalls).toHaveLength(2);
    });
  });

  describe("file_not_found immediate dead-letter", () => {
    it("throws FileNotFoundError when response indicates file_not_found", async () => {
      mockNet.fetchJson.mockResolvedValue({
        status: "error",
        error_code: "file_not_found",
      });

      const item = makeKnowledgeFileItem();
      const signal = new AbortController().signal;
      const worker = await buildWorker();

      const err = await worker(item, signal).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/file_not_found/i);

      // The error should have a property indicating immediate dead-letter
      expect((err as any).immediateDeadLetter).toBe(true);

      // No blob download should have happened
      expect(mockNet.fetchBlob).not.toHaveBeenCalled();
      expect(mockExportBlobStore.putFile).not.toHaveBeenCalled();
    });
  });

  describe("network error retry", () => {
    it("propagates errors from metadata fetch", async () => {
      mockNet.fetchJson.mockRejectedValue(new Error("HTTP 500"));

      const item = makeKnowledgeFileItem();
      const signal = new AbortController().signal;
      const worker = await buildWorker();

      await expect(worker(item, signal)).rejects.toThrow("HTTP 500");
      expect(mockNet.fetchBlob).not.toHaveBeenCalled();
      expect(mockExportBlobStore.putFile).not.toHaveBeenCalled();
    });

    it("propagates errors from blob download", async () => {
      mockNet.fetchJson.mockResolvedValue({
        status: "success",
        download_url: "https://cdn.example.com/file",
      });
      mockNet.fetchBlob.mockRejectedValue(new Error("Connection reset"));

      const item = makeKnowledgeFileItem();
      const signal = new AbortController().signal;
      const worker = await buildWorker();

      await expect(worker(item, signal)).rejects.toThrow("Connection reset");
      expect(mockExportBlobStore.putFile).not.toHaveBeenCalled();
    });
  });

  describe("no download_url in success response", () => {
    it("throws when metadata response lacks download_url", async () => {
      mockNet.fetchJson.mockResolvedValue({
        status: "success",
      });

      const item = makeKnowledgeFileItem();
      const signal = new AbortController().signal;
      const worker = await buildWorker();

      await expect(worker(item, signal)).rejects.toThrow(
        /no download_url/i,
      );

      expect(mockNet.fetchBlob).not.toHaveBeenCalled();
      expect(mockExportBlobStore.putFile).not.toHaveBeenCalled();
    });
  });

  describe("project not found in projects list", () => {
    it("skips project.json if project is not in the projects list", async () => {
      mockProjects.length = 0; // empty projects list

      const meta = {
        status: "success",
        download_url: "https://files.oaiusercontent.com/kf-123",
      };
      const blob = new Blob(["data"], { type: "text/csv" });
      mockNet.fetchJson.mockResolvedValue(meta);
      mockNet.fetchBlob.mockResolvedValue(blob);

      const item = makeKnowledgeFileItem();
      const signal = new AbortController().signal;
      const worker = await buildWorker();
      await worker(item, signal);

      // File blob should still be stored
      const fileCalls = mockExportBlobStore.putFile.mock.calls.filter(
        (c: [string, Blob]) => !c[0].endsWith("project.json"),
      );
      expect(fileCalls).toHaveLength(1);

      // No project.json call
      const projCalls = mockExportBlobStore.putFile.mock.calls.filter(
        (c: [string, Blob]) => c[0].endsWith("project.json"),
      );
      expect(projCalls).toHaveLength(0);
    });
  });
});
