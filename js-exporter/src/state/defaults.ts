import type { ExportState } from "../types";
import { migrateV2toV3 } from "./migrate";

export const KEY = "__cvz_export_state_v1__";
export const VER = "cvz-bookmarklet-5.0";

export const defaultState = (): ExportState => ({
  v: 3,
  ver: VER,
  projects: [],
  settings: {
    chatConcurrency: 3,
    fileConcurrency: 3,
    knowledgeFileConcurrency: 3,
    pause: 300,
    filterGizmoId: null,
  },
  progress: {
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
  },
  scan: {
    at: 0,
    total: 0,
    totalProjects: 0,
    snapshot: [],
  },
  stats: {
    chatsExported: 0,
    chatsMs: 0,
    filesDownloaded: 0,
    filesMs: 0,
    knowledgeFilesDownloaded: 0,
    knowledgeFilesMs: 0,
  },
  run: {
    isRunning: false,
    startedAt: 0,
    stoppedAt: 0,
    lastError: "",
    backoffUntil: 0,
    backoffCount: 0,
  },
  changes: {
    at: 0,
    newChats: 0,
    removedChats: 0,
    updatedChats: 0,
    newPending: 0,
    pendingDelta: 0,
  },
  logs: [],
});

export const mergeState = (
  s: Partial<ExportState> | null | undefined,
): ExportState => {
  if (!s || !s.v) return defaultState();

  // Apply v2 -> v3 migration if needed
  /* eslint-disable @typescript-eslint/no-explicit-any */
  if (s.v === 2) {
    s = migrateV2toV3(s as any) as Partial<ExportState>;
  }

  const d = defaultState();
  const out: ExportState = {
    ...d,
    ...(s as ExportState),
  };
  if (!Array.isArray(out.projects)) out.projects = [];
  out.settings = {
    ...d.settings,
    ...(s.settings || {}),
  };
  out.progress = {
    ...d.progress,
    ...(s.progress || {}),
  };
  out.progress.failCounts = {
    ...(d.progress.failCounts || {}),
    ...((s.progress || {}).failCounts || {}),
  };
  out.progress.fileFailCounts = {
    ...(d.progress.fileFailCounts || {}),
    ...((s.progress || {}).fileFailCounts || {}),
  };
  out.progress.knowledgeFilesFailCounts = {
    ...(d.progress.knowledgeFilesFailCounts || {}),
    ...((s.progress || {}).knowledgeFilesFailCounts || {}),
  };
  if (!Array.isArray(out.progress.filePending)) out.progress.filePending = [];
  if (!Array.isArray(out.progress.fileDead)) out.progress.fileDead = [];
  if (!Array.isArray(out.progress.knowledgeFilesExported))
    out.progress.knowledgeFilesExported = [];
  if (!Array.isArray(out.progress.knowledgeFilesPending))
    out.progress.knowledgeFilesPending = [];
  if (!Array.isArray(out.progress.knowledgeFilesDead))
    out.progress.knowledgeFilesDead = [];
  if (typeof out.progress.fileDoneCount !== "number")
    out.progress.fileDoneCount = 0;
  if (Array.isArray(out.progress.exported)) {
    const migrated: Record<string, number> = {};
    const arr = out.progress.exported as unknown as string[];
    for (let i = 0; i < arr.length; i++) migrated[arr[i]] = 0;
    out.progress.exported = migrated;
  }
  if (
    !out.progress.exported ||
    typeof out.progress.exported !== "object" ||
    Array.isArray(out.progress.exported)
  )
    out.progress.exported = {};
  out.scan = {
    ...d.scan,
    ...(s.scan || {}),
  };
  out.stats = {
    ...d.stats,
    ...(s.stats || {}),
  };
  out.run = {
    ...d.run,
    ...(s.run || {}),
  };
  out.changes = {
    ...d.changes,
    ...(s.changes || {}),
  };
  out.logs = Array.isArray(s.logs) ? s.logs.slice(-200) : [];
  return out;
};
