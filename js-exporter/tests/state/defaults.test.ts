import { describe, it, expect } from "vitest";
import { KEY, VER, defaultState, mergeState } from "../../src/state/defaults";
import type { ExportState } from "../../src/types";

describe("KEY and VER constants", () => {
  it("KEY matches the monolith value", () => {
    expect(KEY).toBe("__cvz_export_state_v1__");
  });

  it("VER is the current version", () => {
    expect(VER).toBe("cvz-bookmarklet-6.0");
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
    expect(s.v).toBe(3);
    expect(s.ver).toBe(VER);
    expect(s.projects).toEqual([]);
  });

  it("has correct settings defaults", () => {
    const s = defaultState();
    expect(s.settings).toEqual({
      chatConcurrency: 3,
      fileConcurrency: 3,
      knowledgeFileConcurrency: 3,
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
      filePending: [],
      fileDead: [],
      fileFailCounts: {},
      fileDoneCount: 0,
      knowledgeFilesExported: [],
      knowledgeFilesPending: [],
      knowledgeFilesDead: [],
      knowledgeFilesFailCounts: {},
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
      chatsExported: 0,
      chatsMs: 0,
      filesDownloaded: 0,
      filesMs: 0,
      knowledgeFilesDownloaded: 0,
      knowledgeFilesMs: 0,
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
      settings: {
        chatConcurrency: 5,
        fileConcurrency: 4,
        knowledgeFileConcurrency: 2,
        pause: 500,
        filterGizmoId: "g1",
      },
    };
    const result = mergeState(input);
    expect(result.settings.chatConcurrency).toBe(5);
    expect(result.settings.fileConcurrency).toBe(4);
    expect(result.settings.knowledgeFileConcurrency).toBe(2);
    expect(result.settings.pause).toBe(500);
    expect(result.settings.filterGizmoId).toBe("g1");
  });

  it("fills in missing settings fields from defaults", () => {
    const input = {
      v: 3,
      ver: VER,
      settings: { chatConcurrency: 5 },
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.settings.chatConcurrency).toBe(5);
    expect(result.settings.fileConcurrency).toBe(3); // default
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
        knowledgeFilesFailCounts: { f1: 1 },
      },
    };
    const result = mergeState(input);
    expect(result.progress.pending).toHaveLength(1);
    expect(result.progress.failCounts).toEqual({ c1: 2 });
    expect(result.progress.knowledgeFilesFailCounts).toEqual({ f1: 1 });
  });

  it("migrates array-based exported to object", () => {
    const input = {
      v: 3,
      ver: VER,
      progress: {
        exported: ["id1", "id2", "id3"],
        pending: [],
        dead: [],
        failCounts: {},
        filePending: [],
        fileDead: [],
        fileFailCounts: {},
        fileDoneCount: 0,
        knowledgeFilesExported: [],
        knowledgeFilesPending: [],
        knowledgeFilesDead: [],
        knowledgeFilesFailCounts: {},
      },
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.progress.exported).toEqual({ id1: 0, id2: 0, id3: 0 });
  });

  it("resets exported to {} if it's not an object", () => {
    const input = {
      v: 3,
      ver: VER,
      progress: {
        exported: 42,
      },
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.progress.exported).toEqual({});
  });

  it("ensures knowledgeFiles arrays are arrays", () => {
    const input = {
      v: 3,
      ver: VER,
      progress: {
        knowledgeFilesExported: "not-an-array",
        knowledgeFilesPending: null,
        knowledgeFilesDead: 42,
      },
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(Array.isArray(result.progress.knowledgeFilesExported)).toBe(true);
    expect(Array.isArray(result.progress.knowledgeFilesPending)).toBe(true);
    expect(Array.isArray(result.progress.knowledgeFilesDead)).toBe(true);
  });

  it("ensures file arrays are arrays", () => {
    const input = {
      v: 3,
      ver: VER,
      progress: {
        filePending: "bad",
        fileDead: null,
      },
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(Array.isArray(result.progress.filePending)).toBe(true);
    expect(Array.isArray(result.progress.fileDead)).toBe(true);
  });

  it("ensures projects is an array", () => {
    const input = {
      v: 3,
      ver: VER,
      projects: "not-array",
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(Array.isArray(result.projects)).toBe(true);
    expect(result.projects).toEqual([]);
  });

  it("ignores extra fields (like old logs field) gracefully", () => {
    const input = {
      ...defaultState(),
      logs: ["old-log-1", "old-log-2"],
    } as unknown as Partial<ExportState>;
    const result = mergeState(input);
    // logs field no longer exists on ExportState, but loading old state with it shouldn't crash
    expect(result.v).toBe(3);
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
      stats: { ...defaultState().stats, chatsExported: 200, chatsMs: 50000 },
    };
    const result = mergeState(input);
    expect(result.stats.chatsExported).toBe(200);
    expect(result.stats.chatsMs).toBe(50000);
  });

  it("merges run sub-fields", () => {
    const input: ExportState = {
      ...defaultState(),
      run: { ...defaultState().run, isRunning: true },
    };
    const result = mergeState(input);
    expect(result.run.isRunning).toBe(true);
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
    const input = { v: 3, ver: VER } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.settings).toEqual(defaultState().settings);
  });

  it("handles missing progress gracefully", () => {
    const input = { v: 3, ver: VER } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.progress.exported).toEqual({});
    expect(result.progress.pending).toEqual([]);
  });

  it("migrates v2 state automatically", () => {
    const input = {
      v: 2,
      ver: VER,
      settings: { batch: 50, conc: 5, pause: 300, filterGizmoId: null },
      progress: {
        exported: {},
        pending: [],
        dead: [],
        failCounts: {},
        kfExported: [],
        kfPending: [],
        kfDead: [],
        kfFailCounts: {},
      },
      stats: { batches: 10, batchMs: 5000, chats: 100, kfBatches: 2, kfMs: 1000, kfFiles: 20 },
      run: { isRunning: false, startedAt: 0, stoppedAt: 0, lastError: "", backoffUntil: 0, backoffCount: 0, lastPhase: "idle" },
    } as unknown as ExportState;
    const result = mergeState(input);
    expect(result.v).toBe(3);
    expect(result.settings.chatConcurrency).toBe(5);
    expect(result.stats.chatsExported).toBe(100);
    expect(result.stats.chatsMs).toBe(5000);
  });
});
