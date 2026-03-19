/**
 * Main-thread bridge to the background Web Worker.
 *
 * Responsibilities:
 *   - Spawning the worker from a Blob URL
 *   - Dispatching typed commands
 *   - Receiving state / log / status updates and invoking callbacks
 *   - Version-aware reconnection (re-running the bookmarklet)
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  WorkerLogEntry,
  WorkerStatePayload,
} from "./protocol";
import type { ExportState, Task, Settings } from "../types";
import { VER } from "../state/defaults";

/* ------------------------------------------------------------------ */
/*  Public interface                                                    */
/* ------------------------------------------------------------------ */

export interface WorkerBridge {
  /** The underlying Worker instance. */
  readonly worker: Worker;

  /** Latest state snapshot from the worker (null until first "state" msg). */
  state: ExportState | null;

  /** Latest visible task list from the worker. */
  tasks: Task[];

  /** Latest queue stats from the worker. */
  queues: WorkerStatePayload["queues"] | null;

  /** Whether the worker is currently scanning. */
  scanning: boolean;

  /** Session log entries forwarded from the worker. */
  sessionLogs: WorkerLogEntry[];

  /* --- callbacks (set by main.ts) --- */
  onStateUpdate: ((payload: WorkerStatePayload) => void) | null;
  onStatus: ((message: string) => void) | null;
  onLog: ((entry: WorkerLogEntry) => void) | null;
  onReady: ((version: string, sessionId: string) => void) | null;
  onError: ((message: string) => void) | null;
  onResetDone: (() => void) | null;

  /* --- commands → worker --- */
  send(msg: MainToWorkerMessage): void;
  start(): void;
  stop(): void;
  rescan(force: boolean): void;
  updateSettings(settings: Partial<Settings>): void;
  reset(): void;
  terminate(): void;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createWorkerBridge(workerCode: string): WorkerBridge {
  const blob = new Blob([workerCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  // Revoke immediately — the worker keeps its own reference.
  URL.revokeObjectURL(url);

  const bridge: WorkerBridge = {
    worker,
    state: null,
    tasks: [],
    queues: null,
    scanning: false,
    sessionLogs: [],

    onStateUpdate: null,
    onStatus: null,
    onLog: null,
    onReady: null,
    onError: null,
    onResetDone: null,

    send(msg: MainToWorkerMessage): void {
      worker.postMessage(msg);
    },
    start(): void {
      bridge.send({ type: "start" });
    },
    stop(): void {
      bridge.send({ type: "stop" });
    },
    rescan(force: boolean): void {
      bridge.send({ type: "rescan", force });
    },
    updateSettings(settings: Partial<Settings>): void {
      bridge.send({ type: "update-settings", settings });
    },
    reset(): void {
      bridge.send({ type: "reset" });
    },
    terminate(): void {
      worker.terminate();
    },
  };

  /* --- inbound message router --- */

  worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
    const msg = e.data;
    switch (msg.type) {
      case "ready":
        if (bridge.onReady) bridge.onReady(msg.version, msg.sessionId);
        break;

      case "state":
        bridge.state = msg.state;
        bridge.tasks = msg.tasks;
        bridge.queues = msg.queues;
        bridge.scanning = msg.scanning;
        if (bridge.onStateUpdate) bridge.onStateUpdate(msg);
        break;

      case "status":
        if (bridge.onStatus) bridge.onStatus(msg.message);
        break;

      case "log":
        bridge.sessionLogs.push(msg.entry);
        if (bridge.onLog) bridge.onLog(msg.entry);
        break;

      case "error":
        if (bridge.onError) bridge.onError(msg.message);
        break;

      case "pong":
        // Handled by pingWorker() promise below.
        break;

      case "reset-done":
        if (bridge.onResetDone) bridge.onResetDone();
        break;
    }
  };

  worker.onerror = (e: ErrorEvent) => {
    if (bridge.onError) bridge.onError("Worker error: " + e.message);
  };

  // Kick off initialization.
  bridge.send({ type: "init" });

  return bridge;
}

/* ------------------------------------------------------------------ */
/*  Version check for existing worker                                  */
/* ------------------------------------------------------------------ */

/**
 * Pings an existing worker bridge and resolves with its version,
 * or null if the worker doesn't respond within `timeoutMs`.
 */
export function pingWorker(
  bridge: WorkerBridge,
  timeoutMs = 2000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      bridge.worker.removeEventListener("message", handler);
      resolve(null);
    }, timeoutMs);

    const handler = (e: MessageEvent<WorkerToMainMessage>): void => {
      if (e.data.type === "pong") {
        clearTimeout(timer);
        bridge.worker.removeEventListener("message", handler);
        resolve(e.data.version);
      }
    };

    bridge.worker.addEventListener("message", handler);
    bridge.send({ type: "ping" });
  });
}

/**
 * Determines whether we can reuse an existing worker or need to create
 * a new one. Returns the bridge to use (existing or freshly created).
 */
export async function getOrCreateBridge(
  workerCode: string,
  existingBridge: WorkerBridge | null,
): Promise<WorkerBridge> {
  if (existingBridge) {
    const version = await pingWorker(existingBridge);
    if (version === VER) {
      // Same version — reuse.
      return existingBridge;
    }
    // Different version or unresponsive — terminate and recreate.
    existingBridge.terminate();
  }
  return createWorkerBridge(workerCode);
}
