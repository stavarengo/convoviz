import type { ExportState } from "../types";
import type { UI } from "../ui/panel";
import type { BootstrapResult } from "../bootstrap";
import { now, fmtMs } from "../utils/format";
import { sleep } from "../net/sleep";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CoordinatorNet {
  getToken(signal?: AbortSignal): Promise<string>;
}

export interface CoordinatorDeps extends BootstrapResult {
  S: ExportState;
  ui: UI & { ensureTick?: () => void };
  addLog: (msg: string) => void;
  saveDebounce: (immediate: boolean) => void;
  assertOnChatGPT: () => void;
  net: CoordinatorNet;
  onExportComplete?: () => Promise<void>;
}

export interface Coordinator {
  abort: AbortController | null;
  _scanAbort: AbortController | null;
  stopRequested: boolean;
  scanPromise: Promise<unknown> | null;
  chatQueue: BootstrapResult["chatQueue"] | null;
  attachmentQueue: BootstrapResult["attachmentQueue"] | null;
  knowledgeQueue: BootstrapResult["knowledgeQueue"] | null;
  rescan(force: boolean): Promise<void>;
  start(): Promise<void>;
  stop(): void;
}

export function createCoordinator(deps: CoordinatorDeps): Coordinator {
  const {
    S,
    ui,
    eventBus,
    chatQueue,
    attachmentQueue,
    knowledgeQueue,
    conversationScanner,
    projectScanner,
    setScanAbortSignal,
    getSpawnedScannerPromises,
    addLog,
    saveDebounce,
    assertOnChatGPT,
    net,
  } = deps;

  let scanAbortController: AbortController | null = null;

  const coordinator: Coordinator = {
    abort: null,
    _scanAbort: null,
    stopRequested: false,
    scanPromise: null,
    chatQueue,
    attachmentQueue,
    knowledgeQueue,

    async rescan(force: boolean): Promise<void> {
      if (S.run.isRunning && !force) {
        addLog("Can't rescan while running. Stop first.");
        return;
      }
      if (coordinator.scanPromise) return coordinator.scanPromise as Promise<void>;
      const ac = new AbortController();
      coordinator._scanAbort = ac;
      scanAbortController = ac;
      setScanAbortSignal(ac.signal);
      if (ui && ui.ensureTick) ui.ensureTick();

      coordinator.scanPromise = (async () => {
        try {
          assertOnChatGPT();
          addLog("Rescan started\u2026");
          ui.setStatus("Scanning\u2026");

          const convPromise = conversationScanner.start(ac.signal);
          const projPromise = projectScanner.start(ac.signal);

          await Promise.all([convPromise, projPromise]);

          // Wait for project-spawned scanners
          const spawned = getSpawnedScannerPromises();
          if (spawned.length > 0) {
            await Promise.allSettled(spawned);
          }

          if (!ac.signal.aborted) {
            ui.setStatus("Rescan done.");
            addLog("Rescan done.");
          }
        } catch (e: any) {
          if (e && e.name === "AbortError") {
            ui.setStatus("Scan stopped.");
            addLog("Scan stopped.");
          } else {
            S.run.lastError = String((e && e.message) || e);
            saveDebounce(true);
            ui.setStatus("Rescan error: " + ((e && e.message) || e));
            addLog("Rescan error: " + ((e && e.message) || e));
            console.error(e);
          }
        } finally {
          coordinator._scanAbort = null;
          scanAbortController = null;
          coordinator.scanPromise = null;
          saveDebounce(false);
        }
      })();
      return coordinator.scanPromise as Promise<void>;
    },

    async start(): Promise<void> {
      if (S.run.isRunning) {
        addLog("Already running.");
        return;
      }
      try {
        assertOnChatGPT();
        coordinator.stopRequested = false;
        const ac = new AbortController();
        coordinator.abort = ac;
        if (ui && ui.ensureTick) ui.ensureTick();
        S.run.lastError = "";
        S.run.startedAt = now();
        saveDebounce(true);
        ui.renderAll();
        addLog("Start.");
        ui.setStatus("Preparing\u2026");
        await net.getToken(ac.signal);

        if (S.run.backoffUntil && S.run.backoffUntil > now()) {
          const wait = S.run.backoffUntil - now();
          ui.setStatus("Backoff carryover \u2192 sleeping " + fmtMs(wait));
          addLog("Backoff carryover: sleeping " + fmtMs(wait) + "\u2026");
          await sleep(wait, ac.signal);
        }

        if (coordinator.stopRequested || ac.signal.aborted) {
          ui.setStatus("Paused.");
          addLog("Stopped.");
          return;
        }

        S.run.isRunning = true;
        saveDebounce(true);
        ui.renderAll();
        ui.setStatus("Running\u2026");

        // Coordinator promise: resolves when all scanners finish and all queues drain
        let resolveCoordinator: (() => void) | null = null;
        const coordinatorPromise = new Promise<void>((resolve) => {
          resolveCoordinator = resolve;
        });

        let chatDrained = false;
        let knowledgeDrained = false;
        let attachmentDrained = false;
        let scannersComplete = false;

        const checkCompletion = (): void => {
          const attStats = attachmentQueue.stats;
          const attIdle = attStats.pending === 0 && attStats.active === 0;

          if (chatDrained && attIdle) {
            attachmentDrained = true;
          }

          if (scannersComplete && chatDrained && knowledgeDrained && attachmentDrained) {
            if (attachmentQueue.isRunning) {
              attachmentQueue.stop();
            }
            if (resolveCoordinator) {
              const r = resolveCoordinator;
              resolveCoordinator = null;
              r();
            }
          } else if (chatDrained && !attachmentDrained) {
            ui.setStatus("Chats done. Files still downloading\u2026");
          }
        };

        // Listen for scanner-complete events to track scanning progress
        let generalScannerDone = false;
        let projectScannerDone = false;

        const unsubScannerComplete = eventBus.on("scanner-complete", (payload) => {
          if (payload.scannerId === "general") {
            generalScannerDone = true;
          } else if (payload.scannerId === "project-scanner") {
            projectScannerDone = true;
          }
          if (generalScannerDone && projectScannerDone) {
            scannersComplete = true;
            checkCompletion();
          }
        });

        // Set up scan abort controller and share signal with bootstrap
        const scanAc = new AbortController();
        scanAbortController = scanAc;
        setScanAbortSignal(scanAc.signal);

        // Link parent abort to scan abort
        const onParentAbort = (): void => scanAc.abort();
        ac.signal.addEventListener("abort", onParentAbort, { once: true });

        // Start scanners
        const convScanPromise = conversationScanner.start(scanAc.signal).catch((e: any) => {
          if (e && e.name !== "AbortError") console.error(e);
        });
        const projScanPromise = projectScanner.start(scanAc.signal).catch((e: any) => {
          if (e && e.name !== "AbortError") console.error(e);
        });

        // Start all queues
        const chatStartPromise = chatQueue.start(ac.signal);
        attachmentQueue.start(ac.signal);
        const knowledgeStartPromise = knowledgeQueue.start(ac.signal);

        // Track queue drain
        chatStartPromise.then(() => {
          chatDrained = true;
          checkCompletion();
        });
        knowledgeStartPromise.then(() => {
          knowledgeDrained = true;
          checkCompletion();
        });

        // Wait for scanners to finish
        await Promise.all([convScanPromise, projScanPromise]);

        // Wait for project-spawned scanners
        const spawned = getSpawnedScannerPromises();
        if (spawned.length > 0) {
          await Promise.allSettled(spawned);
        }

        ac.signal.removeEventListener("abort", onParentAbort);

        // If scanners finished but scanner-complete events didn't fire
        // (e.g., both scanned 0 items, or were aborted), mark as complete
        if (!scannersComplete) {
          scannersComplete = true;
          checkCompletion();
        }

        // Handle immediate completion if queues have no work
        if (chatQueue.stats.pending === 0 && chatQueue.stats.active === 0) {
          chatDrained = true;
        }
        if (knowledgeQueue.stats.pending === 0 && knowledgeQueue.stats.active === 0) {
          knowledgeDrained = true;
        }
        checkCompletion();

        // Listen for abort to resolve coordinator
        const onAbort = (): void => {
          if (resolveCoordinator) {
            const r = resolveCoordinator;
            resolveCoordinator = null;
            r();
          }
        };
        ac.signal.addEventListener("abort", onAbort, { once: true });

        await coordinatorPromise;

        ac.signal.removeEventListener("abort", onAbort);
        unsubScannerComplete();

        // Determine final status
        const anyPending =
          S.progress.pending.length > 0 ||
          (S.progress.knowledgeFilesPending || []).length > 0;

        if (coordinator.stopRequested) {
          ui.setStatus("Paused.");
          addLog("Stopped.");
        } else if (anyPending) {
          ui.setStatus("Paused.");
          addLog("Paused. Some items pending.");
        } else {
          ui.setStatus("\u2705 All done.");
          addLog("All done.");
          if (deps.onExportComplete) {
            await deps.onExportComplete();
          }
        }
      } catch (e: any) {
        if (e && e.name === "AbortError") {
          ui.setStatus("Paused.");
          addLog("Stopped.");
        } else {
          S.run.lastError = String((e && e.message) || e);
          ui.setStatus("\u274C Error: " + ((e && e.message) || e));
          addLog("Error: " + ((e && e.message) || e));
          console.error(e);
        }
      } finally {
        S.run.isRunning = false;
        S.run.stoppedAt = now();
        saveDebounce(true);
        ui.renderAll();
        coordinator.abort = null;
        scanAbortController = null;
      }
    },

    stop(): void {
      if (
        !coordinator.abort &&
        !coordinator._scanAbort &&
        !S.run.isRunning
      ) {
        addLog("Not running.");
        return;
      }
      coordinator.stopRequested = true;
      S.run.isRunning = false;
      saveDebounce(true);
      addLog("Stop requested\u2026");
      ui.setStatus("Stopping\u2026");
      chatQueue.stop();
      attachmentQueue.stop();
      knowledgeQueue.stop();
      eventBus.clear();
      if (coordinator.abort) coordinator.abort.abort();
      if (coordinator._scanAbort) coordinator._scanAbort.abort();
      if (scanAbortController) scanAbortController.abort();
    },
  };

  return coordinator;
}
