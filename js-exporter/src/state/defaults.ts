import type { ExportState } from "../types";

export const KEY = "__cvz_export_state_v1__";
export const VER = "cvz-bookmarklet-4.5";

export const defaultState = (): ExportState => ({
  v: 2,
  ver: VER,
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
    kfExported: [],
    kfPending: [],
    kfDead: [],
    kfFailCounts: {},
  },
  scan: {
    at: 0,
    total: 0,
    totalProjects: 0,
    snapshot: [],
  },
  stats: {
    batches: 0,
    batchMs: 0,
    chats: 0,
    kfBatches: 0,
    kfMs: 0,
    kfFiles: 0,
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
  logs: [],
});

export const mergeState = (
  s: Partial<ExportState> | null | undefined,
): ExportState => {
  if (!s || !s.v) return defaultState();
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
  out.progress.kfFailCounts = {
    ...(d.progress.kfFailCounts || {}),
    ...((s.progress || {}).kfFailCounts || {}),
  };
  if (!Array.isArray(out.progress.kfExported)) out.progress.kfExported = [];
  if (!Array.isArray(out.progress.kfPending)) out.progress.kfPending = [];
  if (!Array.isArray(out.progress.kfDead)) out.progress.kfDead = [];
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
