import { describe, it, expect, beforeEach, vi } from "vitest";

describe("v2 -> v3 state migration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const makeV2State = (overrides: Record<string, unknown> = {}) => ({
    v: 2,
    ver: "cvz-bookmarklet-5.0",
    projects: [],
    settings: {
      batch: 50,
      conc: 3,
      pause: 300,
      filterGizmoId: null,
    },
    progress: {
      exported: {},
      pending: [],
      dead: [],
      failCounts: {},
      kfExported: [
        {
          projectId: "p1",
          projectName: "Proj1",
          fileId: "f1",
          fileName: "doc.pdf",
          fileType: "pdf",
          fileSize: 1024,
        },
      ],
      kfPending: [
        {
          projectId: "p2",
          projectName: "Proj2",
          fileId: "f2",
          fileName: "img.png",
          fileType: "png",
          fileSize: 2048,
        },
      ],
      kfDead: [
        {
          projectId: "p3",
          projectName: "Proj3",
          fileId: "f3",
          fileName: "lost.txt",
          fileType: "txt",
          fileSize: 512,
          lastError: "file_not_found",
        },
      ],
      kfFailCounts: { f3: 3, f4: 1 },
    },
    scan: { at: 1000, total: 100, totalProjects: 5, snapshot: [] },
    stats: {
      batches: 10,
      batchMs: 50000,
      chats: 200,
      kfBatches: 3,
      kfMs: 15000,
      kfFiles: 45,
    },
    run: {
      isRunning: false,
      startedAt: 0,
      stoppedAt: 0,
      lastError: "",
      backoffUntil: 0,
      backoffCount: 0,
      lastPhase: "idle",
    },
    changes: {
      at: 0,
      newChats: 0,
      removedChats: 0,
      updatedChats: 0,
      newPending: 0,
      pendingDelta: 0,
    },
    ...overrides,
  });

  it("bumps version from 2 to 3", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State();
    const v3 = migrateV2toV3(v2 as any);
    expect(v3.v).toBe(3);
  });

  it("renames kfExported to knowledgeFilesExported", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State();
    const v3 = migrateV2toV3(v2 as any);
    expect(v3.progress.knowledgeFilesExported).toEqual(
      v2.progress.kfExported,
    );
    expect((v3.progress as any).kfExported).toBeUndefined();
  });

  it("renames kfPending to knowledgeFilesPending", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State();
    const v3 = migrateV2toV3(v2 as any);
    expect(v3.progress.knowledgeFilesPending).toEqual(
      v2.progress.kfPending,
    );
    expect((v3.progress as any).kfPending).toBeUndefined();
  });

  it("renames kfDead to knowledgeFilesDead", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State();
    const v3 = migrateV2toV3(v2 as any);
    expect(v3.progress.knowledgeFilesDead).toEqual(v2.progress.kfDead);
    expect((v3.progress as any).kfDead).toBeUndefined();
  });

  it("renames kfFailCounts to knowledgeFilesFailCounts", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State();
    const v3 = migrateV2toV3(v2 as any);
    expect(v3.progress.knowledgeFilesFailCounts).toEqual(
      v2.progress.kfFailCounts,
    );
    expect((v3.progress as any).kfFailCounts).toBeUndefined();
  });

  it("adds new attachment fields with empty defaults", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State();
    const v3 = migrateV2toV3(v2 as any);
    expect(v3.progress.filePending).toEqual([]);
    expect(v3.progress.fileDead).toEqual([]);
    expect(v3.progress.fileFailCounts).toEqual({});
    expect(v3.progress.fileDoneCount).toBe(0);
  });

  it("maps settings: conc -> chatConcurrency, adds file/kf concurrency, removes batch and conc", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State({
      settings: { batch: 100, conc: 5, pause: 300, filterGizmoId: null },
    });
    const v3 = migrateV2toV3(v2 as any);
    expect(v3.settings.chatConcurrency).toBe(5);
    expect(v3.settings.fileConcurrency).toBe(3);
    expect(v3.settings.knowledgeFileConcurrency).toBe(3);
    expect((v3.settings as any).batch).toBeUndefined();
    expect((v3.settings as any).conc).toBeUndefined();
    expect(v3.settings.pause).toBe(300);
    expect(v3.settings.filterGizmoId).toBeNull();
  });

  it("maps settings with defaults when conc is missing", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State({
      settings: { batch: 50, pause: 300, filterGizmoId: null },
    });
    const v3 = migrateV2toV3(v2 as any);
    expect(v3.settings.chatConcurrency).toBe(3);
  });

  it("maps stats: chats -> chatsExported, batchMs -> chatsMs, etc.", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State();
    const v3 = migrateV2toV3(v2 as any);
    expect(v3.stats.chatsExported).toBe(200);
    expect(v3.stats.chatsMs).toBe(50000);
    expect(v3.stats.knowledgeFilesDownloaded).toBe(45);
    expect(v3.stats.knowledgeFilesMs).toBe(15000);
    expect(v3.stats.filesDownloaded).toBe(0);
    expect(v3.stats.filesMs).toBe(0);
    expect((v3.stats as any).batches).toBeUndefined();
    expect((v3.stats as any).batchMs).toBeUndefined();
    expect((v3.stats as any).chats).toBeUndefined();
    expect((v3.stats as any).kfBatches).toBeUndefined();
    expect((v3.stats as any).kfMs).toBeUndefined();
    expect((v3.stats as any).kfFiles).toBeUndefined();
  });

  it("removes lastPhase from run state", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State();
    const v3 = migrateV2toV3(v2 as any);
    expect((v3.run as any).lastPhase).toBeUndefined();
    expect(v3.run.isRunning).toBe(false);
    expect(v3.run.backoffUntil).toBe(0);
  });

  it("preserves non-migrated fields (projects, scan, changes)", async () => {
    const { migrateV2toV3 } = await import("../../src/state/migrate");
    const v2 = makeV2State();
    const v3 = migrateV2toV3(v2 as any);
    expect(v3.projects).toEqual(v2.projects);
    expect(v3.scan).toEqual(v2.scan);
    expect(v3.changes).toEqual(v2.changes);
    expect(v3.progress.exported).toEqual(v2.progress.exported);
    expect(v3.progress.pending).toEqual(v2.progress.pending);
    expect(v3.progress.dead).toEqual(v2.progress.dead);
    expect(v3.progress.failCounts).toEqual(v2.progress.failCounts);
  });

  it("mergeState applies migration when loading v2 state", async () => {
    const { mergeState } = await import("../../src/state/defaults");
    const v2 = makeV2State();
    const result = mergeState(v2 as any);
    expect(result.v).toBe(3);
    expect(result.progress.knowledgeFilesExported).toEqual(
      v2.progress.kfExported,
    );
    expect(result.settings.chatConcurrency).toBe(3);
    expect((result.settings as any).batch).toBeUndefined();
  });
});
