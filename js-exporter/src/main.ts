import { initIdb, Store, isUsingLocalStorage } from "./state/store";
import { initExportBlobsIdb, ExportBlobStore } from "./state/export-blobs";
import { KEY, VER } from "./state/defaults";
import { createSaveDebounce } from "./state/debounce";
import { initLogger, log, getSessionId, getSessionLogs, getLogCount, getAllLogs, clearLogs, serializeLogsJsonl } from "./state/logger";
import { registerGlobalErrorHandlers } from "./state/global-error-handlers";
import { createNet } from "./net/net";
import { createTaskList } from "./ui/task-list";
import { createUI } from "./ui/panel";
import { bootstrap } from "./bootstrap";
import { createCoordinator } from "./export/coordinator";
import { createDiscoveryStore } from "./state/discovery-store";
import { downloadFinalZip } from "./export/generate-final-zip";
import { extractFileRefs } from "./scan/file-refs";
import { reconcileExportState } from "./state/reconcile";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const assertOnChatGPT = (): void => {
  const h = location.hostname || "";
  if (!/chatgpt\.com$/.test(h) && !/chat\.openai\.com$/.test(h))
    throw new Error(
      "Run this on chatgpt.com (logged in). Host: " + h,
    );
};

(async () => {
  // Register global error handlers before any async work
  registerGlobalErrorHandlers(log);

  try {
    assertOnChatGPT();
    await initIdb();
    await initExportBlobsIdb();
    await initLogger();

    // Emit startup log entry
    log("info", "sys", "Session started", {
      version: VER,
      sessionId: getSessionId(),
      storageBackend: isUsingLocalStorage() ? "localStorage" : "idb",
      userAgent: navigator.userAgent,
    });

    let S = await Store.load();

    const saveDebounce = createSaveDebounce(Store, S);

    const taskList = createTaskList();

    // Late-bound reference for discovery store (created after UI)
    let _discoveryStore: { destroy(): Promise<void> } | null = null;

    const net = createNet({
      S,
      log,
      setStatus: (msg: string) => ui.setStatus(msg),
      saveDebounce,
    });

    const triggerDownload = async (): Promise<void> => {
      await downloadFinalZip({
        exportBlobStore: ExportBlobStore,
        setStatus: (msg: string) => ui.setStatus(msg),
      });
    };

    const ui = createUI({
      S,
      log,
      net,
      taskList,
      saveDebounce,
      getAccumulatedSize: () => ExportBlobStore.totalSize(),
      onDownload: triggerDownload,
      onReset: async () => {
        await Store.destroy();
        await ExportBlobStore.destroy();
        if (_discoveryStore) await _discoveryStore.destroy();
        localStorage.removeItem(KEY);
        location.reload();
      },
      getSessionLogs,
      getLogCount,
      onDownloadLogs: async () => {
        const entries = await getAllLogs();
        const jsonl = serializeLogsJsonl(entries);
        const blob = new Blob([jsonl], { type: "application/x-ndjson" });
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const filename = "cvz-logs-" +
          now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) +
          "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + ".jsonl";
        net.download(blob, filename);
      },
    });

    // Reconcile IDB export data with state after a potential page reload.
    await reconcileExportState({
      S,
      getAllConvKeys: () => ExportBlobStore.getAllConvKeys(),
      saveDebounce,
      log,
    });

    // Initialize discovery store and seed from existing export state
    const discoveryStore = createDiscoveryStore();
    await discoveryStore.init();
    await discoveryStore.seedFromExportState(S.progress.exported || {});
    _discoveryStore = discoveryStore;

    // Bootstrap event-driven components
    const components = bootstrap({
      S,
      net,
      discoveryStore,
      exportBlobStore: ExportBlobStore,
      taskList,
      log,
      saveDebounce,
      extractFileRefs,
    });

    // Create thin coordinator
    const coordinator = createCoordinator({
      ...components,
      S,
      ui,
      log,
      saveDebounce,
      assertOnChatGPT,
      net,
      onExportComplete: triggerDownload,
    });

    // Wire coordinator into UI (for start/stop/rescan buttons)
    (ui as any).setExporter(coordinator);

    // Inject the floating panel
    ui.inject();

    // Expose globals (matching the monolith)
    (window as any).__cvz_S = S;
    (window as any).__cvz_Net = net;
    (window as any).__cvz_Exporter = coordinator;
    (window as any).__cvz_UI = ui;
    (window as any).__cvz_TaskList = taskList;

    // Expose convenience aliases per FR-9
    (window as any).__cvz_state = S;
    (window as any).__cvz_stop = () => coordinator.stop();
    (window as any).__cvz_clearLogs = async () => {
      await clearLogs();
      console.log("Convoviz: log store cleared");
    };
    (window as any).__cvz_reset = async () => {
      await Store.destroy();
      await ExportBlobStore.destroy();
      await discoveryStore.destroy();
      localStorage.removeItem(KEY);
      location.reload();
    };

    // Handle interrupted-run recovery
    if (S.run.isRunning) {
      S.run.isRunning = false;
      S.run.lastError =
        S.run.lastError || "Previous run interrupted (reload?)";
      log("warn", "sys", "Detected interrupted run. State preserved; click Start to resume.");
      saveDebounce(true);
      ui.renderAll();
    }

    // Initial log and render
    log("info", "sys", "UI ready", {
      version: VER,
      exported: Object.keys(S.progress.exported || {}).length,
      pending: (S.progress.pending || []).length,
    });
    ui.renderAll();
  } catch (e: any) {
    log("error", "sys", "Bookmarklet startup error", { error: String((e && e.message) || e) });
    alert("Convoviz bookmarklet error: " + ((e && e.message) || e));
  }
})();
