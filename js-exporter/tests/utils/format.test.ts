import { describe, it, expect } from "vitest";
import { now, clamp, safeJsonParse, fmtMs, fmtTs, fmtSize } from "../../src/utils/format";

describe("now", () => {
  it("returns a number close to Date.now()", () => {
    const before = Date.now();
    const result = now();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

describe("clamp", () => {
  it("returns the value when within bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to minimum when below", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to maximum when above", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("returns min when value equals min", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it("returns max when value equals max", () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe("safeJsonParse", () => {
  it("returns parsed value for valid JSON", () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
  });

  it("returns parsed array for valid JSON array", () => {
    expect(safeJsonParse("[1,2,3]", [])).toEqual([1, 2, 3]);
  });

  it("returns fallback for invalid JSON", () => {
    expect(safeJsonParse("not json", "default")).toBe("default");
  });

  it("returns fallback for empty string", () => {
    expect(safeJsonParse("", null)).toBe(null);
  });

  it("parses valid JSON string literal", () => {
    expect(safeJsonParse('"hello"', "fallback")).toBe("hello");
  });

  it("parses valid JSON number", () => {
    expect(safeJsonParse("42", 0)).toBe(42);
  });
});

describe("fmtMs", () => {
  it('returns "-" for 0', () => {
    expect(fmtMs(0)).toBe("-");
  });

  it('returns "-" for negative values', () => {
    expect(fmtMs(-1000)).toBe("-");
  });

  it('returns "-" for NaN', () => {
    expect(fmtMs(NaN)).toBe("-");
  });

  it('returns "-" for Infinity', () => {
    expect(fmtMs(Infinity)).toBe("-");
  });

  it("formats seconds correctly", () => {
    expect(fmtMs(5000)).toBe("5s");
  });

  it("formats minutes and seconds", () => {
    expect(fmtMs(65000)).toBe("1m 5s");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(fmtMs(3661000)).toBe("1h 1m 1s");
  });

  it("formats exact hours", () => {
    expect(fmtMs(3600000)).toBe("1h 0m 0s");
  });

  it("formats minutes without hours shows 0s for even minutes", () => {
    expect(fmtMs(60000)).toBe("1m 0s");
  });
});

describe("fmtTs", () => {
  it('returns "-" for falsy values', () => {
    expect(fmtTs(0)).toBe("-");
    expect(fmtTs(null as unknown as number)).toBe("-");
    expect(fmtTs(undefined as unknown as number)).toBe("-");
    expect(fmtTs("" as unknown as number)).toBe("-");
  });

  it("formats valid timestamps", () => {
    const ts = 1700000000000;
    const result = fmtTs(ts);
    // Should be a formatted date string, not "-"
    expect(result).not.toBe("-");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("formats valid timestamp matching toLocaleString", () => {
    const ts = 1700000000000;
    const expected = new Date(ts).toLocaleString();
    expect(fmtTs(ts)).toBe(expected);
  });
});

describe("fmtSize", () => {
  it("returns '0 B' for zero", () => {
    expect(fmtSize(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(fmtSize(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(fmtSize(1024)).toBe("1.0 KB");
    expect(fmtSize(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(fmtSize(12.3 * 1024 * 1024)).toBe("12.3 MB");
    expect(fmtSize(1024 * 1024)).toBe("1.0 MB");
  });

  it("formats gigabytes", () => {
    expect(fmtSize(1.2 * 1024 * 1024 * 1024)).toBe("1.2 GB");
  });

  it("handles negative and NaN gracefully", () => {
    expect(fmtSize(-1)).toBe("0 B");
    expect(fmtSize(NaN)).toBe("0 B");
  });
});
