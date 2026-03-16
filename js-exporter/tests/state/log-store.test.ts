// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

describe("LogStore", () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clear the shared fake-indexeddb database between tests
    const mod = await import("../../src/state/log-store");
    const s = mod.createLogStore();
    await s.init();
    await s.clear();
    vi.resetModules();
  });

  it("init opens the database and sets available to true", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();
    expect(store.available).toBe(true);
  });

  it("put writes an entry and getAll retrieves it", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();

    await store.put({
      timestamp: 1000,
      session: "abc12345",
      level: "info",
      category: "sys",
      message: "Test message",
    });

    const entries = await store.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBeTypeOf("number");
    expect(entries[0].timestamp).toBe(1000);
    expect(entries[0].session).toBe("abc12345");
    expect(entries[0].level).toBe("info");
    expect(entries[0].category).toBe("sys");
    expect(entries[0].message).toBe("Test message");
  });

  it("put stores optional context", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();

    await store.put({
      timestamp: 2000,
      session: "abc12345",
      level: "warn",
      category: "net",
      message: "Rate limited",
      context: { status: 429, retryAfter: 30 },
    });

    const entries = await store.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].context).toEqual({ status: 429, retryAfter: 30 });
  });

  it("getAll returns entries ordered by id (insertion order)", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();

    await store.put({
      timestamp: 1,
      session: "s1",
      level: "info",
      category: "sys",
      message: "First",
    });
    await store.put({
      timestamp: 2,
      session: "s1",
      level: "info",
      category: "sys",
      message: "Second",
    });
    await store.put({
      timestamp: 3,
      session: "s1",
      level: "info",
      category: "sys",
      message: "Third",
    });

    const entries = await store.getAll();
    expect(entries).toHaveLength(3);
    expect(entries[0].message).toBe("First");
    expect(entries[1].message).toBe("Second");
    expect(entries[2].message).toBe("Third");
    expect(entries[0].id).toBeLessThan(entries[1].id);
    expect(entries[1].id).toBeLessThan(entries[2].id);
  });

  it("count returns the total number of entries", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();

    expect(await store.count()).toBe(0);

    await store.put({
      timestamp: 1,
      session: "s1",
      level: "info",
      category: "sys",
      message: "One",
    });
    await store.put({
      timestamp: 2,
      session: "s1",
      level: "info",
      category: "sys",
      message: "Two",
    });

    expect(await store.count()).toBe(2);
  });

  it("clear deletes all entries", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();

    await store.put({
      timestamp: 1,
      session: "s1",
      level: "info",
      category: "sys",
      message: "Entry",
    });

    expect(await store.count()).toBe(1);
    await store.clear();
    expect(await store.count()).toBe(0);

    const entries = await store.getAll();
    expect(entries).toHaveLength(0);
  });

  it("retention cleanup deletes oldest entries when count exceeds 100,000", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();

    // Insert entries to exceed the threshold
    // We use a smaller number and override thresholds for testing
    const OVER_LIMIT = 110;
    const HIGH_MARK = 100;
    const LOW_MARK = 80;

    for (let i = 0; i < OVER_LIMIT; i++) {
      await store.put({
        timestamp: i,
        session: "s1",
        level: "info",
        category: "sys",
        message: `Entry ${i}`,
      });
    }

    expect(await store.count()).toBe(OVER_LIMIT);

    await store.runRetention(HIGH_MARK, LOW_MARK);

    const remaining = await store.count();
    expect(remaining).toBe(LOW_MARK);

    // Verify the oldest entries were deleted (first 30 should be gone)
    const entries = await store.getAll();
    expect(entries[0].message).toBe("Entry 30");
    expect(entries[entries.length - 1].message).toBe(`Entry ${OVER_LIMIT - 1}`);
  });

  it("retention cleanup is a no-op when count is below threshold", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();

    for (let i = 0; i < 5; i++) {
      await store.put({
        timestamp: i,
        session: "s1",
        level: "info",
        category: "sys",
        message: `Entry ${i}`,
      });
    }

    await store.runRetention(100, 80);

    expect(await store.count()).toBe(5);
  });

  it("available is false when init is not called", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    expect(store.available).toBe(false);
  });

  it("put is a no-op when IDB is unavailable", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    // Don't call init — db is null

    // Should not throw
    await store.put({
      timestamp: 1,
      session: "s1",
      level: "info",
      category: "sys",
      message: "Entry",
    });
  });

  it("getAll returns empty array when IDB is unavailable", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    const entries = await store.getAll();
    expect(entries).toEqual([]);
  });

  it("count returns 0 when IDB is unavailable", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    expect(await store.count()).toBe(0);
  });

  it("clear is a no-op when IDB is unavailable", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.clear(); // should not throw
  });

  it("runRetention is a no-op when IDB is unavailable", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.runRetention(100, 80); // should not throw
  });

  it("available is false when IDB open fails", async () => {
    const origOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      throw new Error("IndexedDB unavailable");
    };
    try {
      const { createLogStore } = await import("../../src/state/log-store");
      const store = createLogStore();
      await store.init();
      expect(store.available).toBe(false);
    } finally {
      indexedDB.open = origOpen;
    }
  });

  it("entries without context have context as undefined", async () => {
    const { createLogStore } = await import("../../src/state/log-store");
    const store = createLogStore();
    await store.init();

    await store.put({
      timestamp: 1,
      session: "s1",
      level: "debug",
      category: "sys",
      message: "No context",
    });

    const entries = await store.getAll();
    expect(entries[0].context).toBeUndefined();
  });
});
