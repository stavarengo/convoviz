/**
 * Main-thread entry point — UI control panel + worker launcher.
 *
 * All export processing (queues, scanners, network, state) runs inside
 * a dedicated Web Worker. This thread only handles DOM rendering,
 * user interaction, and file downloads (which require DOM access).
 */

import { VER, KEY } from "./state/defaults";
import { initExportBlobsIdb, ExportBlobStore } from "./state/export-blobs";
import {
  initLogger,
  getSessionLogs as _getSessionLogs,
  getLogCount,
  getAllLogs,
  clearLogs,
  serializeLogsJsonl,
  formatLogLine,
} from "./state/logger";
import type { LogLevel } from "./state/logger";
import { defaultState } from "./state/defaults";
import { isUsingLocalStorage } from "./state/store";
import { createUI } from "./ui/panel";
import type { ExporterRef } from "./ui/panel";
import { downloadFinalZip } from "./export/generate-final-zip";
import { getOrCreateBridge } from "./worker/bridge";
import type { WorkerBridge } from "./worker/bridge";
import type { WorkerStatePayload, WorkerLogEntry } from "./worker/protocol";
import type { ExportState, Task } from "./types";

// Inline worker code — injected at build time by build.mjs
declare const __WORKER_CODE__: string;

/* eslint-disable @typescript-eslint/no-explicit-any */

export const assertOnChatGPT = (): void => {
  const h = location.hostname || "";
  if (!/chatgpt\.com$/.test(h) && !/chat\.openai\.com$/.test(h))
    throw new Error(
      "Run this on chatgpt.com (logged in). Host: " + h,
    );
};

/* ------------------------------------------------------------------ */
/*  Deep-merge a state snapshot into an existing object (keeps ref)    */
/* ------------------------------------------------------------------ */

function mergeInto(target: ExportState, source: ExportState): void {
  target.v = source.v;
  target.ver = source.ver;
  target.projects = source.projects;
  Object.assign(target.settings, source.settings);
  Object.assign(target.progress, source.progress);
  Object.assign(target.scan, source.scan);
  Object.assign(target.stats, source.stats);
  Object.assign(target.run, source.run);
  Object.assign(target.changes, source.changes);
}

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */

(async () => {
  try {
    assertOnChatGPT();

    // Initialize logger for main-thread log display
    await initLogger();

    // Initialize blob store on main thread for downloads
    await initExportBlobsIdb();

    // Mutable state object — the UI reads from this reference.
    // Updated in-place when the worker sends snapshots.
    const S: ExportState = defaultState();

    // Session logs collected from worker
    const sessionLogs: WorkerLogEntry[] = [];

    // Get or reuse existing worker
    const existingBridge: WorkerBridge | null =
      (window as any).__cvz_bridge ?? null;

    const bridge = await getOrCreateBridge(__WORKER_CODE__, existingBridge);
    (window as any).__cvz_bridge = bridge;

    // Create a simple log function for UI-only events
    const log = (
      level: LogLevel,
      category: string,
      message: string,
      context?: Record<string, unknown>,
    ): void => {
      const entry: WorkerLogEntry = {
        timestamp: Date.now(),
        session: "ui",
        level,
        category,
        message,
        ...(context !== undefined ? { context } : {}),
      };
      sessionLogs.push(entry);
    };

    // Create net stub for UI (only need download method)
    const netStub = {
      token: "",
      _tokenPromise: null,
      _consecutive429: 0,
      async getToken(): Promise<string> { return ""; },
      async _fetch(): Promise<Response> { throw new Error("Not available on main thread"); },
      async fetchJson(): Promise<unknown> { throw new Error("Not available on main thread"); },
      async fetchBlob(): Promise<Blob> { throw new Error("Not available on main thread"); },
      download(blob: Blob, name: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      },
    };

    // Dummy task list for UI — we render tasks from worker snapshots directly
    const taskListProxy = {
      add(): void {},
      update(): void {},
      getVisible(): Task[] {
        return bridge.tasks || [];
      },
      render(): void {
        // Render tasks from latest worker snapshot
        const el = document.getElementById("cvz-tasks");
        if (!el) return;
        const visible = bridge.tasks || [];
        const wasAtBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight < 10;
        let html = "";
        for (let i = 0; i < visible.length; i++) {
          const t = visible[i];
          let prefix = "";
          let style = "";
          if (t.status === "queued") {
            prefix = "\u00b7 ";
            style = "opacity:0.5;";
          } else if (t.status === "active") {
            prefix =
              '<span class="cvz-spin" style="display:inline-block;animation:cvz-spin 1s linear infinite;">\u27f3</span> ';
            style = "color:#10a37f;";
          } else if (t.status === "done") {
            prefix = "\u2713 ";
            style = "opacity:0.6;";
          } else if (t.status === "failed") {
            prefix = "\u2717 ";
            style = "color:#ef4444;";
          }
          const projPrefix = t.projectName
            ? '<span style="opacity:0.7;">[' + t.projectName + "]</span> "
            : "";
          const errorSuffix =
            t.status === "failed" && t.error
              ? ' <span style="opacity:0.8;">(' + t.error + ")</span>"
              : "";
          html +=
            '<div style="' +
            style +
            'padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
            prefix +
            projPrefix +
            t.label +
            errorSuffix +
            "</div>";
          if (t.status === "active" && t.detail) {
            html +=
              '<div style="padding-left:16px;opacity:0.7;padding:1px 0;">\u21b3 ' +
              t.detail +
              "</div>";
          }
        }
        el.innerHTML = html;
        if (wasAtBottom) el.scrollTop = el.scrollHeight;
      },
    };

    // Create exporter ref that proxies to the worker bridge
    const exporterRef: ExporterRef & { scanPromise: Promise<unknown> | null } = {
      scanPromise: null, // Updated from worker state
      start(): void {
        bridge.start();
      },
      stop(): void {
        bridge.stop();
      },
      rescan(full?: boolean): void {
        bridge.rescan(!!full);
      },
      // Queue stats are proxied from worker snapshots
      chatQueue: {
        setConcurrency(n: number): void {
          bridge.updateSettings({ chatConcurrency: n });
        },
        get stats() {
          return bridge.queues?.chat ?? { pending: 0, active: 0, done: 0, dead: 0 };
        },
      },
      attachmentQueue: {
        setConcurrency(n: number): void {
          bridge.updateSettings({ fileConcurrency: n });
        },
        get stats() {
          return bridge.queues?.attachment ?? { pending: 0, active: 0, done: 0, dead: 0 };
        },
      },
      knowledgeQueue: {
        setConcurrency(n: number): void {
          bridge.updateSettings({ knowledgeFileConcurrency: n });
        },
        get stats() {
          return bridge.queues?.knowledge ?? { pending: 0, active: 0, done: 0, dead: 0 };
        },
      },
    };

    const triggerDownload = async (): Promise<void> => {
      await downloadFinalZip({
        exportBlobStore: ExportBlobStore,
        setStatus: (msg: string) => ui.setStatus(msg),
      });
    };

    const ui = createUI({
      S,
      log,
      net: netStub as any,
      taskList: taskListProxy as any,
      saveDebounce: (immediate: boolean) => {
        // Settings changes from UI — forward to worker
        bridge.updateSettings(S.settings);
      },
      requestProjectScan: () => bridge.scanProjects(),
      getAccumulatedSize: () => ExportBlobStore.totalSize(),
      onDownload: triggerDownload,
      onReset: async () => {
        bridge.reset();
        // Worker will post reset-done; we reload in the handler
      },
      getSessionLogs: () => {
        return sessionLogs.map((e) => ({
          timestamp: e.timestamp,
          session: e.session,
          level: e.level,
          category: e.category,
          message: e.message,
          context: e.context,
        }));
      },
      getLogCount,
      onDownloadLogs: async () => {
        const entries = await getAllLogs();
        const jsonl = serializeLogsJsonl(entries);
        const blob = new Blob([jsonl], { type: "application/x-ndjson" });
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const filename =
          "cvz-logs-" +
          now.getFullYear() +
          "-" +
          pad(now.getMonth() + 1) +
          "-" +
          pad(now.getDate()) +
          "-" +
          pad(now.getHours()) +
          pad(now.getMinutes()) +
          pad(now.getSeconds()) +
          ".jsonl";
        netStub.download(blob, filename);
      },
    });

    // Wire the exporter ref (for start/stop/rescan buttons)
    (ui as any).setExporter(exporterRef);

    // Wire bridge callbacks
    bridge.onStateUpdate = (payload: WorkerStatePayload) => {
      mergeInto(S, payload.state);
      // Update scanning flag for exporterRef
      exporterRef.scanPromise = payload.scanning ? Promise.resolve() : null;
      // Trigger UI re-render
      taskListProxy.render();
      ui.renderAll();
    };

    bridge.onStatus = (message: string) => {
      ui.setStatus(message);
    };

    bridge.onLog = (entry: WorkerLogEntry) => {
      sessionLogs.push(entry);
      ui.renderLogs();
    };

    // Copy any already-buffered logs from a reused bridge
    if (bridge.sessionLogs.length > 0) {
      for (const e of bridge.sessionLogs) sessionLogs.push(e);
    }
    // Point bridge's log buffer to our sessionLogs array going forward
    bridge.sessionLogs = sessionLogs;

    bridge.onReady = () => {
      ui.renderAll();
    };

    bridge.onError = (message: string) => {
      ui.setStatus("\u274C Worker error: " + message);
      log("error", "sys", "Worker error: " + message);
    };

    bridge.onResetDone = () => {
      localStorage.removeItem(KEY);
      location.reload();
    };

    // Inject the floating panel
    ui.inject();

    // If we already have a state snapshot (reused bridge), render immediately
    if (bridge.state) {
      mergeInto(S, bridge.state);
      exporterRef.scanPromise = bridge.scanning ? Promise.resolve() : null;
      ui.renderAll();
    }

    // Expose globals (matching the monolith API)
    (window as any).__cvz_S = S;
    (window as any).__cvz_state = S;
    (window as any).__cvz_UI = ui;
    (window as any).__cvz_stop = () => bridge.stop();
    (window as any).__cvz_clearLogs = async () => {
      await clearLogs();
      console.log("Convoviz: log store cleared");
    };
    (window as any).__cvz_reset = async () => {
      bridge.reset();
    };

    log("info", "sys", "UI ready (worker mode)", { version: VER });
    ui.renderAll();
  } catch (e: any) {
    alert("Convoviz bookmarklet error: " + ((e && e.message) || e));
  }
})();
