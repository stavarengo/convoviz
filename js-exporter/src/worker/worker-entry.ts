/**
 * Web Worker entry point — runs all export processing in a background thread.
 *
 * This module is bundled separately by esbuild, then embedded as a string
 * constant in the main bundle. At runtime the main thread creates a Blob URL
 * from that string and spawns a Worker.
 *
 * The worker owns:
 *   - ExportState (persisted in IDB)
 *   - Queues (chat, attachment, knowledge)
 *   - Scanners (conversation, project)
 *   - Network layer (fetch with credentials)
 *   - Logger (IDB-backed)
 *
 * The main thread owns:
 *   - DOM / UI rendering
 *   - File downloads (showSaveFilePicker)
 */

import { initIdb, Store } from "../state/store";
import { initExportBlobsIdb, ExportBlobStore } from "../state/export-blobs";
import { KEY, VER } from "../state/defaults";
import { createSaveDebounce } from "../state/debounce";
import {
  initLogger,
  log as rawLog,
  getSessionId,
} from "../state/logger";
import { createNet } from "../net/net";
import { createTaskList } from "../ui/task-list";
import { bootstrap } from "../bootstrap";
import { createCoordinator } from "../export/coordinator";
import type { Coordinator } from "../export/coordinator";
import { createDiscoveryStore } from "../state/discovery-store";
import { extractFileRefs } from "../scan/file-refs";
import { reconcileExportState } from "../state/reconcile";
import type { ExportState } from "../types";
import type { LogLevel } from "../state/logger";
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  WorkerLogEntry,
  QueueSnapshot,
} from "./protocol";
import type { BootstrapResult } from "../bootstrap";
import type { UI } from "../ui/panel";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
const ctx = self as any;

function post(msg: WorkerToMainMessage): void {
  ctx.postMessage(msg);
}

/* ------------------------------------------------------------------ */
/*  Worker-scoped error handlers                                       */
/* ------------------------------------------------------------------ */

ctx.addEventListener("error", (e: ErrorEvent) => {
  rawLog("error", "sys", "Worker uncaught error: " + e.message, {
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
  });
});

ctx.addEventListener(
  "unhandledrejection",
  (e: PromiseRejectionEvent) => {
    rawLog("error", "sys", "Worker unhandled rejection", {
      reason: String(e.reason),
    });
  },
);

/* ------------------------------------------------------------------ */
/*  Mutable worker state                                               */
/* ------------------------------------------------------------------ */

let coordinator: Coordinator | null = null;
let S: ExportState | null = null;
let components: BootstrapResult | null = null;
let discoveryStoreRef: { destroy(): Promise<void> } | null = null;
let _tickId: ReturnType<typeof setInterval> | 0 = 0;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const emptyQueueSnap: QueueSnapshot = { pending: 0, active: 0, done: 0, dead: 0 };

function queueSnap(q: { readonly stats: { pending: number; active: number; done: number; dead: number } } | null | undefined): QueueSnapshot {
  if (!q) return emptyQueueSnap;
  const s = q.stats;
  return { pending: s.pending, active: s.active, done: s.done, dead: s.dead };
}

function broadcastState(): void {
  if (!S) return;
  const taskList = components ? undefined : undefined; // tasks come from getVisible below
  post({
    type: "state",
    state: JSON.parse(JSON.stringify(S)),
    tasks: _taskList ? _taskList.getVisible() : [],
    queues: {
      chat: queueSnap(components?.chatQueue),
      attachment: queueSnap(components?.attachmentQueue),
      knowledge: queueSnap(components?.knowledgeQueue),
    },
    scanning: !!(coordinator && coordinator.scanPromise),
  });
}

let _taskList: ReturnType<typeof createTaskList> | null = null;

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */

async function init(): Promise<void> {
  await initIdb();
  await initExportBlobsIdb();
  await initLogger();

  /** Worker log wrapper — persists AND forwards to main thread. */
  const workerLog = (
    level: LogLevel,
    category: string,
    message: string,
    context?: Record<string, unknown>,
  ): void => {
    rawLog(level, category, message, context);
    const entry: WorkerLogEntry = {
      timestamp: Date.now(),
      session: getSessionId(),
      level,
      category,
      message,
      ...(context !== undefined ? { context } : {}),
    };
    post({ type: "log", entry });
  };

  workerLog("info", "sys", "Worker session started", {
    version: VER,
    sessionId: getSessionId(),
  });

  S = await Store.load();

  const saveDebounce = createSaveDebounce(Store, S);

  /** Wrapped save that also triggers a state broadcast. */
  let _broadcastScheduled = false;
  const wrappedSaveDebounce = (immediate: boolean): void => {
    saveDebounce(immediate);
    // Throttle broadcasts to at most once per 250ms
    if (!_broadcastScheduled) {
      _broadcastScheduled = true;
      setTimeout(() => {
        _broadcastScheduled = false;
        broadcastState();
      }, 250);
    }
  };

  _taskList = createTaskList();

  const net = createNet({
    S,
    log: workerLog,
    setStatus: (msg: string) => post({ type: "status", message: msg }),
    saveDebounce: wrappedSaveDebounce,
  });

  // Reconcile IDB export data with state
  await reconcileExportState({
    S,
    getAllConvKeys: () => ExportBlobStore.getAllConvKeys(),
    saveDebounce: wrappedSaveDebounce,
    log: workerLog,
  });

  // Discovery store
  const discoveryStore = createDiscoveryStore();
  await discoveryStore.init();
  await discoveryStore.seedFromExportState(S.progress.exported || {});
  discoveryStoreRef = discoveryStore;

  // Bootstrap event-driven components
  components = bootstrap({
    S,
    net,
    discoveryStore,
    exportBlobStore: ExportBlobStore,
    taskList: _taskList,
    log: workerLog,
    saveDebounce: wrappedSaveDebounce,
    extractFileRefs,
  });

  // Proxy UI — coordinator expects a UI reference for setStatus / renderAll
  const proxyUI: UI & { ensureTick(): void } = {
    container: null,
    inject(): void {},
    renderAll(): void {
      broadcastState();
    },
    renderLogs(): void {},
    renderProjects(): void {},
    setStatus(msg: string): void {
      post({ type: "status", message: msg });
    },
    setBar(): void {},
    async updateDownloadButton(): Promise<void> {},
    ensureTick(): void {
      if (_tickId) return;
      _tickId = setInterval(() => {
        broadcastState();
        if (S && !S.run.isRunning && !(coordinator && coordinator.scanPromise)) {
          clearInterval(_tickId as ReturnType<typeof setInterval>);
          _tickId = 0;
        }
      }, 1000);
    },
  };

  coordinator = createCoordinator({
    ...components,
    S,
    ui: proxyUI,
    log: workerLog,
    saveDebounce: wrappedSaveDebounce,
    assertOnChatGPT: () => {}, // already validated on main thread
    net,
  });

  // Handle interrupted-run recovery
  if (S.run.isRunning) {
    S.run.isRunning = false;
    S.run.lastError =
      S.run.lastError || "Previous run interrupted (reload?)";
    workerLog(
      "warn",
      "sys",
      "Detected interrupted run. State preserved; click Start to resume.",
    );
    wrappedSaveDebounce(true);
  }

  workerLog("info", "sys", "Worker ready", {
    version: VER,
    exported: Object.keys(S.progress.exported || {}).length,
    pending: (S.progress.pending || []).length,
  });

  post({ type: "ready", version: VER, sessionId: getSessionId() });
  broadcastState();
}

/* ------------------------------------------------------------------ */
/*  Message handler                                                    */
/* ------------------------------------------------------------------ */

ctx.onmessage = async (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case "init":
      try {
        await init();
      } catch (err: any) {
        post({
          type: "error",
          message: String(err?.message || err),
        });
      }
      break;

    case "start":
      if (coordinator) coordinator.start();
      break;

    case "stop":
      if (coordinator) coordinator.stop();
      break;

    case "rescan":
      if (coordinator) coordinator.rescan(msg.force);
      break;

    case "update-settings":
      if (S) {
        const s = msg.settings;
        if (s.chatConcurrency !== undefined)
          S.settings.chatConcurrency = s.chatConcurrency;
        if (s.fileConcurrency !== undefined)
          S.settings.fileConcurrency = s.fileConcurrency;
        if (s.knowledgeFileConcurrency !== undefined)
          S.settings.knowledgeFileConcurrency = s.knowledgeFileConcurrency;
        if (s.pause !== undefined) S.settings.pause = s.pause;
        if (s.filterGizmoId !== undefined)
          S.settings.filterGizmoId = s.filterGizmoId ?? null;

        // Update queue concurrency live
        if (coordinator) {
          if (s.chatConcurrency !== undefined && coordinator.chatQueue) {
            coordinator.chatQueue.setConcurrency(s.chatConcurrency);
          }
          if (s.fileConcurrency !== undefined && coordinator.attachmentQueue) {
            coordinator.attachmentQueue.setConcurrency(s.fileConcurrency);
          }
          if (
            s.knowledgeFileConcurrency !== undefined &&
            coordinator.knowledgeQueue
          ) {
            coordinator.knowledgeQueue.setConcurrency(
              s.knowledgeFileConcurrency,
            );
          }
        }
        broadcastState();
      }
      break;

    case "reset":
      if (coordinator) coordinator.stop();
      try {
        await Store.destroy();
        await ExportBlobStore.destroy();
        if (discoveryStoreRef) await discoveryStoreRef.destroy();
        // Clear localStorage key if accessible (main thread context)
        if (typeof globalThis.localStorage !== "undefined") {
          globalThis.localStorage.removeItem(KEY);
        }
      } catch (err: any) {
        rawLog("error", "sys", "Reset error", {
          error: String(err?.message || err),
        });
      }
      post({ type: "reset-done" });
      break;

    case "ping":
      post({ type: "pong", version: VER });
      break;
  }
};
