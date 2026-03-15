import type { QueueItem } from "./queue";
import { sanitizeName } from "../utils/sanitize";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface KnowledgeFileItem extends QueueItem {
  id: string;
  projectId: string;
  projectName: string;
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export class FileNotFoundError extends Error {
  readonly immediateDeadLetter = true;
  constructor(fileId: string, projectName: string) {
    super(
      "file_not_found: " + fileId + " in project " + projectName,
    );
    this.name = "FileNotFoundError";
  }
}

export interface KnowledgeWorkerDeps {
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
  };
  projects: Array<{ gizmoId: string; name: string; raw: unknown }>;
}

export const createKnowledgeWorker = (
  deps: KnowledgeWorkerDeps,
): ((item: KnowledgeFileItem, signal: AbortSignal) => Promise<void>) => {
  const { net, exportBlobStore, projects } = deps;

  return async (
    item: KnowledgeFileItem,
    signal: AbortSignal,
  ): Promise<void> => {
    // Fetch file metadata
    const meta = (await net.fetchJson(
      "/backend-api/files/download/" +
        encodeURIComponent(item.fileId) +
        "?gizmo_id=" +
        encodeURIComponent(item.projectId) +
        "&inline=false",
      { signal, auth: true },
    )) as any;

    // file_not_found -> immediate dead-letter
    if (
      meta &&
      meta.status === "error" &&
      meta.error_code === "file_not_found"
    ) {
      throw new FileNotFoundError(item.fileId, item.projectName);
    }

    // Must have a download_url
    if (!meta || !meta.download_url) {
      throw new Error(
        "No download_url for knowledge file " +
          item.fileId +
          " in project " +
          item.projectName,
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

    // Store blob at kf/{sanitizedProjectName}/{sanitizedFileName}
    const safeProjName = sanitizeName(item.projectName);
    const safeFname = sanitizeName(item.fileName);
    await exportBlobStore.putFile(
      "kf/" + safeProjName + "/" + safeFname,
      blob,
    );

    // Store project.json (idempotent write — same data each time)
    const proj = projects.find((p) => p.gizmoId === item.projectId);
    if (proj && proj.raw) {
      await exportBlobStore.putFile(
        "kf/" + safeProjName + "/project.json",
        new Blob(
          [JSON.stringify(proj.raw, null, 2)],
          { type: "application/json" },
        ),
      );
    }
  };
};
