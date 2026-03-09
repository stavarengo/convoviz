import { describe, it, expect } from "vitest";
import { ZipLite, dosTimeDate } from "../../src/zip/zip-lite";
import { crc32 } from "../../src/zip/crc32";

/** Read a little-endian u16 from a buffer at offset. */
const readU16 = (buf: Uint8Array, off: number): number =>
  buf[off] | (buf[off + 1] << 8);

/** Read a little-endian u32 from a buffer at offset. */
const readU32 = (buf: Uint8Array, off: number): number =>
  (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;

describe("dosTimeDate", () => {
  it("encodes a known date correctly", () => {
    // 2024-06-15 14:30:22
    const d = new Date(2024, 5, 15, 14, 30, 22); // month is 0-indexed
    const { time, date } = dosTimeDate(d);

    // Time: hours=14 (bits 15-11), minutes=30 (bits 10-5), seconds/2=11 (bits 4-0)
    const expectedTime = (14 << 11) | (30 << 5) | 11;
    expect(time).toBe(expectedTime & 0xffff);

    // Date: year-1980=44 (bits 15-9), month=6 (bits 8-5), day=15 (bits 4-0)
    const expectedDate = (44 << 9) | (6 << 5) | 15;
    expect(date).toBe(expectedDate & 0xffff);
  });

  it("defaults to current date when called with undefined", () => {
    const result = dosTimeDate(undefined);
    expect(result).toHaveProperty("time");
    expect(result).toHaveProperty("date");
    expect(typeof result.time).toBe("number");
    expect(typeof result.date).toBe("number");
  });

  it("encodes epoch-adjacent date (1980-01-01)", () => {
    const d = new Date(1980, 0, 1, 0, 0, 0);
    const { time, date } = dosTimeDate(d);
    expect(time).toBe(0); // 0:0:0
    expect(date).toBe((0 << 9) | (1 << 5) | 1); // year=0, month=1, day=1
  });
});

describe("ZipLite", () => {
  it("addBytes + buildBlob produces a valid ZIP with correct signatures", async () => {
    const zip = new ZipLite();
    const data = new TextEncoder().encode("hello world");
    zip.addBytes("test.txt", data);

    const blob = zip.buildBlob();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");

    const buf = new Uint8Array(await blob.arrayBuffer());

    // Local file header signature: 0x04034b50
    expect(readU32(buf, 0)).toBe(0x04034b50);

    // Find central directory header signature: 0x02014b50
    // It starts after local headers + file data
    const nameLen = new TextEncoder().encode("test.txt").length;
    const localHeaderSize = 30 + nameLen;
    const centralStart = localHeaderSize + data.length;
    expect(readU32(buf, centralStart)).toBe(0x02014b50);

    // Find end of central directory signature: 0x06054b50
    // It's at the very end, 22 bytes from end of file
    const eocdOffset = buf.length - 22;
    expect(readU32(buf, eocdOffset)).toBe(0x06054b50);
  });

  it("CRC-32 checksums in the ZIP match crc32() output", async () => {
    const zip = new ZipLite();
    const data = new TextEncoder().encode("test data for crc");
    zip.addBytes("crc-test.txt", data);

    const blob = zip.buildBlob();
    const buf = new Uint8Array(await blob.arrayBuffer());

    const expectedCrc = crc32(data);

    // CRC is at offset 14 in the local file header
    const crcInLocal = readU32(buf, 14);
    expect(crcInLocal).toBe(expectedCrc);

    // CRC is also at offset 16 in the central directory header
    const nameLen = new TextEncoder().encode("crc-test.txt").length;
    const centralStart = 30 + nameLen + data.length;
    const crcInCentral = readU32(buf, centralStart + 16);
    expect(crcInCentral).toBe(expectedCrc);
  });

  it("multiple entries produce correct offsets", async () => {
    const zip = new ZipLite();
    const data1 = new TextEncoder().encode("file one");
    const data2 = new TextEncoder().encode("file two content");
    zip.addBytes("a.txt", data1);
    zip.addBytes("b.txt", data2);

    const blob = zip.buildBlob();
    const buf = new Uint8Array(await blob.arrayBuffer());

    // First local header at offset 0
    expect(readU32(buf, 0)).toBe(0x04034b50);

    // Second local header after first local header + data
    const name1Len = new TextEncoder().encode("a.txt").length;
    const entry1Size = 30 + name1Len + data1.length;
    expect(readU32(buf, entry1Size)).toBe(0x04034b50);

    // Central directory: two entries
    const name2Len = new TextEncoder().encode("b.txt").length;
    const entry2Size = 30 + name2Len + data2.length;
    const centralStart = entry1Size + entry2Size;

    // First central header
    expect(readU32(buf, centralStart)).toBe(0x02014b50);

    // Relative offset of first local header in central directory entry 1
    // Offset field is at byte 42 of the central header
    expect(readU32(buf, centralStart + 42)).toBe(0);

    // Second central header
    const central1Size = 46 + name1Len;
    expect(readU32(buf, centralStart + central1Size)).toBe(0x02014b50);

    // Relative offset of second local header in central directory entry 2
    expect(readU32(buf, centralStart + central1Size + 42)).toBe(entry1Size);

    // EOCD: file count = 2
    const eocdOffset = buf.length - 22;
    expect(readU16(buf, eocdOffset + 8)).toBe(2); // total entries on disk
    expect(readU16(buf, eocdOffset + 10)).toBe(2); // total entries
  });

  it("addBlob works correctly", async () => {
    const zip = new ZipLite();
    const content = "blob content here";
    const blob = new Blob([content], { type: "text/plain" });
    await zip.addBlob("blob.txt", blob);

    const result = zip.buildBlob();
    const buf = new Uint8Array(await result.arrayBuffer());

    // Verify valid ZIP structure
    expect(readU32(buf, 0)).toBe(0x04034b50);

    // Verify CRC matches the raw content
    const expectedCrc = crc32(new TextEncoder().encode(content));
    expect(readU32(buf, 14)).toBe(expectedCrc);
  });

  it("builds an empty ZIP when no files are added", () => {
    const zip = new ZipLite();
    const blob = zip.buildBlob();
    expect(blob).toBeInstanceOf(Blob);

    // An empty ZIP is just the EOCD record (22 bytes)
  });

  it("handles non-Uint8Array input in addBytes", () => {
    const zip = new ZipLite();
    const data = [72, 101, 108, 108, 111]; // "Hello" as plain array
    zip.addBytes("array.txt", data as unknown as Uint8Array);

    // Should not throw - original code converts non-Uint8Array to Uint8Array
    const blob = zip.buildBlob();
    expect(blob).toBeInstanceOf(Blob);
  });

  it("uses UTF-8 flag (0x0800) for filenames", async () => {
    const zip = new ZipLite();
    zip.addBytes("test.txt", new Uint8Array([1, 2, 3]));

    const blob = zip.buildBlob();
    const buf = new Uint8Array(await blob.arrayBuffer());

    // General purpose bit flag at offset 6 in local header
    const flags = readU16(buf, 6);
    expect(flags).toBe(0x0800);
  });

  it("stores compressed and uncompressed size as equal (no compression)", async () => {
    const zip = new ZipLite();
    const data = new TextEncoder().encode("uncompressed data");
    zip.addBytes("raw.txt", data);

    const blob = zip.buildBlob();
    const buf = new Uint8Array(await blob.arrayBuffer());

    // Compressed size at offset 18
    const compressedSize = readU32(buf, 18);
    // Uncompressed size at offset 22
    const uncompressedSize = readU32(buf, 22);
    expect(compressedSize).toBe(data.length);
    expect(uncompressedSize).toBe(data.length);
  });
});
