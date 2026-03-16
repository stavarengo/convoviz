import type { LogLevel, LogEntry } from "./log-store";
import { createLogStore, type LogStore } from "./log-store";

export type { LogLevel, LogEntry };

type LogEntryInput = Omit<LogEntry, "id">;

const RETENTION_HIGH_MARK = 100_000;
const RETENTION_LOW_MARK = 80_000;

function generateSessionId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const sessionId: string = generateSessionId();
const sessionLogs: LogEntryInput[] = [];
let store: LogStore = createLogStore();

export async function initLogger(): Promise<void> {
  store = createLogStore();
  await store.init();
  await store.runRetention(RETENTION_HIGH_MARK, RETENTION_LOW_MARK);
}

export function log(
  level: LogLevel,
  category: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  const entry: LogEntryInput = {
    timestamp: Date.now(),
    session: sessionId,
    level,
    category,
    message,
    ...(context !== undefined ? { context } : {}),
  };

  sessionLogs.push(entry);

  // Fire-and-forget IDB write — failures are silently ignored
  store.put(entry).catch(() => {});
}

export function getSessionId(): string {
  return sessionId;
}

export function getSessionLogs(): LogEntryInput[] {
  return sessionLogs;
}

export async function getLogCount(): Promise<number> {
  return store.count();
}

export async function getAllLogs(): Promise<LogEntry[]> {
  return store.getAll();
}

export async function clearLogs(): Promise<void> {
  return store.clear();
}

export function formatLogLine(entry: Pick<LogEntryInput, "timestamp" | "level" | "category" | "message">): string {
  const d = new Date(entry.timestamp);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return "[" + hh + ":" + mm + ":" + ss + "] [" + entry.level.toUpperCase() + "/" + entry.category + "] " + entry.message;
}

export function serializeLogsJsonl(entries: LogEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n");
}
