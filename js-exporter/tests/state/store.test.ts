// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";

describe("Store with IndexedDB", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("initIdb opens IndexedDB successfully", async () => {
    const { initIdb } = await import("../../src/state/store");
    await initIdb();
  });

  it("load returns default state when nothing is saved", async () => {
    const { initIdb, Store } = await import("../../src/state/store");
    const { defaultState } = await import("../../src/state/defaults");
    await initIdb();
    const state = await Store.load();
    expect(state).toEqual(defaultState());
  });

  it("save + load round-trips state correctly", async () => {
    const { initIdb, Store } = await import("../../src/state/store");
    const { defaultState } = await import("../../src/state/defaults");
    await initIdb();
    const state = {
      ...defaultState(),
      settings: {
        chatConcurrency: 5,
        fileConcurrency: 4,
        knowledgeFileConcurrency: 2,
        pause: 500,
        filterGizmoId: "g1" as string | null,
      },
      logs: ["log1", "log2"],
    };
    await Store.save(state);
    const loaded = await Store.load();
    expect(loaded.settings.chatConcurrency).toBe(5);
    expect(loaded.settings.fileConcurrency).toBe(4);
    expect(loaded.logs).toEqual(["log1", "log2"]);
  });

  it("reset clears saved state", async () => {
    const { initIdb, Store } = await import("../../src/state/store");
    const { defaultState } = await import("../../src/state/defaults");
    await initIdb();
    const state = { ...defaultState(), logs: ["saved-log"] };
    await Store.save(state);
    await Store.reset();
    const loaded = await Store.load();
    expect(loaded).toEqual(defaultState());
  });

  it("destroy closes connection and calls deleteDatabase", async () => {
    const { initIdb, Store } = await import("../../src/state/store");
    const { defaultState } = await import("../../src/state/defaults");
    await initIdb();
    await Store.save({ ...defaultState(), logs: ["before-destroy"] });
    const deleteSpy = vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(
      () => {
        const req = {} as IDBOpenDBRequest;
        setTimeout(() => req.onsuccess?.({} as Event), 0);
        return req;
      },
    );
    await Store.destroy();
    expect(deleteSpy).toHaveBeenCalledWith("cvz-export");
    // After destroy, load returns default (idb ref is null)
    const loaded = await Store.load();
    expect(loaded).toEqual(defaultState());
    deleteSpy.mockRestore();
  });

  it("save overwrites previous state", async () => {
    const { initIdb, Store } = await import("../../src/state/store");
    const { defaultState } = await import("../../src/state/defaults");
    await initIdb();
    const state1 = { ...defaultState(), logs: ["first"] };
    await Store.save(state1);
    const state2 = { ...defaultState(), logs: ["second"] };
    await Store.save(state2);
    const loaded = await Store.load();
    expect(loaded.logs).toEqual(["second"]);
  });

  it("load returns default state when initIdb was not called", async () => {
    const { Store } = await import("../../src/state/store");
    const { defaultState } = await import("../../src/state/defaults");
    // Don't call initIdb — _idb is null
    const state = await Store.load();
    expect(state).toEqual(defaultState());
  });

  it("save is a no-op when initIdb was not called", async () => {
    const { Store } = await import("../../src/state/store");
    const { defaultState } = await import("../../src/state/defaults");
    // Don't call initIdb — _idb is null
    await Store.save(defaultState()); // should not throw
  });

  it("reset is a no-op when initIdb was not called", async () => {
    const { Store } = await import("../../src/state/store");
    // Don't call initIdb — _idb is null
    await Store.reset(); // should not throw
  });

  it("destroy is a no-op when initIdb was not called", async () => {
    const { Store } = await import("../../src/state/store");
    // Should not throw — no connection to close, no deleteDatabase call
    await Store.destroy();
  });
});

describe("Store with localStorage fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("falls back to localStorage when IndexedDB is unavailable", async () => {
    const origOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      throw new Error("IndexedDB unavailable");
    };
    try {
      const { initIdb, Store } = await import("../../src/state/store");
      const { defaultState, KEY } = await import("../../src/state/defaults");
      await initIdb();

      const state = { ...defaultState(), logs: ["ls-test"] };
      await Store.save(state);

      const raw = localStorage.getItem(KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.logs).toEqual(["ls-test"]);

      const loaded = await Store.load();
      expect(loaded.logs).toEqual(["ls-test"]);

      await Store.reset();
      expect(localStorage.getItem(KEY)).toBeNull();
    } finally {
      indexedDB.open = origOpen;
    }
  });

  it("load from localStorage returns merged state", async () => {
    const origOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      throw new Error("IndexedDB unavailable");
    };
    try {
      const { initIdb, Store } = await import("../../src/state/store");
      const { defaultState, KEY } = await import("../../src/state/defaults");
      await initIdb();

      // Store partial v2 state in localStorage - will be migrated to v3
      localStorage.setItem(
        KEY,
        JSON.stringify({ v: 2, ver: "old", settings: { batch: 77, conc: 5 } }),
      );
      const loaded = await Store.load();
      expect(loaded.settings.chatConcurrency).toBe(5); // mapped from conc
      expect(loaded.settings.fileConcurrency).toBe(3); // default
    } finally {
      indexedDB.open = origOpen;
    }
  });
});
