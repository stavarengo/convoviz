import { describe, it, expect } from "vitest";
import { enc, u16, u32 } from "../../src/utils/binary";

describe("enc", () => {
  it("encodes ASCII string correctly", () => {
    const result = enc("hello");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([104, 101, 108, 108, 111]);
  });

  it("encodes empty string", () => {
    const result = enc("");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it("encodes multi-byte characters (UTF-8)", () => {
    const result = enc("\u00e9"); // e-acute: 0xC3 0xA9 in UTF-8
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([0xc3, 0xa9]);
  });

  it("encodes emoji (4-byte UTF-8)", () => {
    const result = enc("\u{1F600}"); // grinning face
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(4);
    expect(Array.from(result)).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });
});

describe("u16", () => {
  it("encodes 0 as little-endian 2-byte", () => {
    expect(Array.from(u16(0))).toEqual([0, 0]);
  });

  it("encodes small number correctly", () => {
    expect(Array.from(u16(1))).toEqual([1, 0]);
  });

  it("encodes 256 correctly (low byte 0, high byte 1)", () => {
    expect(Array.from(u16(256))).toEqual([0, 1]);
  });

  it("encodes max 16-bit value", () => {
    expect(Array.from(u16(0xffff))).toEqual([0xff, 0xff]);
  });

  it("encodes 0x1234 correctly", () => {
    // Little-endian: low byte 0x34, high byte 0x12
    expect(Array.from(u16(0x1234))).toEqual([0x34, 0x12]);
  });
});

describe("u32", () => {
  it("encodes 0 as little-endian 4-byte", () => {
    expect(Array.from(u32(0))).toEqual([0, 0, 0, 0]);
  });

  it("encodes 1 correctly", () => {
    expect(Array.from(u32(1))).toEqual([1, 0, 0, 0]);
  });

  it("encodes 0x12345678 in little-endian", () => {
    expect(Array.from(u32(0x12345678))).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it("encodes max 32-bit value", () => {
    expect(Array.from(u32(0xffffffff))).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it("encodes 65536 correctly", () => {
    expect(Array.from(u32(65536))).toEqual([0, 0, 1, 0]);
  });
});
