import type { ExportState, PendingItem } from "../types";
import type { LogLevel } from "../state/logger";


interface ScanNet {
  getToken(signal?: AbortSignal): Promise<string>;
  fetchJson(url: string, opts?: { signal?: AbortSignal; auth?: boolean }): Promise<unknown>;
}

export const scanConversations = async (
  net: ScanNet,
  S: ExportState,
  signal: AbortSignal,
  onPage: ((items: PendingItem[]) => void) | null,
  knownIds: Set<string> | null,
  log: (level: LogLevel, category: string, message: string, context?: Record<string, unknown>) => void,
  setStatus: (msg: string) => void,
): Promise<PendingItem[]> => {
  await net.getToken(signal);
  const pageSize = 100;
  let offset = 0;
  const items: PendingItem[] = [];
  let consecutiveKnownPages = 0;
  while (true) {
    setStatus("Scanning conversations\u2026 offset " + offset);
    const data = (await net.fetchJson(
      "/backend-api/conversations?offset=" +
        offset +
        "&limit=" +
        pageSize +
        "&order=updated",
      { signal, auth: true },
    )) as { items?: { id: string; title?: string; update_time?: number; updated_time?: number; gizmo_id?: string; project_id?: string }[]; total?: number };
    const got = (data && data.items) || [];
    if (!got.length) break;
    const pageItems: PendingItem[] = [];
    let pageNewCount = 0;
    for (const it of got) {
      const item: PendingItem = {
        id: it.id,
        title: it.title || "",
        update_time: it.update_time || it.updated_time || 0,
        gizmo_id: it.gizmo_id || it.project_id || null,
      };
      items.push(item);
      pageItems.push(item);
      if (knownIds && !knownIds.has(it.id)) pageNewCount++;
    }
    if (onPage) onPage(pageItems);
    offset += got.length;
    if (knownIds && pageNewCount === 0) {
      consecutiveKnownPages++;
      if (consecutiveKnownPages >= 2) {
        setStatus(
          "Scan: hit " +
            consecutiveKnownPages +
            " pages of known chats, stopping early.",
        );
        log(
          "info",
          "scan",
          "Scan early-exit at offset " + offset,
          { offset, consecutiveKnownPages },
        );
        break;
      }
    } else {
      consecutiveKnownPages = 0;
    }
    if (got.length < pageSize) break;
    if (data.total && offset >= data.total) break;
  }
  return items;
};
