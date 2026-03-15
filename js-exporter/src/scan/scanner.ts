import type { EventBus } from "../events/bus";
import type { DiscoveryStore } from "../state/discovery-store";

interface ScannerNet {
  getToken(signal?: AbortSignal): Promise<string>;
  fetchJson(
    url: string,
    opts?: { signal?: AbortSignal; auth?: boolean },
  ): Promise<unknown>;
}

export interface ConversationScannerDeps {
  net: ScannerNet;
  discoveryStore: DiscoveryStore;
  eventBus: EventBus;
  scannerId: string;
  gizmoId: string | null;
  limit?: number;
}

export interface ConversationScanner {
  start(signal: AbortSignal): Promise<void>;
}

interface ApiConversation {
  id: string;
  title?: string;
  update_time?: number;
  updated_time?: number;
  gizmo_id?: string;
  project_id?: string;
}

interface ApiPage {
  items?: ApiConversation[];
  total?: number;
}

export function createConversationScanner(
  deps: ConversationScannerDeps,
): ConversationScanner {
  const { net, discoveryStore, eventBus, scannerId, gizmoId } = deps;
  const limit = deps.limit ?? 100;

  return {
    async start(signal: AbortSignal): Promise<void> {
      let offset = 0;
      let itemCount = 0;

      // Resume from saved state if available
      const saved = await discoveryStore.getScannerState(scannerId);
      if (saved && saved.status === "interrupted") {
        offset = saved.offset;
      }

      while (true) {
        if (signal.aborted) break;

        let url =
          `/backend-api/conversations?offset=${offset}&limit=${limit}`;
        if (gizmoId) {
          url += `&gizmo_id=${gizmoId}`;
        }

        let data: ApiPage;
        try {
          data = (await net.fetchJson(url, {
            signal,
            auth: true,
          })) as ApiPage;
        } catch (err) {
          if (
            err instanceof DOMException &&
            err.name === "AbortError"
          ) {
            break;
          }
          throw err;
        }

        const got = data.items ?? [];
        if (got.length === 0) break;

        const total = data.total ?? 0;

        for (const raw of got) {
          const updateTime = raw.update_time ?? raw.updated_time ?? 0;
          const title = raw.title ?? "";
          const convGizmoId = raw.gizmo_id ?? raw.project_id ?? null;

          const existing = await discoveryStore.getConversation(raw.id);

          if (!existing) {
            await discoveryStore.putConversation({
              id: raw.id,
              title,
              updateTime,
              gizmoId: convGizmoId,
              status: "new",
              exportedAt: null,
            });
            eventBus.emit("conversation-needs-export", { id: raw.id });
            itemCount++;
          } else if (existing.updateTime !== updateTime) {
            await discoveryStore.putConversation({
              ...existing,
              title,
              updateTime,
              gizmoId: convGizmoId,
              status: "needs-update",
            });
            eventBus.emit("conversation-needs-update", { id: raw.id });
            itemCount++;
          } else {
            eventBus.emit("conversation-up-to-date", { id: raw.id });
          }
        }

        offset += got.length;

        // Persist scanner state after each page
        await discoveryStore.putScannerState({
          scannerId,
          offset,
          limit,
          total,
          lastRunAt: Date.now(),
          status: "active",
        });

        eventBus.emit("scanner-progress", {
          scannerId,
          offset,
          total,
        });

        // Stop if we got fewer items than the limit (last page)
        if (got.length < limit) break;
        // Stop if we've reached the total
        if (total > 0 && offset >= total) break;
      }

      if (signal.aborted) {
        // Mark state as interrupted for resumption
        const currentState = await discoveryStore.getScannerState(scannerId);
        if (currentState) {
          await discoveryStore.putScannerState({
            ...currentState,
            status: "interrupted",
          });
        } else {
          // If no state was saved yet (abort before first page completed),
          // save current offset
          await discoveryStore.putScannerState({
            scannerId,
            offset,
            limit,
            total: null,
            lastRunAt: Date.now(),
            status: "interrupted",
          });
        }
      } else {
        // Completed successfully: delete scanner state
        await discoveryStore.deleteScannerState(scannerId);
        eventBus.emit("scanner-complete", { scannerId, itemCount });
      }
    },
  };
}
