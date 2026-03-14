import { describe, it, expect } from "vitest";
import { crcTable, crc32 } from "../../src/zip/crc32";

describe("crcTable", () => {
  it("has exactly 256 entries", () => {
    expect(crcTable).toBeInstanceOf(Uint32Array);
    expect(crcTable.length).toBe(256);
  });

  it("first entry is 0 (CRC of 0x00 with no bits set)", () => {
    expect(crcTable[0]).toBe(0);
  });

  it("entry at index 1 uses polynomial 0xEDB88320", () => {
    // For n=1: c starts as 1, bit 0 is set -> 0xEDB88320 ^ (1 >>> 1) = 0xEDB88320
    // Then 7 more iterations with bit 0 unset -> just right shifts
    // The exact value is a known constant
    expect(crcTable[1]).toBe(0x77073096);
  });
});

describe("crc32", () => {
  it("returns 0x00000000 for empty buffer", () => {
    expect(crc32(new Uint8Array([]))).toBe(0x00000000);
  });

  it("returns correct CRC for ASCII 'hello'", () => {
    const input = new TextEncoder().encode("hello");
    // Known CRC-32 of "hello" is 0x3610A686
    expect(crc32(input)).toBe(0x3610a686);
  });

  it("returns correct CRC for single byte", () => {
    // CRC-32 of [0x00] is known
    expect(crc32(new Uint8Array([0x00]))).toBe(0xd202ef8d);
  });

  it("returns correct CRC for 'test' string", () => {
    const input = new TextEncoder().encode("test");
    // Known CRC-32 of "test" is 0xD87F7E0C
    expect(crc32(input)).toBe(0xd87f7e0c);
  });
});
