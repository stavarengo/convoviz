import type { LogLevel } from "./logger";

type LogFn = (
  level: LogLevel,
  category: string,
  message: string,
  context?: Record<string, unknown>,
) => void;

export function registerGlobalErrorHandlers(log: LogFn): void {
  window.addEventListener("error", (e: ErrorEvent) => {
    log("error", "sys", "Uncaught error: " + e.message, {
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    log("error", "sys", "Unhandled promise rejection", {
      reason: String(e.reason),
    });
  });
}
