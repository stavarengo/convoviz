// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

describe("ExportBlobStore", () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clear the shared fake-indexeddb database between tests
    const mod = await import("../../src/state/export-blobs");
    await mod.initExportBlobsIdb();
    await mod.ExportBlobStore.clear();
    vi.resetModules();
  });

  it("initExportBlobsIdb opens the database successfully", async () => {
    const { initExportBlobsIdb } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
  });

  it("putConv stores a conversation and getAllConvKeys retrieves its key", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    await ExportBlobStore.putConv("conv-1", '{"id":"conv-1"}');
    const keys = await ExportBlobStore.getAllConvKeys();
    expect(keys).toEqual(["conv-1"]);
  });

  it("putConv overwrites existing entry with same key", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    await ExportBlobStore.putConv("conv-1", '{"v":1}');
    await ExportBlobStore.putConv("conv-1", '{"v":2}');
    const keys = await ExportBlobStore.getAllConvKeys();
    expect(keys).toEqual(["conv-1"]);
  });

  it("putFile stores a file blob", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    const blob = new Blob(["hello"], { type: "text/plain" });
    await ExportBlobStore.putFile("file-abc.png", blob);
    // Verify via totalSize that the file is stored
    const size = await ExportBlobStore.totalSize();
    expect(size).toBeGreaterThan(0);
  });

  it("iterateConvs yields all stored conversations via cursor", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    await ExportBlobStore.putConv("a", '{"id":"a"}');
    await ExportBlobStore.putConv("b", '{"id":"b"}');
    await ExportBlobStore.putConv("c", '{"id":"c"}');

    const collected: Array<{ key: string; value: string }> = [];
    await ExportBlobStore.iterateConvs((key, value) => {
      collected.push({ key, value });
    });
    expect(collected).toHaveLength(3);
    const keys = collected.map((c) => c.key).sort();
    expect(keys).toEqual(["a", "b", "c"]);
  });

  it("iterateFiles yields all stored files via cursor", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    await ExportBlobStore.putFile("img.png", new Blob(["png-data"]));
    await ExportBlobStore.putFile(
      "kf/project/doc.pdf",
      new Blob(["pdf-data"]),
    );

    const collected: Array<{ key: string }> = [];
    await ExportBlobStore.iterateFiles((key) => {
      collected.push({ key });
    });
    expect(collected).toHaveLength(2);
    const keys = collected.map((c) => c.key).sort();
    expect(keys).toEqual(["img.png", "kf/project/doc.pdf"]);
  });

  it("totalSize sums sizes across both conv and files stores", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();

    const convJson = '{"id":"conv-1","data":"some content"}';
    await ExportBlobStore.putConv("conv-1", convJson);

    // Verify conv-only size matches
    const convOnlySize = await ExportBlobStore.totalSize();
    expect(convOnlySize).toBe(new Blob([convJson]).size);

    // Add a file and verify total is larger
    await ExportBlobStore.putFile(
      "file.png",
      new Blob(["file-binary-content"]),
    );

    const totalSize = await ExportBlobStore.totalSize();
    expect(totalSize).toBeGreaterThan(convOnlySize);
  });

  it("totalSize returns 0 when both stores are empty", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    const size = await ExportBlobStore.totalSize();
    expect(size).toBe(0);
  });

  it("destroy closes connection and calls deleteDatabase", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    await ExportBlobStore.putConv("conv-1", '{"id":"conv-1"}');
    const deleteSpy = vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(
      () => {
        const req = {} as IDBOpenDBRequest;
        setTimeout(() => req.onsuccess?.({} as Event), 0);
        return req;
      },
    );
    await ExportBlobStore.destroy();
    expect(deleteSpy).toHaveBeenCalledWith("cvz-export-blobs");
    // After destroy, methods are no-ops (db is null)
    const keys = await ExportBlobStore.getAllConvKeys();
    expect(keys).toEqual([]);
    deleteSpy.mockRestore();
  });

  it("destroy is a no-op when db is not initialized", async () => {
    const { ExportBlobStore } = await import("../../src/state/export-blobs");
    await ExportBlobStore.destroy(); // should not throw
  });

  it("clear removes all data from both stores", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    await ExportBlobStore.putConv("conv-1", '{"id":"conv-1"}');
    await ExportBlobStore.putFile("file.png", new Blob(["data"]));

    await ExportBlobStore.clear();

    const keys = await ExportBlobStore.getAllConvKeys();
    expect(keys).toEqual([]);
    const size = await ExportBlobStore.totalSize();
    expect(size).toBe(0);
  });

  it("iterateConvs on empty store completes without calling callback", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    const cb = vi.fn();
    await ExportBlobStore.iterateConvs(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it("iterateFiles on empty store completes without calling callback", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    const cb = vi.fn();
    await ExportBlobStore.iterateFiles(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it("methods are no-ops when initExportBlobsIdb was not called", async () => {
    const { ExportBlobStore } = await import("../../src/state/export-blobs");
    // All methods should not throw when db is not initialized
    await ExportBlobStore.putConv("x", "{}");
    await ExportBlobStore.putFile("x", new Blob([""]));
    const keys = await ExportBlobStore.getAllConvKeys();
    expect(keys).toEqual([]);
    const cb = vi.fn();
    await ExportBlobStore.iterateConvs(cb);
    expect(cb).not.toHaveBeenCalled();
    await ExportBlobStore.iterateFiles(cb);
    expect(cb).not.toHaveBeenCalled();
    const size = await ExportBlobStore.totalSize();
    expect(size).toBe(0);
    await ExportBlobStore.clear(); // should not throw
  });

  it("hasFilePrefix returns true when a key starts with prefix", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    await ExportBlobStore.putFile("abc123_readme.txt", new Blob(["data"]));
    const exists = await ExportBlobStore.hasFilePrefix("abc123");
    expect(exists).toBe(true);
  });

  it("hasFilePrefix returns false when no key starts with prefix", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    await ExportBlobStore.putFile("xyz_readme.txt", new Blob(["data"]));
    const exists = await ExportBlobStore.hasFilePrefix("abc123");
    expect(exists).toBe(false);
  });

  it("hasFilePrefix returns false when db is not initialized", async () => {
    const { ExportBlobStore } = await import("../../src/state/export-blobs");
    const exists = await ExportBlobStore.hasFilePrefix("abc123");
    expect(exists).toBe(false);
  });

  it("getAllConvKeys returns multiple keys in sorted order", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    await initExportBlobsIdb();
    await ExportBlobStore.putConv("z-conv", "{}");
    await ExportBlobStore.putConv("a-conv", "{}");
    await ExportBlobStore.putConv("m-conv", "{}");
    const keys = await ExportBlobStore.getAllConvKeys();
    // IDB keys are returned in ascending order by default
    expect(keys).toEqual(["a-conv", "m-conv", "z-conv"]);
  });

  describe("file metadata", () => {
    it("putFileMeta stores and getFileMeta retrieves metadata for a file", async () => {
      const { initExportBlobsIdb, ExportBlobStore } = await import(
        "../../src/state/export-blobs"
      );
      await initExportBlobsIdb();
      await ExportBlobStore.putFileMeta({
        key: "file-abc_report.pdf",
        type: "attachment",
        conversationId: "conv-1",
      });
      const meta = await ExportBlobStore.getFileMeta("file-abc_report.pdf");
      expect(meta).toEqual({
        key: "file-abc_report.pdf",
        type: "attachment",
        conversationId: "conv-1",
      });
    });

    it("getFileMeta returns null for non-existent key", async () => {
      const { initExportBlobsIdb, ExportBlobStore } = await import(
        "../../src/state/export-blobs"
      );
      await initExportBlobsIdb();
      const meta = await ExportBlobStore.getFileMeta("nonexistent");
      expect(meta).toBeNull();
    });

    it("stores knowledge-file metadata with projectName", async () => {
      const { initExportBlobsIdb, ExportBlobStore } = await import(
        "../../src/state/export-blobs"
      );
      await initExportBlobsIdb();
      await ExportBlobStore.putFileMeta({
        key: "kf/My GPT/data.csv",
        type: "knowledge-file",
        projectName: "My GPT",
      });
      const meta = await ExportBlobStore.getFileMeta("kf/My GPT/data.csv");
      expect(meta).toEqual({
        key: "kf/My GPT/data.csv",
        type: "knowledge-file",
        projectName: "My GPT",
      });
    });

    it("iterateFileMeta yields all stored metadata entries", async () => {
      const { initExportBlobsIdb, ExportBlobStore } = await import(
        "../../src/state/export-blobs"
      );
      await initExportBlobsIdb();
      await ExportBlobStore.putFileMeta({
        key: "file-1.png",
        type: "attachment",
        conversationId: "conv-1",
      });
      await ExportBlobStore.putFileMeta({
        key: "kf/Proj/doc.pdf",
        type: "knowledge-file",
        projectName: "Proj",
      });

      const collected: Array<{ key: string; type: string }> = [];
      await ExportBlobStore.iterateFileMeta((meta) => {
        collected.push({ key: meta.key, type: meta.type });
      });
      expect(collected).toHaveLength(2);
      const keys = collected.map((c) => c.key).sort();
      expect(keys).toEqual(["file-1.png", "kf/Proj/doc.pdf"]);
    });

    it("clear removes file metadata along with other stores", async () => {
      const { initExportBlobsIdb, ExportBlobStore } = await import(
        "../../src/state/export-blobs"
      );
      await initExportBlobsIdb();
      await ExportBlobStore.putFileMeta({
        key: "file-1.png",
        type: "attachment",
        conversationId: "conv-1",
      });
      await ExportBlobStore.clear();
      const meta = await ExportBlobStore.getFileMeta("file-1.png");
      expect(meta).toBeNull();
    });

    it("putFileMeta and getFileMeta are no-ops when db is not initialized", async () => {
      const { ExportBlobStore } = await import("../../src/state/export-blobs");
      await ExportBlobStore.putFileMeta({
        key: "file-1.png",
        type: "attachment",
        conversationId: "conv-1",
      });
      const meta = await ExportBlobStore.getFileMeta("file-1.png");
      expect(meta).toBeNull();
    });
  });
});
