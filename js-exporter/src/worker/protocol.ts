/**
 * Typed message protocol for main-thread ↔ worker communication.
 *
 * Both sides use `postMessage` with these discriminated unions.
 * The `type` field is the discriminant.
 */

import type { ExportState, Task, Settings } from "../types";
import type { LogLevel } from "../state/log-store";

/* ------------------------------------------------------------------ */
/*  Main thread → Worker                                               */
/* ------------------------------------------------------------------ */

export type MainToWorkerMessage =
  | { type: "init" }
  | { type: "start" }
  | { type: "stop" }
  | { type: "rescan"; force: boolean }
  | { type: "scan-projects" }
  | { type: "update-settings"; settings: Partial<Settings> }
  | { type: "reset" }
  | { type: "ping" };

/* ------------------------------------------------------------------ */
/*  Worker → Main thread                                               */
/* ------------------------------------------------------------------ */

export interface WorkerLogEntry {
  timestamp: number;
  session: string;
  level: LogLevel;
  category: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface QueueSnapshot {
  pending: number;
  active: number;
  done: number;
  dead: number;
}

export interface WorkerStatePayload {
  state: ExportState;
  tasks: Task[];
  queues: {
    chat: QueueSnapshot;
    attachment: QueueSnapshot;
    knowledge: QueueSnapshot;
  };
  scanning: boolean;
}

export type WorkerToMainMessage =
  | ({ type: "state" } & WorkerStatePayload)
  | { type: "ready"; version: string; sessionId: string }
  | { type: "status"; message: string }
  | { type: "log"; entry: WorkerLogEntry }
  | { type: "error"; message: string }
  | { type: "pong"; version: string }
  | { type: "reset-done" };
