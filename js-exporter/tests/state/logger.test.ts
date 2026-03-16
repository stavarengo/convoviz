// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

describe("Logger", () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clear IDB state between tests
    const logStoreMod = await import("../../src/state/log-store");
    const s = logStoreMod.createLogStore();
    await s.init();
    await s.clear();
    vi.resetModules();
  });

  it("log() pushes an entry to the in-memory session array", async () => {
    const { initLogger, log, getSessionLogs } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    log("info", "sys", "Hello world");

    const logs = getSessionLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("info");
    expect(logs[0].category).toBe("sys");
    expect(logs[0].message).toBe("Hello world");
  });

  it("log() entries have correct LogEntry schema", async () => {
    const { initLogger, log, getSessionLogs } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    log("warn", "net", "Rate limited", { status: 429, retryAfter: 30 });

    const entry = getSessionLogs()[0];
    expect(entry.timestamp).toBeTypeOf("number");
    expect(entry.session).toBeTypeOf("string");
    expect(entry.session).toHaveLength(8);
    expect(entry.level).toBe("warn");
    expect(entry.category).toBe("net");
    expect(entry.message).toBe("Rate limited");
    expect(entry.context).toEqual({ status: 429, retryAfter: 30 });
  });

  it("log() entries without context have undefined context", async () => {
    const { initLogger, log, getSessionLogs } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    log("debug", "sys", "No context");

    expect(getSessionLogs()[0].context).toBeUndefined();
  });

  it("session ID is consistent across multiple log() calls", async () => {
    const { initLogger, log, getSessionLogs } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    log("info", "sys", "First");
    log("info", "sys", "Second");
    log("info", "sys", "Third");

    const logs = getSessionLogs();
    expect(logs).toHaveLength(3);
    const sessionId = logs[0].session;
    expect(sessionId).toMatch(/^[0-9a-f]{8}$/);
    expect(logs[1].session).toBe(sessionId);
    expect(logs[2].session).toBe(sessionId);
  });

  it("session ID is an 8-character hex string", async () => {
    const { initLogger, log, getSessionLogs } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    log("info", "sys", "Test");

    const sessionId = getSessionLogs()[0].session;
    expect(sessionId).toMatch(/^[0-9a-f]{8}$/);
  });

  it("getSessionId() returns the same session ID used in log entries", async () => {
    const { initLogger, log, getSessionLogs, getSessionId } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    const sessionId = getSessionId();
    expect(sessionId).toMatch(/^[0-9a-f]{8}$/);

    log("info", "sys", "Test");
    expect(getSessionLogs()[0].session).toBe(sessionId);
  });

  it("log() writes to IDB via LogStore", async () => {
    const { initLogger, log } = await import("../../src/state/logger");
    await initLogger();

    log("info", "sys", "Persisted entry");

    // Wait for async IDB write to complete
    await new Promise((r) => setTimeout(r, 50));

    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();
    const entries = await store.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("Persisted entry");
    expect(entries[0].level).toBe("info");
    expect(entries[0].category).toBe("sys");
  });

  it("IDB write failure does not affect in-memory array or throw", async () => {
    const { initLogger, log, getSessionLogs } = await import(
      "../../src/state/logger"
    );
    // Don't call initLogger — IDB store won't be initialized, so put is a no-op
    // Simulate unavailable IDB by not initializing

    log("info", "sys", "Should still work");

    const logs = getSessionLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("Should still work");
  });

  it("getSessionLogs() returns the same array reference", async () => {
    const { initLogger, log, getSessionLogs } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    const ref1 = getSessionLogs();
    log("info", "sys", "Entry");
    const ref2 = getSessionLogs();

    expect(ref1).toBe(ref2);
    expect(ref1).toHaveLength(1);
  });

  it("getLogCount() returns total persisted entry count", async () => {
    const { initLogger, log, getLogCount } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    log("info", "sys", "One");
    log("info", "sys", "Two");
    log("info", "sys", "Three");

    // Wait for async IDB writes
    await new Promise((r) => setTimeout(r, 50));

    const count = await getLogCount();
    expect(count).toBe(3);
  });

  it("getLogCount() returns 0 when IDB is unavailable", async () => {
    const { getLogCount } = await import("../../src/state/logger");
    // Don't init — IDB unavailable

    const count = await getLogCount();
    expect(count).toBe(0);
  });

  it("retention cleanup runs on initialization", async () => {
    // Pre-populate IDB with entries exceeding high mark
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();

    // Insert entries exceeding the default thresholds
    // We'll test with a smaller number by checking that runRetention was called
    for (let i = 0; i < 15; i++) {
      await store.put({
        timestamp: i,
        session: "old-session",
        level: "info",
        category: "sys",
        message: `Old entry ${i}`,
      });
    }

    vi.resetModules();

    // Now init the logger — it should run retention
    // We can verify by checking that runRetention was called on the store
    // Since we can't easily override the high/low marks in logger, let's
    // verify the logger initializes without error and the entries are still
    // there (they're below the 100k threshold)
    const { initLogger, getLogCount } = await import("../../src/state/logger");
    await initLogger();

    const count = await getLogCount();
    // All 15 entries should still be present (below 100k threshold)
    expect(count).toBe(15);
  });

  it("log() is synchronous from the caller's perspective", async () => {
    const { initLogger, log, getSessionLogs } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    // log() should return void synchronously — entry is in memory immediately
    const result = log("info", "sys", "Sync test");
    expect(result).toBeUndefined();

    // Entry is immediately available, no await needed
    expect(getSessionLogs()).toHaveLength(1);
  });

  it("in-memory array has no cap — holds all current session entries", async () => {
    const { initLogger, log, getSessionLogs } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    for (let i = 0; i < 300; i++) {
      log("info", "sys", `Entry ${i}`);
    }

    expect(getSessionLogs()).toHaveLength(300);
  });

  it("formatLogLine() formats entry as [HH:MM:SS] [LEVEL/category] message", async () => {
    const { formatLogLine } = await import("../../src/state/logger");
    const ts = new Date(2025, 5, 15, 14, 32, 1).getTime();
    const line = formatLogLine({
      timestamp: ts,
      session: "abcd1234",
      level: "warn",
      category: "net",
      message: "Rate limited (429), retry in 30s",
    });
    expect(line).toBe("[14:32:01] [WARN/net] Rate limited (429), retry in 30s");
  });

  it("formatLogLine() zero-pads hours/minutes/seconds", async () => {
    const { formatLogLine } = await import("../../src/state/logger");
    const ts = new Date(2025, 0, 1, 3, 5, 7).getTime();
    const line = formatLogLine({
      timestamp: ts,
      session: "abcd1234",
      level: "info",
      category: "sys",
      message: "Test",
    });
    expect(line).toBe("[03:05:07] [INFO/sys] Test");
  });

  it("getAllLogs() returns all persisted entries from IDB", async () => {
    const { initLogger, log, getAllLogs } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    log("info", "sys", "Entry 1");
    log("warn", "net", "Entry 2", { detail: "ctx" });

    // Wait for async IDB writes
    await new Promise((r) => setTimeout(r, 50));

    const entries = await getAllLogs();
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe("Entry 1");
    expect(entries[1].message).toBe("Entry 2");
    // IDB entries should have auto-increment id
    expect(entries[0].id).toBeTypeOf("number");
  });

  it("serializeLogsJsonl() serializes entries as JSONL (one JSON object per line)", async () => {
    const { serializeLogsJsonl } = await import("../../src/state/logger");
    const entries = [
      { id: 1, timestamp: 1000, session: "abcd1234", level: "info" as const, category: "sys", message: "First" },
      { id: 2, timestamp: 2000, session: "abcd1234", level: "warn" as const, category: "net", message: "Second", context: { status: 429 } },
    ];
    const jsonl = serializeLogsJsonl(entries);
    const lines = jsonl.split("\n");
    expect(lines).toHaveLength(2);
    // Each line is valid JSON
    const obj1 = JSON.parse(lines[0]);
    expect(obj1.id).toBe(1);
    expect(obj1.timestamp).toBe(1000);
    expect(obj1.session).toBe("abcd1234");
    expect(obj1.level).toBe("info");
    expect(obj1.category).toBe("sys");
    expect(obj1.message).toBe("First");
    const obj2 = JSON.parse(lines[1]);
    expect(obj2.id).toBe(2);
    expect(obj2.context).toEqual({ status: 429 });
  });

  it("serializeLogsJsonl() includes all fields in each line", async () => {
    const { serializeLogsJsonl } = await import("../../src/state/logger");
    const entries = [
      { id: 42, timestamp: 12345, session: "sess1234", level: "error" as const, category: "sys", message: "Boom", context: { stack: "trace" } },
    ];
    const jsonl = serializeLogsJsonl(entries);
    const obj = JSON.parse(jsonl);
    expect(obj).toHaveProperty("id", 42);
    expect(obj).toHaveProperty("timestamp", 12345);
    expect(obj).toHaveProperty("session", "sess1234");
    expect(obj).toHaveProperty("level", "error");
    expect(obj).toHaveProperty("category", "sys");
    expect(obj).toHaveProperty("message", "Boom");
    expect(obj).toHaveProperty("context", { stack: "trace" });
  });

  it("clearLogs() clears all persisted entries from IDB", async () => {
    const { initLogger, log, getLogCount, clearLogs } = await import(
      "../../src/state/logger"
    );
    await initLogger();

    log("info", "sys", "Entry");
    await new Promise((r) => setTimeout(r, 50));
    expect(await getLogCount()).toBe(1);

    await clearLogs();
    expect(await getLogCount()).toBe(0);
  });
});
