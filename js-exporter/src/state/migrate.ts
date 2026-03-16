import type { ExportState } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const migrateV2toV3 = (v2: any): ExportState => {
  const progress = v2.progress || {};
  const settings = v2.settings || {};
  const stats = v2.stats || {};
  const run = v2.run || {};

  return {
    v: 3,
    ver: v2.ver,
    projects: v2.projects || [],
    settings: {
      chatConcurrency: settings.conc || 3,
      fileConcurrency: 3,
      knowledgeFileConcurrency: 3,
      pause: settings.pause ?? 300,
      filterGizmoId: settings.filterGizmoId ?? null,
    },
    progress: {
      exported: progress.exported || {},
      pending: progress.pending || [],
      dead: progress.dead || [],
      failCounts: progress.failCounts || {},
      filePending: [],
      fileDead: [],
      fileFailCounts: {},
      fileDoneCount: 0,
      knowledgeFilesExported: progress.kfExported || [],
      knowledgeFilesPending: progress.kfPending || [],
      knowledgeFilesDead: progress.kfDead || [],
      knowledgeFilesFailCounts: progress.kfFailCounts || {},
    },
    scan: v2.scan || { at: 0, total: 0, totalProjects: 0, snapshot: [] },
    stats: {
      chatsExported: stats.chats || 0,
      chatsMs: stats.batchMs || 0,
      filesDownloaded: 0,
      filesMs: 0,
      knowledgeFilesDownloaded: stats.kfFiles || 0,
      knowledgeFilesMs: stats.kfMs || 0,
    },
    run: {
      isRunning: run.isRunning || false,
      startedAt: run.startedAt || 0,
      stoppedAt: run.stoppedAt || 0,
      lastError: run.lastError || "",
      backoffUntil: run.backoffUntil || 0,
      backoffCount: run.backoffCount || 0,
    },
    changes: v2.changes || {
      at: 0,
      newChats: 0,
      removedChats: 0,
      updatedChats: 0,
      newPending: 0,
      pendingDelta: 0,
    },
  };
};
