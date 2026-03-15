import type {
  ExportState,
  PendingItem,
  KfPendingItem,
  KfDeadItem,
  DeadItem,
  ProjectInfo,
  FileRef,
  Changes,
} from "../types";
import type { Net } from "../net/net";
import type { UI } from "../ui/panel";
import type { TaskList } from "../ui/task-list";
import type { AttachmentItem } from "./attachment-worker";
import { createQueue } from "./queue";
import type { Queue } from "./queue";
import { createChatWorker } from "./chat-worker";
import { createAttachmentWorker } from "./attachment-worker";
import { createKnowledgeWorker } from "./knowledge-worker";
import { now, clamp, fmtMs } from "../utils/format";
import { sleep } from "../net/sleep";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ScanNet {
  getToken(signal?: AbortSignal): Promise<string>;
  fetchJson(
    url: string,
    opts?: { signal?: AbortSignal; auth?: boolean },
  ): Promise<unknown>;
}

export interface ExportBlobStoreApi {
  putConv(id: string, json: string): Promise<void>;
  putFile(path: string, blob: Blob): Promise<void>;
  hasFilePrefix(prefix: string): Promise<boolean>;
  totalSize(): Promise<number>;
}

export interface ExporterDeps {
  S: ExportState;
  net: Net;
  ui: UI & { ensureTick?: () => void };
  taskList: TaskList;
  exportBlobStore: ExportBlobStoreApi;
  addLog: (msg: string) => void;
  saveDebounce: (immediate: boolean) => void;
  scanConversations: (
    net: ScanNet,
    S: ExportState,
    signal: AbortSignal,
    onPage: ((items: PendingItem[]) => void) | null,
    knownIds: Set<string> | null,
    addLog: (msg: string) => void,
    setStatus: (msg: string) => void,
  ) => Promise<PendingItem[]>;
  scanProjects: (
    net: ScanNet,
    signal: AbortSignal,
    onProject: ((proj: ProjectInfo) => void) | null,
    setStatus: (msg: string) => void,
  ) => Promise<ProjectInfo[]>;
  scanProjectConversations: (
    net: ScanNet,
    gizmoId: string,
    signal: AbortSignal,
    onPage: ((items: PendingItem[]) => void) | null,
    knownIds: Set<string> | null,
  ) => Promise<PendingItem[]>;
  extractFileRefs: (chatJson: any) => FileRef[];
  computeChanges: (
    prevSnap: [string, number][] | null | undefined,
    items: { id: string; update_time: number }[],
    freshPending: PendingItem[],
    oldPending: PendingItem[],
  ) => Changes;
  assertOnChatGPT: () => void;
  onExportComplete?: () => Promise<void>;
}

export interface Exporter {
  abort: AbortController | null;
  _scanAbort: AbortController | null;
  stopRequested: boolean;
  scanPromise: Promise<unknown> | null;
  chatQueue: Queue<PendingItem> | null;
  attachmentQueue: Queue<AttachmentItem> | null;
  knowledgeQueue: Queue<any> | null;
  rescan(force: boolean): Promise<void>;
  start(): Promise<void>;
  stop(): void;
}

export const createExporter = (deps: ExporterDeps): Exporter => {
  const {
    S,
    net,
    ui,
    taskList,
    exportBlobStore,
    addLog,
    saveDebounce,
    scanConversations,
    scanProjects,
    scanProjectConversations,
    extractFileRefs,
    computeChanges,
    assertOnChatGPT,
  } = deps;

  const exporter: Exporter = {
    abort: null,
    _scanAbort: null,
    stopRequested: false,
    scanPromise: null,
    chatQueue: null,
    attachmentQueue: null,
    knowledgeQueue: null,

    async rescan(force: boolean): Promise<void> {
      if (S.run.isRunning && !force) {
        addLog("Can't rescan while running. Stop first.");
        return;
      }
      if (exporter.scanPromise) return exporter.scanPromise as Promise<void>;
      const ac = new AbortController();
      exporter._scanAbort = ac;
      if (ui && ui.ensureTick) ui.ensureTick();
      exporter.scanPromise = (async () => {
        try {
          assertOnChatGPT();
          taskList.add({
            id: "scan",
            type: "scan",
            label: "Scanning conversations and projects\u2026",
            status: "active",
          });
          S.scan.total = 0;
          S.scan.totalProjects = 0;
          S.changes = {
            at: 0,
            newChats: 0,
            removedChats: 0,
            updatedChats: 0,
            newPending: 0,
            pendingDelta: 0,
          };
          saveDebounce(true);
          ui.renderAll();
          addLog("Rescan started\u2026");

          const prevSnapshot = Array.isArray(S.scan.snapshot)
            ? S.scan.snapshot
            : [];
          const knownIds = new Set(prevSnapshot.map((x) => x[0]));
          if (knownIds.size)
            addLog(
              "Incremental scan: " +
                knownIds.size +
                " known conversations from previous scan.",
            );

          const exportedMap = S.progress.exported || {};
          const deadSet = new Set(
            (S.progress.dead || []).map((x) => x.id),
          );
          const pendingSet = new Set(
            (S.progress.pending || []).map((x) => x.id),
          );
          const pendingById: Record<string, PendingItem> = {};
          for (
            let pi2 = 0;
            pi2 < S.progress.pending.length;
            pi2++
          ) {
            pendingById[S.progress.pending[pi2].id] =
              S.progress.pending[pi2];
          }

          const onPage = (pageItems: PendingItem[]): void => {
            let added = 0;
            for (const it of pageItems) {
              if (deadSet.has(it.id)) continue;
              if (pendingSet.has(it.id)) {
                const existing = pendingById[it.id];
                if (existing) {
                  if (it.gizmo_id) existing.gizmo_id = it.gizmo_id;
                  if (it.update_time)
                    existing.update_time = it.update_time;
                  if (it.title && !existing.title)
                    existing.title = it.title;
                }
                continue;
              }
              const prevTime =
                exportedMap[it.id];
              if (prevTime !== undefined) {
                const curTime = it.update_time || 0;
                if (!curTime || !prevTime || curTime === prevTime)
                  continue;
              }
              S.progress.pending.push(it);
              pendingSet.add(it.id);
              pendingById[it.id] = it;
              added++;
            }
            if (added) {
              saveDebounce(false);
              ui.renderAll();
            }
          };

          const items = await scanConversations(
            net,
            S,
            ac.signal,
            onPage,
            knownIds.size ? knownIds : null,
            addLog,
            (msg: string) => ui.setStatus(msg),
          );
          addLog(
            "Regular scan done. Found " +
              items.length +
              " conversations.",
          );

          let projectConvItems: PendingItem[] = [];
          try {
            ui.setStatus("Scanning projects\u2026");
            const projects = await scanProjects(
              net,
              ac.signal,
              (proj: ProjectInfo) => {
                ui.setStatus(
                  "Scanning projects\u2026 found " + proj.name,
                );
              },
              (msg: string) => ui.setStatus(msg),
            );
            S.projects = projects;
            S.scan.totalProjects = projects.length;
            saveDebounce(false);
            addLog("Found " + projects.length + " projects.");

            for (let pi = 0; pi < projects.length; pi++) {
              const proj = projects[pi];
              if (ac.signal && ac.signal.aborted)
                throw new DOMException("Aborted", "AbortError");
              try {
                ui.setStatus(
                  "Scanning project chats: " +
                    proj.name +
                    " (" +
                    (pi + 1) +
                    "/" +
                    projects.length +
                    ")",
                );
                const projItems =
                  await scanProjectConversations(
                    net,
                    proj.gizmoId,
                    ac.signal,
                    onPage,
                    knownIds.size ? knownIds : null,
                  );
                for (const it of projItems)
                  projectConvItems.push(it);
                addLog(
                  "Project " +
                    proj.name +
                    ": " +
                    projItems.length +
                    " conversations.",
                );
              } catch (pe: any) {
                if (pe && pe.name === "AbortError") throw pe;
                addLog(
                  "\u26A0 Failed to scan project " +
                    proj.name +
                    ": " +
                    ((pe && pe.message) || pe),
                );
                console.warn(
                  "convoviz: project conversation scan failed for " +
                    proj.name,
                  pe,
                );
              }
            }
          } catch (projErr: any) {
            if (projErr && projErr.name === "AbortError")
              throw projErr;
            addLog(
              "\u26A0 Project scan failed, continuing with regular conversations only: " +
                ((projErr && projErr.message) || projErr),
            );
            console.warn(
              "convoviz: project sidebar scan failed",
              projErr,
            );
          }

          const kfExportedSet = new Set(
            (S.progress.knowledgeFilesExported || []).map((x) => x.fileId),
          );
          const kfDeadSet = new Set(
            (S.progress.knowledgeFilesDead || []).map((x) => x.fileId),
          );
          const kfPendingNew: KfPendingItem[] = [];
          const kfPendingIds = new Set<string>();
          for (const proj of S.projects || []) {
            for (const f of proj.files || []) {
              if (
                !kfExportedSet.has(f.fileId) &&
                !kfDeadSet.has(f.fileId) &&
                !kfPendingIds.has(f.fileId)
              ) {
                kfPendingNew.push({
                  projectId: proj.gizmoId,
                  projectName: proj.name,
                  fileId: f.fileId,
                  fileName: f.name,
                  fileType: f.type,
                  fileSize: f.size,
                });
                kfPendingIds.add(f.fileId);
              }
            }
          }
          S.progress.knowledgeFilesPending = kfPendingNew;
          saveDebounce(false);
          if (kfPendingNew.length)
            addLog(
              "Knowledge files: " +
                kfPendingNew.length +
                " pending.",
            );

          const scannedItems = items.concat(projectConvItems);
          const scannedIds = new Set(
            scannedItems.map((x) => x.id),
          );
          const carryOver = prevSnapshot.filter(
            (x) => !scannedIds.has(x[0]),
          );
          const allItems: [string, number][] = scannedItems
            .map((x): [string, number] => [x.id, x.update_time || 0])
            .concat(carryOver);

          const oldPending = [...S.progress.pending];
          S.changes = computeChanges(
            S.scan.snapshot,
            scannedItems,
            S.progress.pending,
            oldPending,
          );
          S.scan = {
            at: now(),
            total: allItems.length,
            totalProjects: S.scan.totalProjects || 0,
            snapshot: allItems,
          };
          saveDebounce(true);
          taskList.update("scan", { status: "done", detail: null });
          ui.setStatus("Rescan done.");
          addLog(
            "Rescan done. Total " +
              allItems.length +
              " (scanned " +
              scannedItems.length +
              ", carried " +
              carryOver.length +
              "), pending " +
              S.progress.pending.length +
              ".",
          );
          ui.renderAll();
        } catch (e: any) {
          if (e && e.name === "AbortError") {
            taskList.update("scan", {
              status: "failed",
              error: "Stopped",
            });
            ui.setStatus("Scan stopped.");
            addLog("Scan stopped.");
          } else {
            S.run.lastError = String((e && e.message) || e);
            saveDebounce(true);
            taskList.update("scan", {
              status: "failed",
              error: String((e && e.message) || e),
            });
            ui.setStatus(
              "Rescan error: " + ((e && e.message) || e),
            );
            addLog(
              "Rescan error: " + ((e && e.message) || e),
            );
            console.error(e);
          }
        } finally {
          exporter._scanAbort = null;
          exporter.scanPromise = null;
          saveDebounce(false);
        }
      })();
      return exporter.scanPromise as Promise<void>;
    },

    async start(): Promise<void> {
      if (S.run.isRunning) {
        addLog("Already running.");
        return;
      }
      try {
        assertOnChatGPT();
        exporter.stopRequested = false;
        const ac = new AbortController();
        exporter.abort = ac;
        if (ui && ui.ensureTick) ui.ensureTick();
        S.run.lastError = "";
        S.run.startedAt = now();
        saveDebounce(true);
        ui.renderAll();
        addLog("Start.");
        ui.setStatus("Preparing\u2026");
        await net.getToken(ac.signal);

        const hasPending =
          Array.isArray(S.progress.pending) &&
          S.progress.pending.length;
        const needsScan =
          !hasPending || !!S.settings.filterGizmoId;
        if (needsScan && !exporter.scanPromise) {
          exporter.rescan(true);
        }
        if (
          S.run.backoffUntil &&
          S.run.backoffUntil > now()
        ) {
          const wait = S.run.backoffUntil - now();
          ui.setStatus(
            "Backoff carryover \u2192 sleeping " + fmtMs(wait),
          );
          addLog(
            "Backoff carryover: sleeping " +
              fmtMs(wait) +
              "\u2026",
          );
          await sleep(wait, ac.signal);
        }

        // Wait for scan to complete if it's running
        if (exporter.scanPromise) {
          ui.setStatus("Waiting for scan to find conversations\u2026");
          await exporter.scanPromise;
        }

        if (exporter.stopRequested || ac.signal.aborted) {
          ui.setStatus("Paused.");
          addLog("Stopped.");
          return;
        }

        S.run.isRunning = true;
        saveDebounce(true);
        ui.renderAll();

        const filterGid = S.settings.filterGizmoId || null;
        if (filterGid) {
          const projName =
            (
              (S.projects || []).find(
                (p) => p.gizmoId === filterGid,
              ) || ({} as any)
            ).name || filterGid;
          addLog("Single-project mode: " + projName);
        }
        ui.setStatus("Running\u2026");

        const pause = clamp(
          parseInt(String(S.settings.pause), 10) || 300,
          0,
          5000,
        );

        // Coordinator: resolves when all work is done
        let resolveCoordinator: (() => void) | null = null;
        const coordinatorPromise = new Promise<void>((resolve) => {
          resolveCoordinator = resolve;
        });

        let chatDrained = false;
        let knowledgeDrained = false;
        let attachmentDrained = false;

        const checkCompletion = (): void => {
          // Attachment queue is drained only if it has truly finished:
          // either it never received items, or all received items have been processed
          const attStats = _attachmentQueue.stats;
          const attIdle = attStats.pending === 0 && attStats.active === 0;

          if (chatDrained && attIdle) {
            // Chat done, no pending files: attachment is truly done
            attachmentDrained = true;
          }

          if (chatDrained && knowledgeDrained && attachmentDrained) {
            // Stop attachment queue if still running (it may be parked waiting)
            if (_attachmentQueue.isRunning) {
              _attachmentQueue.stop();
            }
            if (resolveCoordinator) {
              const r = resolveCoordinator;
              resolveCoordinator = null;
              r();
            }
          } else if (chatDrained && !attachmentDrained) {
            ui.setStatus("Chats done. Files still downloading\u2026");
          }
        };

        // Create attachment queue first (chat worker needs it)
        const _attachmentQueue = createQueue<AttachmentItem>(
          {
            name: "attachment",
            concurrency: clamp(
              parseInt(String(S.settings.fileConcurrency), 10) || 3,
              1,
              8,
            ),
            maxRetries: 3,
            pauseMs: pause,
            worker: createAttachmentWorker({
              net,
              exportBlobStore,
            }),
          },
          {
            onItemDone: (item) => {
              S.progress.fileDoneCount = (S.progress.fileDoneCount || 0) + 1;
              S.stats.filesDownloaded = (S.stats.filesDownloaded || 0) + 1;
              taskList.update("file-" + item.id, { status: "done", detail: null });
              saveDebounce(false);
              ui.renderAll();
            },
            onItemFailed: (item, error, attempt) => {
              S.progress.fileFailCounts[item.id] = attempt;
              taskList.update("file-" + item.id, {
                status: "failed",
                error,
              });
              addLog(
                "\u2717 File " +
                  (item.name || item.id) +
                  " (attempt " + attempt + "): " + error,
              );
              saveDebounce(false);
            },
            onItemDead: (item, error) => {
              S.progress.fileDead = (S.progress.fileDead || [])
                .concat([{ ...item, lastError: error }])
                .slice(-500);
              addLog(
                "\u2717 File dead-lettered: " +
                  (item.name || item.id) +
                  ": " + error,
              );
              saveDebounce(false);
              ui.renderAll();
            },
            onDrained: () => {
              // Attachment queue drained — but only truly done if chat also drained
              checkCompletion();
            },
            onStatsChanged: () => {
              saveDebounce(false);
            },
          },
        );
        exporter.attachmentQueue = _attachmentQueue;

        // Wrap attachment queue enqueue to also add task list entries
        const _attachmentQueueProxy: Queue<AttachmentItem> = {
          get name() { return _attachmentQueue.name; },
          get stats() { return _attachmentQueue.stats; },
          get isRunning() { return _attachmentQueue.isRunning; },
          start: (signal) => _attachmentQueue.start(signal),
          stop: () => _attachmentQueue.stop(),
          setConcurrency: (n) => _attachmentQueue.setConcurrency(n),
          enqueue: (items) => {
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
            _attachmentQueue.enqueue(items);
          },
        };

        // Create chat queue
        const _chatQueue = createQueue<PendingItem>(
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
              attachmentQueue: _attachmentQueueProxy,
              progress: S.progress,
              extractFileRefs,
            }),
          },
          {
            onItemDone: (item) => {
              S.progress.pending = S.progress.pending.filter(
                (p) => p.id !== item.id,
              );
              S.stats.chatsExported = (S.stats.chatsExported || 0) + 1;
              const projName = item.gizmo_id
                ? (
                    (S.projects || []).find(
                      (p) => p.gizmoId === item.gizmo_id,
                    ) || ({} as any)
                  ).name
                : null;
              const title = projName
                ? "[" + projName + "] " + (item.title || item.id)
                : item.title || item.id;
              taskList.update("conv-" + item.id, { status: "done", detail: null });
              addLog("\u2713 " + title);
              saveDebounce(false);
              ui.renderAll();
            },
            onItemFailed: (item, error, attempt) => {
              S.progress.failCounts[item.id] = attempt;
              taskList.update("conv-" + item.id, {
                status: "failed",
                error,
              });
              addLog(
                "\u2717 " +
                  (item.title || item.id) +
                  " (attempt " + attempt + "): " + error,
              );
              saveDebounce(false);
            },
            onItemDead: (item, error) => {
              S.progress.pending = S.progress.pending.filter(
                (p) => p.id !== item.id,
              );
              S.progress.dead = (S.progress.dead || [])
                .concat([{ ...item, lastError: error }])
                .slice(-500);
              addLog(
                "\u2717 Dead-lettered: " +
                  (item.title || item.id) +
                  ": " + error,
              );
              saveDebounce(false);
              ui.renderAll();
            },
            onDrained: () => {
              chatDrained = true;
              checkCompletion();
            },
            onStatsChanged: () => {
              saveDebounce(false);
            },
          },
        );
        exporter.chatQueue = _chatQueue;

        // Create knowledge file queue
        const kfItems = filterGid
          ? (S.progress.knowledgeFilesPending || []).filter(
              (x) => x.projectId === filterGid,
            )
          : (S.progress.knowledgeFilesPending || []);

        const _knowledgeQueue = createQueue(
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
            onItemDone: (item: any) => {
              S.progress.knowledgeFilesPending =
                S.progress.knowledgeFilesPending.filter(
                  (p) => p.fileId !== item.fileId,
                );
              S.progress.knowledgeFilesExported = (
                S.progress.knowledgeFilesExported || []
              ).concat([item]);
              S.stats.knowledgeFilesDownloaded =
                (S.stats.knowledgeFilesDownloaded || 0) + 1;
              taskList.update("kf-" + item.fileId, {
                status: "done",
                detail: null,
              });
              addLog(
                "\u2713 KF [" + item.projectName + "] " + item.fileName,
              );
              saveDebounce(false);
              ui.renderAll();
            },
            onItemFailed: (item: any, error: string, attempt: number) => {
              S.progress.knowledgeFilesFailCounts[item.fileId] = attempt;
              taskList.update("kf-" + item.fileId, {
                status: "failed",
                error,
              });
              addLog(
                "\u2717 KF [" + item.projectName + "] " + item.fileName +
                  " (attempt " + attempt + "): " + error,
              );
              saveDebounce(false);
            },
            onItemDead: (item: any, error: string) => {
              S.progress.knowledgeFilesPending =
                S.progress.knowledgeFilesPending.filter(
                  (p) => p.fileId !== item.fileId,
                );
              S.progress.knowledgeFilesDead = (
                S.progress.knowledgeFilesDead || []
              )
                .concat([{ ...item, lastError: error }])
                .slice(-500);
              addLog(
                "\u2717 KF dead-lettered: [" + item.projectName + "] " +
                  item.fileName + ": " + error,
              );
              saveDebounce(false);
              ui.renderAll();
            },
            onDrained: () => {
              knowledgeDrained = true;
              checkCompletion();
            },
            onStatsChanged: () => {
              saveDebounce(false);
            },
          },
        );
        exporter.knowledgeQueue = _knowledgeQueue;

        // Populate chat queue items
        const chatItems = filterGid
          ? S.progress.pending.filter((x) => x.gizmo_id === filterGid)
          : [...S.progress.pending];

        // Add task list entries
        for (const item of chatItems) {
          const projName = item.gizmo_id
            ? (
                (S.projects || []).find(
                  (p) => p.gizmoId === item.gizmo_id,
                ) || ({} as any)
              ).name
            : null;
          taskList.add({
            id: "conv-" + item.id,
            type: "conversation",
            label: item.title || item.id,
            projectName: projName || null,
            status: "queued",
            detail: null,
          });
        }
        for (const item of kfItems) {
          taskList.add({
            id: "kf-" + item.fileId,
            type: "knowledge",
            label: item.fileName,
            projectName: item.projectName,
            status: "queued",
            detail: null,
          });
        }

        // Enqueue items
        _chatQueue.enqueue(chatItems);

        const kfQueueItems = kfItems.map((item) => ({
          ...item,
          id: item.fileId,
        }));
        _knowledgeQueue.enqueue(kfQueueItems);

        // Enqueue any leftover file pending items from a previous interrupted run
        if (S.progress.filePending && S.progress.filePending.length) {
          for (const item of S.progress.filePending) {
            taskList.add({
              id: "file-" + item.id,
              type: "file",
              label: item.name || item.id,
              projectName: null,
              status: "queued",
              detail: "[" + item.conversationTitle + "]",
            });
          }
          _attachmentQueue.enqueue(S.progress.filePending);
          S.progress.filePending = [];
        }

        // If nothing to do at all
        if (!chatItems.length && !kfQueueItems.length && !_attachmentQueue.stats.pending) {
          ui.setStatus("\u2705 All done.");
          addLog("All done.");
          if (!exporter.stopRequested && deps.onExportComplete) {
            await deps.onExportComplete();
          }
          return;
        }

        addLog(
          "Queues started: " +
            chatItems.length + " chats, " +
            (_attachmentQueue.stats.pending || 0) + " files, " +
            kfQueueItems.length + " knowledge files.",
        );

        // Start queues. Use fire-and-forget for queue start promises.
        // Completion is coordinated via the coordinatorPromise.
        if (chatItems.length) {
          _chatQueue.start(ac.signal);
        } else {
          chatDrained = true;
        }

        // Attachment queue always starts — it receives items dynamically from chat workers
        _attachmentQueue.start(ac.signal);

        if (kfQueueItems.length) {
          _knowledgeQueue.start(ac.signal);
        } else {
          knowledgeDrained = true;
        }

        // Check completion in case everything was already marked drained
        // (e.g., no chats and no KF items but filePending from a previous run)
        checkCompletion();

        // Also listen for abort to resolve coordinator
        const onAbort = (): void => {
          if (resolveCoordinator) {
            const r = resolveCoordinator;
            resolveCoordinator = null;
            r();
          }
        };
        ac.signal.addEventListener("abort", onAbort, { once: true });

        // Wait for all queues to complete or be stopped
        await coordinatorPromise;

        ac.signal.removeEventListener("abort", onAbort);

        // Determine final status
        const anyPending =
          S.progress.pending.length > 0 ||
          (S.progress.knowledgeFilesPending || []).length > 0;

        if (exporter.stopRequested) {
          ui.setStatus("Paused.");
          addLog("Stopped.");
        } else if (anyPending) {
          ui.setStatus("Paused.");
          addLog("Paused. Some items pending.");
        } else {
          ui.setStatus("\u2705 All done.");
          addLog("All done.");
          if (deps.onExportComplete) {
            await deps.onExportComplete();
          }
        }
      } catch (e: any) {
        if (e && e.name === "AbortError") {
          ui.setStatus("Paused.");
          addLog("Stopped.");
        } else {
          S.run.lastError = String((e && e.message) || e);
          ui.setStatus(
            "\u274C Error: " + ((e && e.message) || e),
          );
          addLog("Error: " + ((e && e.message) || e));
          console.error(e);
        }
      } finally {
        S.run.isRunning = false;
        S.run.stoppedAt = now();
        saveDebounce(true);
        ui.renderAll();
        exporter.abort = null;
        exporter.chatQueue = null;
        exporter.attachmentQueue = null;
        exporter.knowledgeQueue = null;
      }
    },

    stop(): void {
      if (
        !exporter.abort &&
        !exporter._scanAbort &&
        !S.run.isRunning
      ) {
        addLog("Not running.");
        return;
      }
      exporter.stopRequested = true;
      S.run.isRunning = false;
      saveDebounce(true);
      addLog("Stop requested\u2026");
      ui.setStatus("Stopping\u2026");
      if (exporter.chatQueue) exporter.chatQueue.stop();
      if (exporter.attachmentQueue) exporter.attachmentQueue.stop();
      if (exporter.knowledgeQueue) exporter.knowledgeQueue.stop();
      if (exporter.abort) exporter.abort.abort();
      if (exporter._scanAbort) exporter._scanAbort.abort();
    },
  };

  return exporter;
};
