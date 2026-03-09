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

describe("createAddLog", () => {
  it("appends a timestamped message to S.logs", async () => {
    vi.resetModules();
    const { createAddLog } = await import("../src/main");
    const S = { logs: [] as string[] };
    const saveDebounce = vi.fn();
    const renderLogs = vi.fn();

    const addLog = createAddLog(S as any, saveDebounce, renderLogs);

    addLog("test message");
    expect(S.logs).toHaveLength(1);
    expect(S.logs[0]).toMatch(/^\[.*\] test message$/);
    expect(saveDebounce).toHaveBeenCalledWith(false);
    expect(renderLogs).toHaveBeenCalled();
  });

  it("caps logs at 200 entries", async () => {
    vi.resetModules();
    const { createAddLog } = await import("../src/main");
    const S = {
      logs: Array.from({ length: 200 }, (_, i) => `msg-${i}`),
    };
    const saveDebounce = vi.fn();
    const renderLogs = vi.fn();

    const addLog = createAddLog(S as any, saveDebounce, renderLogs);

    addLog("overflow");
    expect(S.logs).toHaveLength(200);
    expect(S.logs[199]).toMatch(/overflow$/);
    // oldest message should have been trimmed
    expect(S.logs[0]).not.toBe("msg-0");
  });

  it("formats timestamp with toLocaleTimeString", async () => {
    vi.resetModules();
    const { createAddLog } = await import("../src/main");
    const S = { logs: [] as string[] };
    const addLog = createAddLog(S as any, vi.fn(), vi.fn());

    addLog("hello");
    // Timestamp format: [HH:MM:SS AM/PM] or [HH:MM:SS] depending on locale
    expect(S.logs[0]).toMatch(/^\[.+\] hello$/);
  });
});
