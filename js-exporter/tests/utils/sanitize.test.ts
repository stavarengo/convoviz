import { describe, it, expect } from "vitest";
import { sanitizeName } from "../../src/utils/sanitize";

describe("sanitizeName", () => {
  it("returns the name unchanged for simple input", () => {
    expect(sanitizeName("hello")).toBe("hello");
  });

  it("strips control characters", () => {
    expect(sanitizeName("he\x00ll\x1fo")).toBe("hello");
    expect(sanitizeName("tab\x7fthing")).toBe("tabthing");
  });

  it("replaces forbidden filename characters with underscore", () => {
    expect(sanitizeName("a/b\\c?d%e*f:g|h")).toBe("a_b_c_d_e_f_g_h");
    expect(sanitizeName('file"name')).toBe("file_name");
    expect(sanitizeName("a<b>c")).toBe("a_b_c");
  });

  it("collapses whitespace to single space", () => {
    expect(sanitizeName("hello   world")).toBe("hello world");
    expect(sanitizeName("a  b  c")).toBe("a b c");
  });

  it("trims leading and trailing whitespace", () => {
    expect(sanitizeName("  hello  ")).toBe("hello");
  });

  it("truncates at 180 characters", () => {
    const long = "a".repeat(200);
    expect(sanitizeName(long)).toBe("a".repeat(180));
    expect(sanitizeName(long).length).toBe(180);
  });

  it('returns "file" for empty input', () => {
    expect(sanitizeName("")).toBe("file");
  });

  it('returns "file" for falsy input', () => {
    expect(sanitizeName(null as unknown as string)).toBe("file");
    expect(sanitizeName(undefined as unknown as string)).toBe("file");
  });

  it('returns "file" when input becomes empty after sanitization', () => {
    // All characters are forbidden
    expect(sanitizeName("\x00\x01\x02")).toBe("file");
  });

  it("handles names exactly 180 characters", () => {
    const exact = "b".repeat(180);
    expect(sanitizeName(exact)).toBe(exact);
  });
});
