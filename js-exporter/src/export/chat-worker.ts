import type { PendingItem, FileRef } from "../types";
import type { EventBus } from "../events/bus";
import type { ConversationRecord } from "../state/discovery-store";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ChatWorkerDeps {
  net: { fetchJson(url: string, opts?: { signal?: AbortSignal; auth?: boolean }): Promise<unknown> };
  exportBlobStore: { putConv(id: string, json: string): Promise<void> };
  eventBus: EventBus;
  progress: { exported: Record<string, number> };
  extractFileRefs: (chatJson: any) => FileRef[];
  discoveryStore: { getConversation(id: string): Promise<ConversationRecord | null> };
}

export const createChatWorker = (
  deps: ChatWorkerDeps,
): ((item: PendingItem, signal: AbortSignal) => Promise<void>) => {
  const { net, exportBlobStore, eventBus, progress, extractFileRefs, discoveryStore } = deps;

  return async (item: PendingItem, signal: AbortSignal): Promise<void> => {
    // Worker-level dedup: skip if already exported with same updateTime
    const record = await discoveryStore.getConversation(item.id);
    if (record && record.status === "exported" && record.updateTime === item.update_time) {
      return;
    }

    const json = await net.fetchJson("/backend-api/conversation/" + item.id, {
      signal,
      auth: true,
    });

    const refs = extractFileRefs(json);

    await exportBlobStore.putConv(item.id, JSON.stringify(json));

    progress.exported[item.id] = item.update_time;

    if (refs.length > 0) {
      eventBus.emit("conversation-files-discovered", {
        conversationId: item.id,
        conversationTitle: item.title,
        files: refs.map((ref: FileRef) => ({
          id: ref.id,
          name: ref.name,
        })),
      });
    }

    eventBus.emit("conversation-exported", { id: item.id });
  };
};
