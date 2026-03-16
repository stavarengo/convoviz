// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub alert to suppress jsdom "not implemented" noise when the IIFE's
// catch block fires during import
beforeEach(() => {
  vi.stubGlobal("alert", vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertOnChatGPT", () => {
  it("throws when not on chatgpt.com", async () => {
    vi.resetModules();
    const { assertOnChatGPT } = await import("../src/main");
    // jsdom default hostname is "localhost"
    expect(() => assertOnChatGPT()).toThrow("Run this on chatgpt.com");
  });

  it("does not throw on chat.openai.com", async () => {
    vi.resetModules();
    const saved = window.location;
    Object.defineProperty(window, "location", {
      value: { ...saved, hostname: "chat.openai.com" },
      writable: true,
      configurable: true,
    });
    try {
      const { assertOnChatGPT } = await import("../src/main");
      expect(() => assertOnChatGPT()).not.toThrow();
    } finally {
      Object.defineProperty(window, "location", {
        value: saved,
        writable: true,
        configurable: true,
      });
    }
  });

  it("does not throw on chatgpt.com", async () => {
    vi.resetModules();
    const saved = window.location;
    Object.defineProperty(window, "location", {
      value: { ...saved, hostname: "chatgpt.com" },
      writable: true,
      configurable: true,
    });
    try {
      const { assertOnChatGPT } = await import("../src/main");
      expect(() => assertOnChatGPT()).not.toThrow();
    } finally {
      Object.defineProperty(window, "location", {
        value: saved,
        writable: true,
        configurable: true,
      });
    }
  });
});
