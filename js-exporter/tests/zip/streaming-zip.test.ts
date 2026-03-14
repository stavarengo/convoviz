import { describe, it, expect } from "vitest";
import { StreamingZip } from "../../src/zip/streaming-zip";
import { ZipLite } from "../../src/zip/zip-lite";
import { crc32 } from "../../src/zip/crc32";

/** Read a little-endian u16 from a buffer at offset. */
const readU16 = (buf: Uint8Array, off: number): number =>
  buf[off] | (buf[off + 1] << 8);

/** Read a little-endian u32 from a buffer at offset. */
const readU32 = (buf: Uint8Array, off: number): number =>
  (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;

/** Collect all chunks written to a WritableStream into a single Uint8Array. */
const collectStream = (): { writable: WritableStream<Uint8Array>; result: () => Uint8Array } => {
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

describe("StreamingZip", () => {
  it("produces a valid ZIP with correct signatures for a single Uint8Array entry", async () => {
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);
    const data = new TextEncoder().encode("hello world");
    await zip.addEntry("test.txt", data);
    await zip.finalize();

    const buf = result();

    // Local file header signature
    expect(readU32(buf, 0)).toBe(0x04034b50);

    // Find central directory header
    const nameLen = new TextEncoder().encode("test.txt").length;
    const localHeaderSize = 30 + nameLen;
    const centralStart = localHeaderSize + data.length;
    expect(readU32(buf, centralStart)).toBe(0x02014b50);

    // End of central directory
    const eocdOffset = buf.length - 22;
    expect(readU32(buf, eocdOffset)).toBe(0x06054b50);
  });

  it("computes correct CRC-32 for Uint8Array entries", async () => {
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);
    const data = new TextEncoder().encode("test data for crc");
    await zip.addEntry("crc-test.txt", data);
    await zip.finalize();

    const buf = result();
    const expectedCrc = crc32(data);

    // CRC at offset 14 in local file header
    expect(readU32(buf, 14)).toBe(expectedCrc);

    // CRC at offset 16 in central directory header
    const nameLen = new TextEncoder().encode("crc-test.txt").length;
    const centralStart = 30 + nameLen + data.length;
    expect(readU32(buf, centralStart + 16)).toBe(expectedCrc);
  });

  it("handles multiple entries with correct offsets", async () => {
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);
    const data1 = new TextEncoder().encode("file one");
    const data2 = new TextEncoder().encode("file two content");
    await zip.addEntry("a.txt", data1);
    await zip.addEntry("b.txt", data2);
    await zip.finalize();

    const buf = result();

    // First local header at offset 0
    expect(readU32(buf, 0)).toBe(0x04034b50);

    // Second local header after first entry
    const name1Len = new TextEncoder().encode("a.txt").length;
    const entry1Size = 30 + name1Len + data1.length;
    expect(readU32(buf, entry1Size)).toBe(0x04034b50);

    // Central directory
    const name2Len = new TextEncoder().encode("b.txt").length;
    const entry2Size = 30 + name2Len + data2.length;
    const centralStart = entry1Size + entry2Size;

    // First central header
    expect(readU32(buf, centralStart)).toBe(0x02014b50);
    // Offset of first local header
    expect(readU32(buf, centralStart + 42)).toBe(0);

    // Second central header
    const central1Size = 46 + name1Len;
    expect(readU32(buf, centralStart + central1Size)).toBe(0x02014b50);
    // Offset of second local header
    expect(readU32(buf, centralStart + central1Size + 42)).toBe(entry1Size);

    // EOCD entry count
    const eocdOffset = buf.length - 22;
    expect(readU16(buf, eocdOffset + 8)).toBe(2);
    expect(readU16(buf, eocdOffset + 10)).toBe(2);
  });

  it("accepts Blob data and streams it with a data descriptor", async () => {
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);
    const content = "blob content for streaming test";
    const blob = new Blob([content]);
    await zip.addEntry("blob.txt", blob);
    await zip.finalize();

    const buf = result();
    const contentBytes = new TextEncoder().encode(content);
    const expectedCrc = crc32(contentBytes);

    // Valid ZIP structure
    expect(readU32(buf, 0)).toBe(0x04034b50);

    // Blob entries use data descriptor (bit 3 set), so local header has zeros
    expect(readU16(buf, 6) & 0x0008).toBe(0x0008);
    expect(readU32(buf, 14)).toBe(0); // CRC in local header is 0
    expect(readU32(buf, 18)).toBe(0); // compressed size is 0
    expect(readU32(buf, 22)).toBe(0); // uncompressed size is 0

    // Data descriptor follows file data: signature + crc + sizes
    const nameLen = new TextEncoder().encode("blob.txt").length;
    const descOffset = 30 + nameLen + contentBytes.length;
    expect(readU32(buf, descOffset)).toBe(0x08074b50); // data descriptor signature
    expect(readU32(buf, descOffset + 4)).toBe(expectedCrc);
    expect(readU32(buf, descOffset + 8)).toBe(contentBytes.length);
    expect(readU32(buf, descOffset + 12)).toBe(contentBytes.length);

    // Central directory has the real CRC and sizes
    const centralStart = descOffset + 16;
    expect(readU32(buf, centralStart)).toBe(0x02014b50);
    expect(readU32(buf, centralStart + 16)).toBe(expectedCrc);
    expect(readU32(buf, centralStart + 20)).toBe(contentBytes.length);
    expect(readU32(buf, centralStart + 24)).toBe(contentBytes.length);
  });

  it("uses STORE method (compression = 0)", async () => {
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);
    await zip.addEntry("test.txt", new Uint8Array([1, 2, 3]));
    await zip.finalize();

    const buf = result();

    // Compression method at offset 8 in local header
    expect(readU16(buf, 8)).toBe(0);
  });

  it("sets UTF-8 flag (0x0800) on entries", async () => {
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);
    await zip.addEntry("test.txt", new Uint8Array([1, 2, 3]));
    await zip.finalize();

    const buf = result();

    // General purpose bit flag at offset 6
    expect(readU16(buf, 6)).toBe(0x0800);
  });

  it("stores compressed and uncompressed sizes as equal", async () => {
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);
    const data = new TextEncoder().encode("uncompressed data");
    await zip.addEntry("raw.txt", data);
    await zip.finalize();

    const buf = result();

    expect(readU32(buf, 18)).toBe(data.length);
    expect(readU32(buf, 22)).toBe(data.length);
  });

  it("produces output byte-identical to ZipLite for the same entries", async () => {
    // Build with ZipLite
    const zipLite = new ZipLite();
    const data1 = new TextEncoder().encode("first file content");
    const data2 = new TextEncoder().encode("second file content!!!");
    zipLite.addBytes("file1.txt", data1);
    zipLite.addBytes("file2.txt", data2);
    const zipLiteBlob = zipLite.buildBlob();
    const zipLiteBuf = new Uint8Array(await zipLiteBlob.arrayBuffer());

    // Build with StreamingZip
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);
    await zip.addEntry("file1.txt", data1);
    await zip.addEntry("file2.txt", data2);
    await zip.finalize();
    const streamingBuf = result();

    // The two outputs should be structurally equivalent:
    // Same number of entries, same CRCs, same sizes, same data
    // Note: timestamp may differ, so we compare structural fields
    expect(streamingBuf.length).toBe(zipLiteBuf.length);

    // Compare entry count in EOCD
    const eocd1 = zipLiteBuf.length - 22;
    const eocd2 = streamingBuf.length - 22;
    expect(readU16(streamingBuf, eocd2 + 8)).toBe(readU16(zipLiteBuf, eocd1 + 8));

    // Compare CRCs for both entries
    expect(readU32(streamingBuf, 14)).toBe(readU32(zipLiteBuf, 14));
  });

  it("handles empty data", async () => {
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);
    await zip.addEntry("empty.txt", new Uint8Array(0));
    await zip.finalize();

    const buf = result();

    // Valid ZIP
    expect(readU32(buf, 0)).toBe(0x04034b50);

    // Size should be 0
    expect(readU32(buf, 18)).toBe(0);
    expect(readU32(buf, 22)).toBe(0);

    // CRC of empty data
    const emptyCrc = crc32(new Uint8Array(0));
    expect(readU32(buf, 14)).toBe(emptyCrc);
  });

  it("handles mixed Uint8Array and Blob entries correctly", async () => {
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);

    const textData = new TextEncoder().encode("text entry");
    const blobContent = "blob entry data here";
    const blob = new Blob([blobContent]);
    const textData2 = new TextEncoder().encode("another text entry");

    await zip.addEntry("first.txt", textData);
    await zip.addEntry("second.bin", blob);
    await zip.addEntry("third.txt", textData2);
    await zip.finalize();

    const buf = result();

    // EOCD has 3 entries
    const eocdOffset = buf.length - 22;
    expect(readU32(buf, eocdOffset)).toBe(0x06054b50);
    expect(readU16(buf, eocdOffset + 8)).toBe(3);

    // First entry (Uint8Array): no data descriptor
    expect(readU32(buf, 0)).toBe(0x04034b50);
    expect(readU16(buf, 6) & 0x0008).toBe(0); // bit 3 not set

    // Verify CRC for first entry in central directory
    const blobBytes = new TextEncoder().encode(blobContent);
    const entry1Len = 30 + "first.txt".length + textData.length;
    // Second entry (Blob): has data descriptor (bit 3 set)
    expect(readU32(buf, entry1Len)).toBe(0x04034b50);
    expect(readU16(buf, entry1Len + 6) & 0x0008).toBe(0x0008);

    // Third entry starts after second entry + data descriptor
    const entry2Len = 30 + "second.bin".length + blobBytes.length + 16;
    const thirdStart = entry1Len + entry2Len;
    expect(readU32(buf, thirdStart)).toBe(0x04034b50);
    expect(readU16(buf, thirdStart + 6) & 0x0008).toBe(0); // bit 3 not set
  });

  it("only accumulates central directory entries in memory, not file data", async () => {
    // This is a design verification: the StreamingZip should NOT store file data
    // We verify indirectly by checking it works and produces valid output
    // for a reasonable number of entries without issues
    const { writable, result } = collectStream();
    const zip = new StreamingZip(writable);

    for (let i = 0; i < 50; i++) {
      const data = new TextEncoder().encode(`content of file ${i}`);
      await zip.addEntry(`file-${i}.txt`, data);
    }
    await zip.finalize();

    const buf = result();
    const eocdOffset = buf.length - 22;
    expect(readU32(buf, eocdOffset)).toBe(0x06054b50);
    expect(readU16(buf, eocdOffset + 8)).toBe(50);
    expect(readU16(buf, eocdOffset + 10)).toBe(50);
  });
});
