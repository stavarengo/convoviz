import { describe, it, expect } from "vitest";
import { KEY, VER, defaultState, mergeState } from "../../src/state/defaults";
import type { ExportState } from "../../src/types";

describe("KEY and VER constants", () => {
  it("KEY matches the monolith value", () => {
    expect(KEY).toBe("__cvz_export_state_v1__");
  });

  it("VER is the current version", () => {
    expect(VER).toBe("cvz-bookmarklet-5.0");
  });
});

describe("defaultState", () => {
  it("returns a fresh object each time", () => {
    const a = defaultState();
    const b = defaultState();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("has correct top-level fields", () => {
    const s = defaultState();
    expect(s.v).toBe(2);
    expect(s.ver).toBe(VER);
    expect(s.projects).toEqual([]);
    expect(s.logs).toEqual([]);
  });

  it("has correct settings defaults", () => {
    const s = defaultState();
    expect(s.settings).toEqual({
      batch: 50,
      conc: 3,
      pause: 300,
      filterGizmoId: null,
    });
  });

  it("has correct progress defaults", () => {
    const s = defaultState();
    expect(s.progress).toEqual({
      exported: {},
      pending: [],
      dead: [],
      failCounts: {},
      kfExported: [],
      kfPending: [],
      kfDead: [],
      kfFailCounts: {},
    });
  });

  it("has correct scan defaults", () => {
    const s = defaultState();
    expect(s.scan).toEqual({
      at: 0,
      total: 0,
      totalProjects: 0,
      snapshot: [],
    });
  });

  it("has correct stats defaults", () => {
    const s = defaultState();
    expect(s.stats).toEqual({
      batches: 0,
      batchMs: 0,
      chats: 0,
      kfBatches: 0,
      kfMs: 0,
      kfFiles: 0,
    });
  });

  it("has correct run defaults", () => {
    const s = defaultState();
    expect(s.run).toEqual({
      isRunning: false,
      startedAt: 0,
      stoppedAt: 0,
      lastError: "",
      backoffUntil: 0,
      backoffCount: 0,
      lastPhase: "idle",
    });
  });

  it("has correct changes defaults", () => {
    const s = defaultState();
    expect(s.changes).toEqual({
      at: 0,
      newChats: 0,
      removedChats: 0,
      updatedChats: 0,
      newPending: 0,
      pendingDelta: 0,
    });
  });
});

describe("mergeState", () => {
  it("returns defaultState for null input", () => {
    const result = mergeState(null);
    expect(result).toEqual(defaultState());
  });

  it("returns defaultState for undefined input", () => {
    const result = mergeState(undefined);
    expect(result).toEqual(defaultState());
  });

  it("returns defaultState for object without v field", () => {
    const result = mergeState({} as Partial<ExportState>);
    expect(result).toEqual(defaultState());
  });

  it("preserves existing values for known fields", () => {
    const input: ExportState = {
      ...defaultState(),
      settings: { batch: 100, conc: 5, pause: 500, filterGizmoId: "g1" },
    };
    const result = mergeState(input);
    expect(result.settings.batch).toBe(100);
    expect(result.settings.conc).toBe(5);
    expect(result.settings.pause).toBe(500);
    expect(result.settings.filterGizmoId).toBe("g1");
  });

  it("fills in missing settings fields from defaults", () => {
    const input = {
      v: 2,
      ver: VER,
      settings: { batch: 100 },
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.settings.batch).toBe(100);
    expect(result.settings.conc).toBe(3); // default
    expect(result.settings.pause).toBe(300); // default
    expect(result.settings.filterGizmoId).toBeNull(); // default
  });

  it("merges progress sub-fields correctly", () => {
    const input: ExportState = {
      ...defaultState(),
      progress: {
        ...defaultState().progress,
        pending: [{ id: "c1", title: "Chat 1", update_time: 100, gizmo_id: null }],
        failCounts: { c1: 2 },
        kfFailCounts: { f1: 1 },
      },
    };
    const result = mergeState(input);
    expect(result.progress.pending).toHaveLength(1);
    expect(result.progress.failCounts).toEqual({ c1: 2 });
    expect(result.progress.kfFailCounts).toEqual({ f1: 1 });
  });

  it("migrates array-based exported to object", () => {
    const input = {
      v: 2,
      ver: VER,
      progress: {
        exported: ["id1", "id2", "id3"],
        pending: [],
        dead: [],
        failCounts: {},
        kfExported: [],
        kfPending: [],
        kfDead: [],
        kfFailCounts: {},
      },
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.progress.exported).toEqual({ id1: 0, id2: 0, id3: 0 });
  });

  it("resets exported to {} if it's not an object", () => {
    const input = {
      v: 2,
      ver: VER,
      progress: {
        exported: 42,
      },
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.progress.exported).toEqual({});
  });

  it("ensures kfExported/kfPending/kfDead are arrays", () => {
    const input = {
      v: 2,
      ver: VER,
      progress: {
        kfExported: "not-an-array",
        kfPending: null,
        kfDead: 42,
      },
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(Array.isArray(result.progress.kfExported)).toBe(true);
    expect(Array.isArray(result.progress.kfPending)).toBe(true);
    expect(Array.isArray(result.progress.kfDead)).toBe(true);
  });

  it("ensures projects is an array", () => {
    const input = {
      v: 2,
      ver: VER,
      projects: "not-array",
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(Array.isArray(result.projects)).toBe(true);
    expect(result.projects).toEqual([]);
  });

  it("truncates logs to last 200 entries", () => {
    const logs = Array.from({ length: 300 }, (_, i) => `log-${i}`);
    const input: ExportState = {
      ...defaultState(),
      logs,
    };
    const result = mergeState(input);
    expect(result.logs).toHaveLength(200);
    expect(result.logs[0]).toBe("log-100");
    expect(result.logs[199]).toBe("log-299");
  });

  it("sets logs to empty array if not an array", () => {
    const input = {
      v: 2,
      ver: VER,
      logs: "not-an-array",
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.logs).toEqual([]);
  });

  it("merges scan sub-fields", () => {
    const input: ExportState = {
      ...defaultState(),
      scan: { at: 999, total: 50, totalProjects: 3, snapshot: [["a", 1]] },
    };
    const result = mergeState(input);
    expect(result.scan.at).toBe(999);
    expect(result.scan.total).toBe(50);
  });

  it("merges stats sub-fields", () => {
    const input: ExportState = {
      ...defaultState(),
      stats: { ...defaultState().stats, batches: 10, chats: 200 },
    };
    const result = mergeState(input);
    expect(result.stats.batches).toBe(10);
    expect(result.stats.chats).toBe(200);
  });

  it("merges run sub-fields", () => {
    const input: ExportState = {
      ...defaultState(),
      run: { ...defaultState().run, isRunning: true, lastPhase: "exporting" },
    };
    const result = mergeState(input);
    expect(result.run.isRunning).toBe(true);
    expect(result.run.lastPhase).toBe("exporting");
  });

  it("merges changes sub-fields", () => {
    const input: ExportState = {
      ...defaultState(),
      changes: { ...defaultState().changes, newChats: 5, pendingDelta: 3 },
    };
    const result = mergeState(input);
    expect(result.changes.newChats).toBe(5);
    expect(result.changes.pendingDelta).toBe(3);
  });

  it("handles missing settings gracefully", () => {
    const input = { v: 2, ver: VER } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.settings).toEqual(defaultState().settings);
  });

  it("handles missing progress gracefully", () => {
    const input = { v: 2, ver: VER } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.progress.exported).toEqual({});
    expect(result.progress.pending).toEqual([]);
  });
});
