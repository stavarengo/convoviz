import type { PendingItem, FileRef } from "../types";
import type { Queue } from "./queue";
import type { AttachmentItem } from "./attachment-worker";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ChatWorkerDeps {
  net: { fetchJson(url: string, opts?: { signal?: AbortSignal; auth?: boolean }): Promise<unknown> };
  exportBlobStore: { putConv(id: string, json: string): Promise<void> };
  attachmentQueue: Queue<AttachmentItem>;
  progress: { exported: Record<string, number> };
  extractFileRefs: (chatJson: any) => FileRef[];
}

export const createChatWorker = (
  deps: ChatWorkerDeps,
): ((item: PendingItem, signal: AbortSignal) => Promise<void>) => {
  const { net, exportBlobStore, attachmentQueue, progress, extractFileRefs } = deps;

  return async (item: PendingItem, signal: AbortSignal): Promise<void> => {
    const json = await net.fetchJson("/backend-api/conversation/" + item.id, {
      signal,
      auth: true,
    });

    const refs = extractFileRefs(json);

    if (refs.length > 0) {
      const attachmentItems: AttachmentItem[] = refs.map((ref: FileRef) => ({
        id: ref.id,
        name: ref.name,
        conversationId: item.id,
        conversationTitle: item.title,
      }));
      attachmentQueue.enqueue(attachmentItems);
    }

    await exportBlobStore.putConv(item.id, JSON.stringify(json));

    progress.exported[item.id] = item.update_time;
  };
};
