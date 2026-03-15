import type { QueueItem } from "./queue";
import type { FileMeta } from "../state/export-blobs";
import { sanitizeName } from "../utils/sanitize";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AttachmentItem extends QueueItem {
  id: string;
  name: string | null;
  conversationId: string;
  conversationTitle: string;
}

export interface AttachmentWorkerDeps {
  net: {
    fetchJson(
      url: string,
      opts?: { signal?: AbortSignal; auth?: boolean },
    ): Promise<unknown>;
    fetchBlob(
      url: string,
      opts?: { signal?: AbortSignal; auth?: boolean; credentials?: string },
    ): Promise<Blob>;
  };
  exportBlobStore: {
    putFile(path: string, blob: Blob): Promise<void>;
    putFileMeta(meta: FileMeta): Promise<void>;
    hasFilePrefix(prefix: string): Promise<boolean>;
  };
}

export const createAttachmentWorker = (
  deps: AttachmentWorkerDeps,
): ((item: AttachmentItem, signal: AbortSignal) => Promise<void>) => {
  const { net, exportBlobStore } = deps;

  return async (item: AttachmentItem, signal: AbortSignal): Promise<void> => {
    // Dedup: skip if file already exists in blob store
    const exists = await exportBlobStore.hasFilePrefix(item.id);
    if (exists) return;

    // Fetch file metadata
    const meta = (await net.fetchJson(
      "/backend-api/files/download/" + item.id,
      { signal, auth: true },
    )) as any;

    if (!meta || !meta.download_url) {
      throw new Error(
        "No download_url for file " + item.id +
        " in conversation " + item.conversationTitle,
      );
    }

    // Determine credentials based on URL origin
    const isSameOrigin =
      meta.download_url.startsWith("/") ||
      (typeof location !== "undefined" &&
        meta.download_url.startsWith(location.origin));

    const blob = await net.fetchBlob(meta.download_url, {
      signal,
      auth: false,
      credentials: isSameOrigin ? "same-origin" : "omit",
    });

    // Compute filename: {id}_{sanitizedName} or {id}.{ext}
    const ext =
      blob.type && blob.type.indexOf("/") > -1
        ? blob.type.split("/")[1]
        : "bin";
    const fname = item.name
      ? item.id + "_" + sanitizeName(item.name)
      : item.id + "." + sanitizeName(ext);

    await exportBlobStore.putFile(fname, blob);
    await exportBlobStore.putFileMeta({
      key: fname,
      type: "attachment",
      conversationId: item.conversationId,
    });
  };
};
