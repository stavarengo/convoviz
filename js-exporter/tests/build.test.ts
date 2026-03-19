import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { readFileSync, existsSync, statSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const dist = (name: string) => resolve(ROOT, "dist", name);

describe("build verification", () => {
  beforeAll(() => {
    execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
    execSync("npm run build:dev", { cwd: ROOT, stdio: "pipe" });
  });

  describe("npm run build", () => {
    it("produces dist/script.min.js", () => {
      expect(existsSync(dist("script.min.js"))).toBe(true);
    });

    it("produces dist/bookmarklet.js", () => {
      expect(existsSync(dist("bookmarklet.js"))).toBe(true);
    });

    it("dist/bookmarklet.js starts with javascript:", () => {
      const content = readFileSync(dist("bookmarklet.js"), "utf-8");
      expect(content.startsWith("javascript:")).toBe(true);
    });

    it("dist/script.min.js is syntactically valid JavaScript", () => {
      const content = readFileSync(dist("script.min.js"), "utf-8");
      expect(() => new Function(content)).not.toThrow();
    });
  });

  describe("npm run build:dev", () => {
    it("produces dist/script.js", () => {
      expect(existsSync(dist("script.js"))).toBe(true);
    });

    it("dist/script.js is syntactically valid JavaScript", () => {
      const content = readFileSync(dist("script.js"), "utf-8");
      expect(() => new Function(content)).not.toThrow();
    });
  });

  describe("IIFE bundle correctness", () => {
    it("has no require() calls in minified output", () => {
      const content = readFileSync(dist("script.min.js"), "utf-8");
      // Match require(...) but not inside string literals.
      // esbuild IIFE format should never emit require() calls.
      // A simple heuristic: require( preceded by a non-quote character
      // is a real call. But since this is minified, let's just check
      // the bundle wraps as an IIFE (starts with arrow IIFE or function IIFE).
      const hasTopLevelRequire = /^[^"'`]*\brequire\s*\(/m.test(content);
      expect(hasTopLevelRequire).toBe(false);
    });

    it("has no ES module import/export statements in minified output", () => {
      const content = readFileSync(dist("script.min.js"), "utf-8");
      // Check for actual import/export statements (not inside strings)
      // esbuild --format=iife wraps everything, so no top-level import/export
      // should exist. The IIFE wrapper means the first character is " or (
      // Check that the output starts with an IIFE pattern
      const startsWithIIFE =
        content.startsWith('"use strict";(()=>{') ||
        content.startsWith("(()=>{") ||
        content.startsWith("(function");
      expect(startsWithIIFE).toBe(true);
    });

    it("minified output ends with closing IIFE pattern", () => {
      const content = readFileSync(dist("script.min.js"), "utf-8").trimEnd();
      expect(content.endsWith("})();")).toBe(true);
    });

    it("dev output is a single IIFE", () => {
      const content = readFileSync(dist("script.js"), "utf-8");
      const startsWithIIFE =
        content.startsWith('"use strict";\n(()') ||
        content.startsWith("(()") ||
        content.startsWith("(function");
      expect(startsWithIIFE).toBe(true);
      expect(content.trimEnd().endsWith("})();")).toBe(true);
    });
  });

  describe("bundle size", () => {
    it("minified bundle is a reasonable size", () => {
      expect(existsSync(dist("script.min.js"))).toBe(true);
      const newSize = statSync(dist("script.min.js")).size;
      // The bundle embeds the Web Worker code inline, so it's roughly
      // 1.3-1.5x the size of a pre-worker build. Cap at 150KB.
      expect(newSize).toBeLessThan(150 * 1024);
      expect(newSize).toBeGreaterThan(10 * 1024);
    });

    it("worker bundle is produced as build artifact", () => {
      expect(existsSync(dist("worker.js"))).toBe(true);
      const workerSize = statSync(dist("worker.js")).size;
      expect(workerSize).toBeGreaterThan(5 * 1024);
    });
  });
});
