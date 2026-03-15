// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";

/** Read a little-endian u16 from a buffer at offset. */
const readU16 = (buf: Uint8Array, off: number): number =>
  buf[off] | (buf[off + 1] << 8);

/** Read a little-endian u32 from a buffer at offset. */
const readU32 = (buf: Uint8Array, off: number): number =>
  (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;

/** Collect all chunks written to a WritableStream into a single Uint8Array. */
const collectStream = (): {
  writable: WritableStream<Uint8Array>;
  result: () => Uint8Array;
} => {
  const chunks: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(new Uint8Array(chunk));
    },
  });
  return {
    writable,
    result: () => {
      let totalLen = 0;
      for (const c of chunks) totalLen += c.length;
      const out = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    },
  };
};

/** Find all local file header names in a ZIP buffer. */
const findEntryNames = (buf: Uint8Array): string[] => {
  const names: string[] = [];
  let off = 0;
  const decoder = new TextDecoder();
  while (off + 30 <= buf.length) {
    if (readU32(buf, off) !== 0x04034b50) break;
    const nameLen = readU16(buf, off + 26);
    const extraLen = readU16(buf, off + 28);
    const name = decoder.decode(buf.slice(off + 30, off + 30 + nameLen));
    names.push(name);

    // Check bit 3 for data descriptor
    const flags = readU16(buf, off + 6);
    const hasDataDescriptor = !!(flags & 0x0008);

    let compressedSize: number;
    if (hasDataDescriptor) {
      // Size is in data descriptor after the file data, not in the local header
      // We need to find the central directory to get the actual size
      // For simplicity, scan for the next local header or central directory
      // Actually, the data descriptor is right after the file data
      // but we don't know the size from the local header (it's 0)
      // We'll use the central directory to figure out sizes
      // For test purposes, just skip ahead using the EOCD info
      compressedSize = readU32(buf, off + 18); // 0 for data descriptor entries
    } else {
      compressedSize = readU32(buf, off + 18);
    }

    if (hasDataDescriptor) {
      // Need to find actual data length. Look for data descriptor signature after data.
      // The data follows immediately after the header. Search for descriptor signature.
      let dataStart = off + 30 + nameLen + extraLen;
      let descOff = dataStart;
      while (descOff + 16 <= buf.length) {
        if (readU32(buf, descOff) === 0x08074b50) {
          const descSize = readU32(buf, descOff + 8);
          if (descOff - dataStart === descSize) {
            off = descOff + 16;
            break;
          }
        }
        descOff++;
      }
      if (descOff + 16 > buf.length) break;
    } else {
      off += 30 + nameLen + extraLen + compressedSize;
    }
  }
  return names;
};

/** Extract a JSON entry from the ZIP by name. Skips data descriptor entries for simplicity. */
const extractJsonEntry = (buf: Uint8Array, targetName: string): unknown => {
  let off = 0;
  const decoder = new TextDecoder();
  while (off + 30 <= buf.length) {
    if (readU32(buf, off) !== 0x04034b50) break;
    const nameLen = readU16(buf, off + 26);
    const extraLen = readU16(buf, off + 28);
    const name = decoder.decode(buf.slice(off + 30, off + 30 + nameLen));
    const flags = readU16(buf, off + 6);
    const hasDataDescriptor = !!(flags & 0x0008);

    const dataStart = off + 30 + nameLen + extraLen;

    if (hasDataDescriptor) {
      // Search for data descriptor
      let descOff = dataStart;
      while (descOff + 16 <= buf.length) {
        if (readU32(buf, descOff) === 0x08074b50) {
          const descSize = readU32(buf, descOff + 8);
          if (descOff - dataStart === descSize) {
            if (name === targetName) {
              const data = buf.slice(dataStart, descOff);
              return JSON.parse(decoder.decode(data));
            }
            off = descOff + 16;
            break;
          }
        }
        descOff++;
      }
      if (descOff + 16 > buf.length) break;
    } else {
      const compressedSize = readU32(buf, off + 18);
      if (name === targetName) {
        const data = buf.slice(dataStart, dataStart + compressedSize);
        return JSON.parse(decoder.decode(data));
      }
      off += 30 + nameLen + extraLen + compressedSize;
    }
  }
  throw new Error(`Entry "${targetName}" not found in ZIP`);
};

describe("generateFinalZip", () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../src/state/export-blobs");
    await mod.initExportBlobsIdb();
    await mod.ExportBlobStore.clear();
    vi.resetModules();
  });

  it("generates a valid ZIP with conversations-NNN.json from IDB conv store", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { generateFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    // Store 3 conversations
    await ExportBlobStore.putConv("c1", JSON.stringify({ id: "c1", title: "Chat 1" }));
    await ExportBlobStore.putConv("c2", JSON.stringify({ id: "c2", title: "Chat 2" }));
    await ExportBlobStore.putConv("c3", JSON.stringify({ id: "c3", title: "Chat 3" }));

    const { writable, result } = collectStream();
    await generateFinalZip({
      exportBlobStore: ExportBlobStore,
      getWritableStream: async () => writable,
    });

    const buf = result();
    const names = findEntryNames(buf);

    // 3 conversations fit in one batch of 100 -> conversations-001.json
    expect(names).toContain("conversations-001.json");

    // Extract and verify the JSON content
    const convData = extractJsonEntry(buf, "conversations-001.json") as unknown[];
    expect(convData).toHaveLength(3);
    const ids = convData.map((c: any) => c.id).sort();
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });

  it("splits conversations into batches of 100", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { generateFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    // Store 250 conversations
    for (let i = 1; i <= 250; i++) {
      await ExportBlobStore.putConv(
        `conv-${String(i).padStart(3, "0")}`,
        JSON.stringify({ id: `conv-${i}`, title: `Chat ${i}` }),
      );
    }

    const { writable, result } = collectStream();
    await generateFinalZip({
      exportBlobStore: ExportBlobStore,
      getWritableStream: async () => writable,
    });

    const buf = result();
    const names = findEntryNames(buf);

    // 250 convs -> 3 files: 001 (100), 002 (100), 003 (50)
    expect(names).toContain("conversations-001.json");
    expect(names).toContain("conversations-002.json");
    expect(names).toContain("conversations-003.json");
    expect(names).not.toContain("conversations-004.json");

    // Verify counts
    const batch1 = extractJsonEntry(buf, "conversations-001.json") as unknown[];
    const batch2 = extractJsonEntry(buf, "conversations-002.json") as unknown[];
    const batch3 = extractJsonEntry(buf, "conversations-003.json") as unknown[];
    expect(batch1).toHaveLength(100);
    expect(batch2).toHaveLength(100);
    expect(batch3).toHaveLength(50);
  });

  it("includes files from the files store with their IDB key as zip path", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { generateFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    await ExportBlobStore.putConv("c1", JSON.stringify({ id: "c1" }));
    await ExportBlobStore.putFile("file-abc123.png", new Blob(["png-data"]));
    await ExportBlobStore.putFile("kf/MyProject/doc.pdf", new Blob(["pdf-data"]));

    const { writable, result } = collectStream();
    await generateFinalZip({
      exportBlobStore: ExportBlobStore,
      getWritableStream: async () => writable,
    });

    const buf = result();
    const names = findEntryNames(buf);

    expect(names).toContain("conversations-001.json");
    expect(names).toContain("file-abc123.png");
    expect(names).toContain("kf/MyProject/doc.pdf");
  });

  it("generates valid ZIP with correct EOCD entry count", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { generateFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    await ExportBlobStore.putConv("c1", JSON.stringify({ id: "c1" }));
    await ExportBlobStore.putConv("c2", JSON.stringify({ id: "c2" }));
    await ExportBlobStore.putFile("img.png", new Blob(["data"]));

    const { writable, result } = collectStream();
    await generateFinalZip({
      exportBlobStore: ExportBlobStore,
      getWritableStream: async () => writable,
    });

    const buf = result();
    const eocdOffset = buf.length - 22;
    expect(readU32(buf, eocdOffset)).toBe(0x06054b50);

    // 1 conversations JSON file + 1 asset file = 2 entries
    expect(readU16(buf, eocdOffset + 8)).toBe(2);
    expect(readU16(buf, eocdOffset + 10)).toBe(2);
  });

  it("uses 3-digit zero-padded filenames (1-indexed)", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { generateFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    await ExportBlobStore.putConv("c1", JSON.stringify({ id: "c1" }));

    const { writable, result } = collectStream();
    await generateFinalZip({
      exportBlobStore: ExportBlobStore,
      getWritableStream: async () => writable,
    });

    const buf = result();
    const names = findEntryNames(buf);

    // Should be 1-indexed with zero-padding
    expect(names[0]).toBe("conversations-001.json");
  });

  it("handles empty IDB (no conversations, no files)", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { generateFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    const { writable, result } = collectStream();
    await generateFinalZip({
      exportBlobStore: ExportBlobStore,
      getWritableStream: async () => writable,
    });

    const buf = result();
    // Valid empty ZIP (just EOCD)
    const eocdOffset = buf.length - 22;
    expect(readU32(buf, eocdOffset)).toBe(0x06054b50);
    expect(readU16(buf, eocdOffset + 8)).toBe(0);
  });

  it("conversations-NNN.json filenames match convoviz _SPLIT_FILE_RE", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { generateFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    // Put enough convs for multiple files
    for (let i = 1; i <= 150; i++) {
      await ExportBlobStore.putConv(`c${i}`, JSON.stringify({ id: `c${i}` }));
    }

    const { writable, result } = collectStream();
    await generateFinalZip({
      exportBlobStore: ExportBlobStore,
      getWritableStream: async () => writable,
    });

    const buf = result();
    const names = findEntryNames(buf);

    // Verify all conversation filenames match the expected regex
    const splitFileRe = /^conversations-\d+\.json$/;
    const convFiles = names.filter((n) => n.startsWith("conversations-"));
    expect(convFiles.length).toBe(2);
    for (const name of convFiles) {
      expect(name).toMatch(splitFileRe);
    }
  });
});

describe("generateFinalZip metadata-based folder placement", () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../src/state/export-blobs");
    await mod.initExportBlobsIdb();
    await mod.ExportBlobStore.clear();
    vi.resetModules();
  });

  it("places files using metadata type instead of key prefix convention", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { generateFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    // Store an attachment file
    await ExportBlobStore.putFile("file-abc_report.pdf", new Blob(["pdf-data"]));
    await ExportBlobStore.putFileMeta({
      key: "file-abc_report.pdf",
      type: "attachment",
      conversationId: "conv-1",
    });

    // Store a knowledge file
    await ExportBlobStore.putFile("kf/MyProject/doc.pdf", new Blob(["kf-data"]));
    await ExportBlobStore.putFileMeta({
      key: "kf/MyProject/doc.pdf",
      type: "knowledge-file",
      projectName: "MyProject",
    });

    const { writable, result } = collectStream();
    await generateFinalZip({
      exportBlobStore: ExportBlobStore,
      getWritableStream: async () => writable,
    });

    const buf = result();
    const names = findEntryNames(buf);

    // Attachment at root, knowledge file in kf/ folder
    expect(names).toContain("file-abc_report.pdf");
    expect(names).toContain("kf/MyProject/doc.pdf");
  });

  it("falls back to key prefix convention for files without metadata", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { generateFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    // Store files WITHOUT metadata (simulating pre-migration data)
    await ExportBlobStore.putFile("file-old.png", new Blob(["old-attachment"]));
    await ExportBlobStore.putFile("kf/OldProject/old.csv", new Blob(["old-kf"]));

    const { writable, result } = collectStream();
    await generateFinalZip({
      exportBlobStore: ExportBlobStore,
      getWritableStream: async () => writable,
    });

    const buf = result();
    const names = findEntryNames(buf);

    // Files should appear at their IDB key paths (backward compat via key prefix)
    expect(names).toContain("file-old.png");
    expect(names).toContain("kf/OldProject/old.csv");
  });

  it("handles mix of files with and without metadata", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { generateFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    // Old file without metadata
    await ExportBlobStore.putFile("file-old.png", new Blob(["old-data"]));

    // New file with metadata
    await ExportBlobStore.putFile("file-new.jpg", new Blob(["new-data"]));
    await ExportBlobStore.putFileMeta({
      key: "file-new.jpg",
      type: "attachment",
      conversationId: "conv-2",
    });

    const { writable, result } = collectStream();
    await generateFinalZip({
      exportBlobStore: ExportBlobStore,
      getWritableStream: async () => writable,
    });

    const buf = result();
    const names = findEntryNames(buf);

    // Both files should be present at root level
    expect(names).toContain("file-old.png");
    expect(names).toContain("file-new.jpg");
  });
});

describe("downloadFinalZip", () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../src/state/export-blobs");
    await mod.initExportBlobsIdb();
    await mod.ExportBlobStore.clear();
    vi.resetModules();
    // Clean up any global mock
    delete (globalThis as any).showSaveFilePicker;
  });

  it("shows error when showSaveFilePicker is not available", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { downloadFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    const setStatus = vi.fn();
    await downloadFinalZip({ exportBlobStore: ExportBlobStore, setStatus });

    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("Chromium-based browser"),
    );
  });

  it("shows cancel message when user cancels the picker", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { downloadFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    (globalThis as any).showSaveFilePicker = vi.fn().mockRejectedValue(
      new DOMException("The user aborted a request.", "AbortError"),
    );

    const setStatus = vi.fn();
    await downloadFinalZip({ exportBlobStore: ExportBlobStore, setStatus });

    expect(setStatus).toHaveBeenCalledWith("Download cancelled.");
  });

  it("calls showSaveFilePicker with suggested name chatgpt-export.zip", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { downloadFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    const { writable } = collectStream();
    const mockHandle = {
      createWritable: vi.fn().mockResolvedValue(writable),
    };
    const mockPicker = vi.fn().mockResolvedValue(mockHandle);
    (globalThis as any).showSaveFilePicker = mockPicker;

    const setStatus = vi.fn();
    await downloadFinalZip({ exportBlobStore: ExportBlobStore, setStatus });

    expect(mockPicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: "chatgpt-export.zip" }),
    );
    expect(setStatus).toHaveBeenCalledWith("Download complete.");
  });

  it("streams ZIP through FSAA and reports completion", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { downloadFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    await ExportBlobStore.putConv("c1", JSON.stringify({ id: "c1" }));

    const { writable, result } = collectStream();
    const mockHandle = {
      createWritable: vi.fn().mockResolvedValue(writable),
    };
    (globalThis as any).showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);

    const setStatus = vi.fn();
    await downloadFinalZip({ exportBlobStore: ExportBlobStore, setStatus });

    // Verify ZIP was actually generated
    const buf = result();
    expect(buf.length).toBeGreaterThan(22); // more than just EOCD
    expect(readU32(buf, buf.length - 22)).toBe(0x06054b50);

    const names = findEntryNames(buf);
    expect(names).toContain("conversations-001.json");
    expect(setStatus).toHaveBeenCalledWith("Download complete.");
  });

  it("reports error when showSaveFilePicker throws non-abort error", async () => {
    const { initExportBlobsIdb, ExportBlobStore } = await import(
      "../../src/state/export-blobs"
    );
    const { downloadFinalZip } = await import(
      "../../src/export/generate-final-zip"
    );
    await initExportBlobsIdb();

    (globalThis as any).showSaveFilePicker = vi.fn().mockRejectedValue(
      new Error("SecurityError"),
    );

    const setStatus = vi.fn();
    await downloadFinalZip({ exportBlobStore: ExportBlobStore, setStatus });

    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("Failed to open save dialog"),
    );
  });
});
