import type { ExportState } from "../types";
import type { LogLevel } from "./logger";

export interface ReconcileDeps {
  S: ExportState;
  getAllConvKeys: () => Promise<string[]>;
  saveDebounce: (immediate: boolean) => void;
  log: (level: LogLevel, category: string, message: string, context?: Record<string, unknown>) => void;
}

export const reconcileExportState = async (
  deps: ReconcileDeps,
): Promise<void> => {
  const { S, getAllConvKeys, saveDebounce, log } = deps;
  const idbKeys = await getAllConvKeys();
  if (!idbKeys.length) return;

  const exported = S.progress.exported || {};
  const pendingById: Record<string, number> = {};
  for (const p of S.progress.pending || []) {
    pendingById[p.id] = p.update_time || 0;
  }

  const reconciledIds = new Set<string>();
  for (const key of idbKeys) {
    if (key in exported) continue;
    exported[key] = pendingById[key] ?? 0;
    reconciledIds.add(key);
  }

  if (!reconciledIds.size) return;

  S.progress.exported = exported;
  S.progress.pending = (S.progress.pending || []).filter(
    (p) => !reconciledIds.has(p.id),
  );

  saveDebounce(true);
  log(
    "info",
    "state",
    "Reconciled " + reconciledIds.size + " conversation(s) from previous session",
    { count: reconciledIds.size },
  );
};
