import type { ExportState, PendingItem, FileRef } from "./types";
import type { FileMeta } from "./state/export-blobs";
import type { LogLevel } from "./state/logger";
import type { AttachmentItem } from "./export/attachment-worker";
import type { KnowledgeFileItem } from "./export/knowledge-worker";
import type { TaskList } from "./ui/task-list";
import type { DiscoveryStore } from "./state/discovery-store";
import type { Queue } from "./export/queue";
import { createEventBus } from "./events/bus";
import type { EventBus } from "./events/bus";
import { createQueue } from "./export/queue";
import { createChatWorker } from "./export/chat-worker";
import { createAttachmentWorker } from "./export/attachment-worker";
import { createKnowledgeWorker } from "./export/knowledge-worker";
import { createConversationScanner } from "./scan/scanner";
import type { ConversationScanner } from "./scan/scanner";
import { createProjectScanner, discoverKnowledgeFiles } from "./scan/project-scanner";
import type { ProjectScanner } from "./scan/project-scanner";
import { clamp } from "./utils/format";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BootstrapDeps {
  S: ExportState;
  net: {
    getToken(signal?: AbortSignal): Promise<string>;
    fetchJson(
      url: string,
      opts?: { signal?: AbortSignal; auth?: boolean },
    ): Promise<unknown>;
    fetchBlob(
      url: string,
      opts?: { signal?: AbortSignal; auth?: boolean; credentials?: string },
    ): Promise<Blob>;
  };
  discoveryStore: DiscoveryStore;
  exportBlobStore: {
    putConv(id: string, json: string): Promise<void>;
    putFile(path: string, blob: Blob): Promise<void>;
    putFileMeta(meta: FileMeta): Promise<void>;
    hasFilePrefix(prefix: string): Promise<boolean>;
    totalSize(): Promise<number>;
  };
  taskList: TaskList;
  log: (level: LogLevel, category: string, message: string, context?: Record<string, unknown>) => void;
  saveDebounce: (immediate: boolean) => void;
  extractFileRefs: (chatJson: any) => FileRef[];
}

export interface BootstrapResult {
  eventBus: EventBus;
  chatQueue: Queue<PendingItem>;
  attachmentQueue: Queue<AttachmentItem>;
  knowledgeQueue: Queue<KnowledgeFileItem>;
  conversationScanner: ConversationScanner;
  projectScanner: ProjectScanner;
  /** Set the abort signal for project-spawned scanners. Must be called before scanning starts. */
  setScanAbortSignal(signal: AbortSignal): void;
  /** Returns promises for all project-spawned scanners (for awaiting completion). */
  getSpawnedScannerPromises(): Promise<void>[];
}

export function bootstrap(deps: BootstrapDeps): BootstrapResult {
  const {
    S,
    net,
    discoveryStore,
    exportBlobStore,
    taskList,
    log,
    saveDebounce,
    extractFileRefs,
  } = deps;

  const eventBus = createEventBus((event, err) => {
    log("error", "sys", `EventBus: listener for "${String(event)}" threw`, {
      error: String((err as any)?.message || err),
    });
  });

  // Keep S.scan.total in sync with the general scanner's API total
  eventBus.on("scanner-progress", (payload) => {
    if (payload.scannerId === "general") {
      S.scan.total = payload.total;
    }
  });

  const pause = clamp(
    parseInt(String(S.settings.pause), 10) || 300,
    0,
    5000,
  );

  // Create attachment queue
  const attachmentQueue = createQueue<AttachmentItem>(
    {
      name: "attachment",
      concurrency: clamp(
        parseInt(String(S.settings.fileConcurrency), 10) || 3,
        1,
        8,
      ),
      maxRetries: 3,
      pauseMs: pause,
      worker: createAttachmentWorker({ net, exportBlobStore }),
    },
    {
      onItemDone: (item) => {
        S.progress.fileDoneCount = (S.progress.fileDoneCount || 0) + 1;
        S.stats.filesDownloaded = (S.stats.filesDownloaded || 0) + 1;
        taskList.update("file-" + item.id, { status: "done", detail: null });
        saveDebounce(false);
      },
      onItemFailed: (item, error, attempt) => {
        S.progress.fileFailCounts[item.id] = attempt;
        taskList.update("file-" + item.id, { status: "failed", error });
        log("warn", "file", "File download failed, retrying", {
          fileId: item.id,
          fileName: item.name,
          attempt,
          error,
        });
        saveDebounce(false);
      },
      onItemDead: (item, error) => {
        S.progress.fileDead = (S.progress.fileDead || [])
          .concat([{ ...item, lastError: error }])
          .slice(-500);
        log("error", "file", "File dead-lettered", {
          fileId: item.id,
          fileName: item.name,
          error,
        });
        saveDebounce(false);
      },
      onStatsChanged: () => {
        saveDebounce(false);
      },
    },
  );

  // Create chat queue
  const chatQueue = createQueue<PendingItem>(
    {
      name: "chat",
      concurrency: clamp(
        parseInt(String(S.settings.chatConcurrency), 10) || 3,
        1,
        8,
      ),
      maxRetries: 3,
      pauseMs: pause,
      worker: createChatWorker({
        net,
        exportBlobStore,
        eventBus,
        progress: S.progress,
        extractFileRefs,
        discoveryStore,
      }),
    },
    {
      onItemDone: (item) => {
        S.progress.pending = S.progress.pending.filter(
          (p) => p.id !== item.id,
        );
        S.stats.chatsExported = (S.stats.chatsExported || 0) + 1;
        const projName = item.gizmo_id
          ? ((S.projects || []).find(
              (p) => p.gizmoId === item.gizmo_id,
            ) || ({} as any)).name
          : null;
        taskList.update("conv-" + item.id, { status: "done", detail: null });
        log("info", "chat", "Conversation exported", {
          conversationId: item.id,
          title: item.title || item.id,
          projectName: projName,
        });
        saveDebounce(false);
      },
      onItemFailed: (item, error, attempt) => {
        S.progress.failCounts[item.id] = attempt;
        taskList.update("conv-" + item.id, { status: "failed", error });
        log("warn", "chat", "Export failed, retrying", {
          conversationId: item.id,
          title: item.title || item.id,
          attempt,
          error,
        });
        saveDebounce(false);
      },
      onItemDead: (item, error) => {
        S.progress.pending = S.progress.pending.filter(
          (p) => p.id !== item.id,
        );
        S.progress.dead = (S.progress.dead || [])
          .concat([{ ...item, lastError: error }])
          .slice(-500);
        log("error", "chat", "Dead-lettered", {
          conversationId: item.id,
          title: item.title || item.id,
          error,
        });
        saveDebounce(false);
      },
      onStatsChanged: () => {
        saveDebounce(false);
      },
    },
  );

  // Create knowledge file queue
  const knowledgeQueue = createQueue<KnowledgeFileItem>(
    {
      name: "knowledge",
      concurrency: clamp(
        parseInt(String(S.settings.knowledgeFileConcurrency), 10) || 3,
        1,
        8,
      ),
      maxRetries: 3,
      pauseMs: pause,
      worker: createKnowledgeWorker({
        net,
        exportBlobStore,
        projects: S.projects || [],
      }),
    },
    {
      onItemDone: (item) => {
        S.progress.knowledgeFilesPending =
          S.progress.knowledgeFilesPending.filter(
            (p) => p.fileId !== item.fileId,
          );
        S.progress.knowledgeFilesExported = (
          S.progress.knowledgeFilesExported || []
        ).concat([item]);
        S.stats.knowledgeFilesDownloaded =
          (S.stats.knowledgeFilesDownloaded || 0) + 1;
        taskList.update("kf-" + item.fileId, { status: "done", detail: null });
        log("info", "kf", "Knowledge file exported", {
          projectName: item.projectName,
          fileName: item.fileName,
          fileId: item.fileId,
        });
        saveDebounce(false);
      },
      onItemFailed: (item, error, attempt) => {
        S.progress.knowledgeFilesFailCounts[item.fileId] = attempt;
        taskList.update("kf-" + item.fileId, { status: "failed", error });
        log("warn", "kf", "Knowledge file failed, retrying", {
          projectName: item.projectName,
          fileName: item.fileName,
          fileId: item.fileId,
          attempt,
          error,
        });
        saveDebounce(false);
      },
      onItemDead: (item, error) => {
        S.progress.knowledgeFilesPending =
          S.progress.knowledgeFilesPending.filter(
            (p) => p.fileId !== item.fileId,
          );
        S.progress.knowledgeFilesDead = (
          S.progress.knowledgeFilesDead || []
        )
          .concat([{ ...item, lastError: error }])
          .slice(-500);
        log("error", "kf", "Knowledge file dead-lettered", {
          projectName: item.projectName,
          fileName: item.fileName,
          fileId: item.fileId,
          error,
        });
        saveDebounce(false);
      },
      onStatsChanged: () => {
        saveDebounce(false);
      },
    },
  );

  // Register event listeners

  const enqueueConversation = (payload: { id: string }): void => {
    discoveryStore.getConversation(payload.id).then((record) => {
      if (!record) return;
      const item: PendingItem = {
        id: record.id,
        title: record.title,
        update_time: record.updateTime,
        gizmo_id: record.gizmoId,
      };
      const projName = record.gizmoId
        ? ((S.projects || []).find(
            (p) => p.gizmoId === record.gizmoId,
          ) || ({} as any)).name || null
        : null;
      taskList.add({
        id: "conv-" + record.id,
        type: "conversation",
        label: record.title || record.id,
        projectName: projName,
        status: "queued",
        detail: null,
      });
      chatQueue.enqueue([item]);
    });
  };

  // conversation-needs-export -> look up discovery store -> enqueue into chat queue
  eventBus.on("conversation-needs-export", enqueueConversation);

  // conversation-needs-update -> same as above
  eventBus.on("conversation-needs-update", enqueueConversation);

  // conversation-exported -> update discovery store record to status 'exported'
  eventBus.on("conversation-exported", (payload) => {
    discoveryStore.getConversation(payload.id).then((record) => {
      if (!record) return;
      discoveryStore.putConversation({
        ...record,
        status: "exported",
        exportedAt: Date.now(),
      });
    });
  });

  // conversation-files-discovered -> convert to AttachmentItem[] -> enqueue into attachment queue
  eventBus.on("conversation-files-discovered", (payload) => {
    const items: AttachmentItem[] = payload.files.map((f) => ({
      id: f.id,
      name: f.name,
      conversationId: payload.conversationId,
      conversationTitle: payload.conversationTitle,
    }));
    for (const item of items) {
      taskList.add({
        id: "file-" + item.id,
        type: "file",
        label: item.name || item.id,
        projectName: null,
        status: "queued",
        detail: "[" + item.conversationTitle + "]",
      });
    }
    attachmentQueue.enqueue(items);
  });

  // Track spawned project scanners for abort and completion tracking
  let _scanAbortSignal: AbortSignal | null = null;
  const _spawnedScannerPromises: Promise<void>[] = [];

  // project-discovered -> spawn ConversationScanner(gizmoId) + KF discovery
  eventBus.on("project-discovered", (payload) => {
    // Spawn a conversation scanner for this project
    const projectConvScanner = createConversationScanner({
      net,
      discoveryStore,
      eventBus,
      scannerId: "project-conv-" + payload.gizmoId,
      gizmoId: payload.gizmoId,
    });
    // Use the shared scan abort signal, or create a standalone one
    const signal = _scanAbortSignal ?? new AbortController().signal;
    const promise = projectConvScanner.start(signal).catch((e: any) => {
      if (e && e.name !== "AbortError") log("error", "scan", "Project conversation scanner error", { error: String(e && e.message || e), gizmoId: payload.gizmoId });
    });
    _spawnedScannerPromises.push(promise);

    // Run knowledge file discovery
    const deadFileIds = new Set(
      (S.progress.knowledgeFilesDead || []).map((x) => x.fileId),
    );
    discoverKnowledgeFiles({
      project: payload,
      eventBus,
      exportBlobStore,
      deadFileIds,
    });
  });

  // knowledge-file-discovered -> convert to KnowledgeFileItem -> enqueue into knowledge queue
  eventBus.on("knowledge-file-discovered", (payload) => {
    const item: KnowledgeFileItem = {
      id: payload.fileId,
      projectId: payload.projectId,
      projectName: payload.projectName,
      fileId: payload.fileId,
      fileName: payload.fileName,
      fileType: payload.fileType,
      fileSize: payload.fileSize,
    };
    taskList.add({
      id: "kf-" + payload.fileId,
      type: "knowledge",
      label: payload.fileName,
      projectName: payload.projectName,
      status: "queued",
      detail: null,
    });
    knowledgeQueue.enqueue([item]);
  });

  // Create scanners
  const conversationScanner = createConversationScanner({
    net,
    discoveryStore,
    eventBus,
    scannerId: "general",
    gizmoId: null,
  });

  const projectScanner = createProjectScanner({
    net,
    discoveryStore,
    eventBus,
  });

  return {
    eventBus,
    chatQueue,
    attachmentQueue,
    knowledgeQueue,
    conversationScanner,
    projectScanner,
    setScanAbortSignal(signal: AbortSignal): void {
      _scanAbortSignal = signal;
    },
    getSpawnedScannerPromises(): Promise<void>[] {
      return _spawnedScannerPromises;
    },
  };
}
