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
import { now, clamp, fmtMs } from "../utils/format";
import { sanitizeName } from "../utils/sanitize";
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
  rescan(force: boolean): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  exportOneBatch(signal: AbortSignal): Promise<void>;
  exportKnowledgeBatch(signal: AbortSignal): Promise<void>;
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
          S.run.lastPhase = "scan";
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
            (S.progress.kfExported || []).map((x) => x.fileId),
          );
          const kfDeadSet = new Set(
            (S.progress.kfDead || []).map((x) => x.fileId),
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
          S.progress.kfPending = kfPendingNew;
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
          S.run.lastPhase = "idle";
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
        S.run.lastPhase = "prepare";
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
        S.run.isRunning = true;
        S.run.lastPhase = "run";
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

        const _eligibleConvs = (): number => {
          return filterGid
            ? S.progress.pending.filter(
                (x) => x.gizmo_id === filterGid,
              ).length
            : S.progress.pending.length;
        };
        const _eligibleKf = (): number => {
          return filterGid
            ? (S.progress.kfPending || []).filter(
                (x) => x.projectId === filterGid,
              ).length
            : (S.progress.kfPending || []).length;
        };

        while (S.run.isRunning) {
          if (!_eligibleConvs() && exporter.scanPromise) {
            ui.setStatus(
              "Waiting for scan to find conversations\u2026",
            );
            await sleep(500, ac.signal);
            continue;
          }
          if (!_eligibleConvs() || exporter.stopRequested)
            break;
          await exporter.exportOneBatch(ac.signal);
          if (exporter.stopRequested) break;
        }
        if (!exporter.stopRequested && _eligibleKf()) {
          addLog(
            "Conversations done. Starting knowledge file export\u2026",
          );
          while (S.run.isRunning) {
            if (!_eligibleKf() || exporter.stopRequested)
              break;
            await exporter.exportKnowledgeBatch(ac.signal);
            if (exporter.stopRequested) break;
          }
        }
        const anyPending = _eligibleConvs() || _eligibleKf();
        ui.setStatus(
          anyPending ? "Paused." : "\u2705 All done.",
        );
        addLog(anyPending ? "Paused." : "All done.");
        if (!anyPending && !exporter.stopRequested && deps.onExportComplete) {
          await deps.onExportComplete();
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
        S.run.lastPhase = "idle";
        saveDebounce(true);
        ui.renderAll();
        exporter.abort = null;
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
      S.run.lastPhase = "idle";
      saveDebounce(true);
      addLog("Stop requested\u2026");
      ui.setStatus("Stopping\u2026");
      if (exporter.abort) exporter.abort.abort();
      if (exporter._scanAbort) exporter._scanAbort.abort();
    },

    async exportOneBatch(signal: AbortSignal): Promise<void> {
      const batchSize = clamp(
        parseInt(String(S.settings.batch), 10) || 50,
        1,
        500,
      );
      const conc = clamp(
        parseInt(String(S.settings.conc), 10) || 3,
        1,
        8,
      );
      const pause = clamp(
        parseInt(String(S.settings.pause), 10) || 300,
        0,
        5000,
      );
      const filterGid = S.settings.filterGizmoId || null;
      const eligible = filterGid
        ? S.progress.pending.filter(
            (x) => x.gizmo_id === filterGid,
          )
        : S.progress.pending;
      const batchItems = eligible.slice(0, batchSize);
      if (!batchItems.length) return;

      const successes: any[] = [];
      const successIds = new Set<string>();
      const exportedMap = S.progress.exported || {};
      const failInfo: Record<string, string> = {};
      let filesSaved = 0;
      let filesFailed = 0;
      const queue = batchItems.slice();
      const tBatchStart = now();
      addLog(
        "Batch starting: " +
          batchItems.length +
          " chats (conc " +
          conc +
          ").",
      );

      const worker = async (): Promise<void> => {
        while (queue.length && !(signal && signal.aborted)) {
          const item = queue.shift()!;
          const projName = item.gizmo_id
            ? (
                (S.projects || []).find(
                  (p) => p.gizmoId === item.gizmo_id,
                ) || ({} as any)
              ).name
            : null;
          const title = projName
            ? "[" +
              projName +
              "] " +
              (item.title || item.id)
            : item.title || item.id;
          const taskId = "conv-" + item.id;
          taskList.add({
            id: taskId,
            type: "conversation",
            label: item.title || item.id,
            projectName: projName || null,
            status: "active",
            detail: "fetching conversation",
          });
          const t0 = now();
          try {
            const detail = await net.fetchJson(
              "/backend-api/conversation/" + item.id,
              { signal, auth: true },
            );
            const refs = extractFileRefs(detail);
            if (refs.length)
              taskList.update(taskId, {
                detail:
                  "downloading 1/" + refs.length + " files",
              });
            for (let i = 0; i < refs.length; i++) {
              if (signal && signal.aborted)
                throw new DOMException(
                  "Aborted",
                  "AbortError",
                );
              const f = refs[i];
              taskList.update(taskId, {
                detail:
                  "downloading " +
                  (i + 1) +
                  "/" +
                  refs.length +
                  " files",
              });
              try {
                const meta = (await net.fetchJson(
                  "/backend-api/files/download/" + f.id,
                  { signal, auth: true },
                )) as any;
                if (meta && meta.download_url) {
                  const isSameOrigin =
                    meta.download_url.startsWith("/") ||
                    meta.download_url.startsWith(
                      location.origin,
                    );
                  const blob = await net.fetchBlob(
                    meta.download_url,
                    {
                      signal,
                      auth: false,
                      credentials: isSameOrigin
                        ? "same-origin"
                        : "omit",
                    },
                  );
                  const ext =
                    blob.type && blob.type.indexOf("/") > -1
                      ? blob.type.split("/")[1]
                      : "bin";
                  const fname = f.name
                    ? f.id +
                      "_" +
                      sanitizeName(f.name)
                    : f.id +
                      "." +
                      sanitizeName(ext);
                  await exportBlobStore.putFile(fname, blob);
                  filesSaved++;
                } else {
                  filesFailed++;
                  addLog(
                    "No download_url for file " +
                      f.id +
                      " (" +
                      title +
                      ")",
                  );
                }
              } catch (e: any) {
                filesFailed++;
                addLog(
                  "File failed " +
                    f.id +
                    " (" +
                    title +
                    "): " +
                    ((e && e.message) || e),
                );
              }
              if (pause)
                await sleep(pause, signal).catch(() => {});
            }
            await exportBlobStore.putConv(
              item.id,
              JSON.stringify(detail),
            );
            successes.push(detail);
            successIds.add(item.id);
            exportedMap[item.id] = item.update_time || 0;
            S.progress.exported = exportedMap;
            taskList.update(taskId, {
              status: "done",
              detail: null,
            });
            addLog(
              "\u2713 " +
                title +
                " (" +
                fmtMs(now() - t0) +
                ", files " +
                refs.length +
                ")",
            );
          } catch (e: any) {
            if (e && e.name === "AbortError") throw e;
            const msg = (e && e.message) || String(e);
            failInfo[item.id] = msg;
            taskList.update(taskId, {
              status: "failed",
              error: msg,
            });
            addLog("\u2717 " + title + ": " + msg);
          }
          ui.renderAll();
          if (pause)
            await sleep(pause, signal).catch(() => {});
        }
      };

      const workers: Promise<void>[] = [];
      for (
        let i = 0;
        i < Math.min(conc, queue.length || 1);
        i++
      )
        workers.push(worker());
      try {
        await Promise.all(workers);
      } catch (e: any) {
        if (!(e && e.name === "AbortError")) throw e;
      }

      const batchWall = now() - tBatchStart;

      const updatePendingAfterBatch = (): {
        requeueCount: number;
        deadCount: number;
      } => {
        const batchIdSet = new Set(
          batchItems.map((x) => x.id),
        );
        const rest = S.progress.pending.filter(
          (x) => !batchIdSet.has(x.id),
        );
        const requeue: PendingItem[] = [];
        const dead: DeadItem[] = [];
        const fc = S.progress.failCounts || {};
        for (const it of batchItems) {
          if (successIds.has(it.id)) continue;
          const n = (fc[it.id] || 0) + 1;
          fc[it.id] = n;
          if (n >= 3)
            dead.push({
              ...it,
              lastError: failInfo[it.id] || "failed",
            });
          else requeue.push(it);
        }
        if (dead.length) {
          S.progress.dead = (S.progress.dead || [])
            .concat(dead)
            .slice(-500);
          addLog(
            "Moved " +
              dead.length +
              " chats to dead-letter after 3 failures.",
          );
        }
        S.progress.failCounts = fc;
        S.progress.pending = rest.concat(requeue);
        return {
          requeueCount: requeue.length,
          deadCount: dead.length,
        };
      };

      if (successes.length) {
        S.stats.batches = (S.stats.batches || 0) + 1;
        S.stats.batchMs =
          (S.stats.batchMs || 0) + batchWall;
        S.stats.chats =
          (S.stats.chats || 0) + successes.length;
        const moved = updatePendingAfterBatch();
        saveDebounce(true);
        addLog(
          "Batch done: exported " +
            successes.length +
            " chats in " +
            fmtMs(batchWall) +
            ". Pending " +
            S.progress.pending.length +
            ". Files +" +
            filesSaved +
            "/-" +
            filesFailed +
            ".",
        );
        if (moved.requeueCount === batchItems.length) {
          addLog(
            "No progress detected; pausing to avoid infinite retries.",
          );
          exporter.stopRequested = true;
          if (exporter.abort) exporter.abort.abort();
        }
      } else {
        const moved = updatePendingAfterBatch();
        saveDebounce(true);
        addLog(
          "Batch ended with 0 exports (" +
            fmtMs(batchWall) +
            "). Requeued " +
            moved.requeueCount +
            ", dead " +
            moved.deadCount +
            ".",
        );
        ui.setStatus("Batch had 0 exports (see log).");
        if (
          moved.requeueCount &&
          moved.requeueCount === batchItems.length
        ) {
          addLog(
            "No progress this batch; pausing to avoid infinite retries.",
          );
          exporter.stopRequested = true;
          if (exporter.abort) exporter.abort.abort();
        }
      }
      await exportBlobStore.totalSize();
      ui.renderAll();
    },

    async exportKnowledgeBatch(
      signal: AbortSignal,
    ): Promise<void> {
      const batchSize = clamp(
        parseInt(String(S.settings.batch), 10) || 50,
        1,
        500,
      );
      const conc = clamp(
        parseInt(String(S.settings.conc), 10) || 3,
        1,
        8,
      );
      const pause = clamp(
        parseInt(String(S.settings.pause), 10) || 300,
        0,
        5000,
      );
      const filterGid = S.settings.filterGizmoId || null;
      const kfEligible = filterGid
        ? S.progress.kfPending.filter(
            (x) => x.projectId === filterGid,
          )
        : S.progress.kfPending;
      const batchItems = kfEligible.slice(0, batchSize);
      if (!batchItems.length) return;

      const successes: KfPendingItem[] = [];
      const successIds = new Set<string>();
      const failInfo: Record<string, string> = {};
      const projectsInBatch = new Set<string>();
      const queue = batchItems.slice();
      const tBatchStart = now();
      addLog(
        "KF batch starting: " +
          batchItems.length +
          " files (conc " +
          conc +
          ").",
      );
      S.run.lastPhase = "kf";
      saveDebounce(false);

      const worker = async (): Promise<void> => {
        while (queue.length && !(signal && signal.aborted)) {
          const item = queue.shift()!;
          const label =
            "[" + item.projectName + "] " + item.fileName;
          const taskId = "kf-" + item.fileId;
          taskList.add({
            id: taskId,
            type: "knowledge",
            label: item.fileName,
            projectName: item.projectName,
            status: "active",
            detail: "downloading",
          });
          const t0 = now();
          try {
            const meta = (await net.fetchJson(
              "/backend-api/files/download/" +
                encodeURIComponent(item.fileId) +
                "?gizmo_id=" +
                encodeURIComponent(item.projectId) +
                "&inline=false",
              { signal, auth: true },
            )) as any;
            if (
              meta &&
              meta.status === "error" &&
              meta.error_code === "file_not_found"
            ) {
              S.progress.kfDead = (
                S.progress.kfDead || []
              )
                .concat([
                  {
                    ...item,
                    lastError: "file_not_found",
                  } as KfDeadItem,
                ])
                .slice(-500);
              S.progress.kfFailCounts[item.fileId] = 3;
              failInfo[item.fileId] = "file_not_found";
              taskList.update(taskId, {
                status: "failed",
                error: "file_not_found",
              });
              addLog(
                "\u2717 KF dead-lettered (not found): " +
                  label,
              );
              ui.renderAll();
              if (pause)
                await sleep(pause, signal).catch(() => {});
              continue;
            }
            if (
              meta &&
              meta.status === "success" &&
              meta.download_url
            ) {
              const isSameOrigin =
                meta.download_url.startsWith("/") ||
                meta.download_url.startsWith(
                  location.origin,
                );
              const blob = await net.fetchBlob(
                meta.download_url,
                {
                  signal,
                  auth: false,
                  credentials: isSameOrigin
                    ? "same-origin"
                    : "omit",
                },
              );
              const safeProjName = sanitizeName(
                item.projectName,
              );
              const safeFname = sanitizeName(
                item.fileName,
              );
              await exportBlobStore.putFile(
                "kf/" + safeProjName + "/" + safeFname,
                blob,
              );
              successes.push(item);
              successIds.add(item.fileId);
              projectsInBatch.add(item.projectId);
              taskList.update(taskId, {
                status: "done",
                detail: null,
              });
              addLog(
                "\u2713 KF " +
                  label +
                  " (" +
                  fmtMs(now() - t0) +
                  ")",
              );
            } else {
              failInfo[item.fileId] =
                "no download_url in response";
              taskList.update(taskId, {
                status: "failed",
                error: "no download_url in response",
              });
              addLog(
                "\u2717 KF no download_url: " + label,
              );
            }
          } catch (e: any) {
            if (e && e.name === "AbortError") throw e;
            const msg = (e && e.message) || String(e);
            failInfo[item.fileId] = msg;
            taskList.update(taskId, {
              status: "failed",
              error: msg,
            });
            addLog("\u2717 KF " + label + ": " + msg);
          }
          ui.renderAll();
          if (pause)
            await sleep(pause, signal).catch(() => {});
        }
      };

      const workers: Promise<void>[] = [];
      for (
        let i = 0;
        i < Math.min(conc, queue.length || 1);
        i++
      )
        workers.push(worker());
      try {
        await Promise.all(workers);
      } catch (e: any) {
        if (!(e && e.name === "AbortError")) throw e;
      }

      const batchWall = now() - tBatchStart;

      const updateKfPendingAfterBatch = (): {
        requeueCount: number;
        deadCount: number;
      } => {
        const batchFileIdSet = new Set(
          batchItems.map((x) => x.fileId),
        );
        const rest = S.progress.kfPending.filter(
          (x) => !batchFileIdSet.has(x.fileId),
        );
        const requeue: KfPendingItem[] = [];
        const dead: KfDeadItem[] = [];
        const fc = S.progress.kfFailCounts || {};
        for (const it of batchItems) {
          if (successIds.has(it.fileId)) continue;
          if (fc[it.fileId] >= 3) continue;
          const n = (fc[it.fileId] || 0) + 1;
          fc[it.fileId] = n;
          if (n >= 3)
            dead.push({
              ...it,
              lastError: failInfo[it.fileId] || "failed",
            });
          else requeue.push(it);
        }
        if (dead.length) {
          S.progress.kfDead = (S.progress.kfDead || [])
            .concat(dead)
            .slice(-500);
          addLog(
            "Moved " +
              dead.length +
              " knowledge files to dead-letter after 3 failures.",
          );
        }
        S.progress.kfFailCounts = fc;
        S.progress.kfPending = rest.concat(requeue);
        return {
          requeueCount: requeue.length,
          deadCount: dead.length,
        };
      };

      if (successes.length) {
        for (const projId of projectsInBatch) {
          const proj = (S.projects || []).find(
            (p) => p.gizmoId === projId,
          );
          if (proj && proj.raw) {
            const safeProjName = sanitizeName(proj.name);
            await exportBlobStore.putFile(
              "kf/" + safeProjName + "/project.json",
              new Blob(
                [JSON.stringify(proj.raw, null, 2)],
                { type: "application/json" },
              ),
            );
          }
        }
        S.progress.kfExported = (
          S.progress.kfExported || []
        ).concat(successes);
        S.stats.kfBatches =
          (S.stats.kfBatches || 0) + 1;
        S.stats.kfMs =
          (S.stats.kfMs || 0) + batchWall;
        S.stats.kfFiles =
          (S.stats.kfFiles || 0) + successes.length;
        const moved = updateKfPendingAfterBatch();
        saveDebounce(true);
        addLog(
          "KF batch done: exported " +
            successes.length +
            " files in " +
            fmtMs(batchWall) +
            ". KF pending " +
            S.progress.kfPending.length +
            ".",
        );
        if (moved.requeueCount === batchItems.length) {
          addLog(
            "No KF progress detected; pausing to avoid infinite retries.",
          );
          exporter.stopRequested = true;
          if (exporter.abort) exporter.abort.abort();
        }
      } else {
        const moved = updateKfPendingAfterBatch();
        saveDebounce(true);
        addLog(
          "KF batch ended with 0 exports (" +
            fmtMs(batchWall) +
            "). Requeued " +
            moved.requeueCount +
            ", dead " +
            moved.deadCount +
            ".",
        );
        ui.setStatus("KF batch had 0 exports (see log).");
        if (
          moved.requeueCount &&
          moved.requeueCount === batchItems.length
        ) {
          addLog(
            "No KF progress this batch; pausing to avoid infinite retries.",
          );
          exporter.stopRequested = true;
          if (exporter.abort) exporter.abort.abort();
        }
      }
      await exportBlobStore.totalSize();
      ui.renderAll();
    },
  };

  return exporter;
};
