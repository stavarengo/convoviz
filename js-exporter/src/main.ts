import type { ExportState } from "./types";
import { initIdb, Store } from "./state/store";
import { initExportBlobsIdb, ExportBlobStore } from "./state/export-blobs";
import { VER } from "./state/defaults";
import { createSaveDebounce } from "./state/debounce";
import { createNet } from "./net/net";
import { createTaskList } from "./ui/task-list";
import { createUI } from "./ui/panel";
import { createExporter } from "./export/exporter";
import { downloadFinalZip } from "./export/generate-final-zip";
import { scanConversations } from "./scan/conversations";
import { scanProjects, scanProjectConversations } from "./scan/projects";
import { extractFileRefs } from "./scan/file-refs";
import { computeChanges } from "./scan/changes";
import { reconcileExportState } from "./state/reconcile";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const assertOnChatGPT = (): void => {
  const h = location.hostname || "";
  if (!/chatgpt\.com$/.test(h) && !/chat\.openai\.com$/.test(h))
    throw new Error(
      "Run this on chatgpt.com (logged in). Host: " + h,
    );
};

export const createAddLog = (
  S: ExportState,
  saveDebounce: (immediate: boolean) => void,
  renderLogs: () => void,
): ((msg: string) => void) => {
  return (msg: string): void => {
    const stamp = new Date().toLocaleTimeString();
    const line = "[" + stamp + "] " + msg;
    S.logs.push(line);
    if (S.logs.length > 200) S.logs = S.logs.slice(-200);
    saveDebounce(false);
    renderLogs();
  };
};

(async () => {
  try {
    assertOnChatGPT();
    await initIdb();
    await initExportBlobsIdb();
    let S = await Store.load();

    const saveDebounce = createSaveDebounce(Store, S);

    const taskList = createTaskList();

    // addLog needs renderLogs from UI, but UI needs addLog.
    // Resolve the circular dependency: addLog calls renderLogs via a late-bound reference.
    let _renderLogs = (): void => {};
    const addLog = createAddLog(S, saveDebounce, () => _renderLogs());

    const net = createNet({
      S,
      addLog,
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
      addLog,
      net,
      taskList,
      saveDebounce,
      getAccumulatedSize: () => ExportBlobStore.totalSize(),
      onDownload: triggerDownload,
      onReset: async () => {
        await Store.reset();
        await ExportBlobStore.clear();
        S = await Store.load();
        addLog("State reset.");
        ui.renderAll();
      },
    });

    // Now wire the late-bound renderLogs reference
    _renderLogs = () => ui.renderLogs();

    // Reconcile IDB export data with state after a potential page reload.
    // Conversations written to IDB but not yet reflected in S.progress.exported
    // (due to debounce not firing before reload) get added back.
    await reconcileExportState({
      S,
      getAllConvKeys: () => ExportBlobStore.getAllConvKeys(),
      saveDebounce,
      addLog,
    });

    const exporter = createExporter({
      S,
      net,
      ui,
      taskList,
      exportBlobStore: ExportBlobStore,
      addLog,
      saveDebounce,
      scanConversations,
      scanProjects,
      scanProjectConversations,
      extractFileRefs,
      computeChanges,
      assertOnChatGPT,
      onExportComplete: triggerDownload,
    });

    // Wire exporter into UI (for start/stop/rescan buttons)
    (ui as any).setExporter(exporter);

    // Inject the floating panel
    ui.inject();

    // Expose globals (matching the monolith)
    (window as any).__cvz_S = S;
    (window as any).__cvz_Net = net;
    (window as any).__cvz_Exporter = exporter;
    (window as any).__cvz_UI = ui;
    (window as any).__cvz_TaskList = taskList;

    // Expose convenience aliases per FR-9
    (window as any).__cvz_state = S;
    (window as any).__cvz_stop = () => exporter.stop();
    (window as any).__cvz_reset = async () => {
      await Store.reset();
      await ExportBlobStore.clear();
      S = await Store.load();
      addLog("State reset via __cvz_reset.");
      ui.renderAll();
    };

    // Handle interrupted-run recovery
    if (S.run.isRunning) {
      S.run.isRunning = false;
      S.run.lastError =
        S.run.lastError || "Previous run interrupted (reload?)";
      addLog(
        "Detected interrupted run. State preserved; click Start to resume.",
      );
      saveDebounce(true);
      ui.renderAll();
    }

    // Initial logs and render
    S.logs = [];
    addLog(VER);
    addLog(
      "UI ready. Exported " +
        Object.keys(S.progress.exported || {}).length +
        ", pending " +
        (S.progress.pending || []).length +
        ". Click Rescan then Start.",
    );
    ui.renderAll();
  } catch (e: any) {
    console.error(e);
    alert("Convoviz bookmarklet error: " + ((e && e.message) || e));
  }
})();
