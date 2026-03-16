import type { ExportState, ProjectInfo } from "../types";
import type { LogLevel } from "../state/logger";
import { formatLogLine } from "../state/logger";
import type { Net } from "../net/net";
import type { TaskList } from "./task-list";
import { VER } from "../state/defaults";
import { isUsingLocalStorage } from "../state/store";
import { clamp, fmtSize } from "../utils/format";
import { scanProjects as defaultScanProjects } from "../scan/projects";

type LogEntryLike = { timestamp: number; session: string; level: LogLevel; category: string; message: string; context?: Record<string, unknown> };

interface ScanNet {
  fetchJson(
    url: string,
    opts?: { signal?: AbortSignal; auth?: boolean },
  ): Promise<unknown>;
}

export interface UIDeps {
  S: ExportState;
  log: (level: LogLevel, category: string, message: string, context?: Record<string, unknown>) => void;
  net: Net;
  taskList: TaskList;
  saveDebounce: (immediate: boolean) => void;
  getAccumulatedSize?: () => Promise<number>;
  onDownload?: () => Promise<void>;
  onReset?: () => Promise<void>;
  getSessionLogs?: () => LogEntryLike[];
  getLogCount?: () => Promise<number>;
  onDownloadLogs?: () => Promise<void>;
  scanProjects?: (
    net: ScanNet,
    signal: AbortSignal,
    onProject: ((proj: ProjectInfo) => void) | null,
    setStatus: (msg: string) => void,
  ) => Promise<ProjectInfo[]>;
}

export interface UI {
  container: HTMLElement | null;
  inject(): void;
  renderAll(): void;
  renderLogs(): void;
  renderProjects(): void;
  setStatus(msg: string): void;
  setBar(pct: number): void;
  updateDownloadButton(): Promise<void>;
}

interface QueueRef {
  setConcurrency(n: number): void;
  readonly stats: { pending: number; active: number; done: number; dead: number };
}

export interface ExporterRef {
  scanPromise: Promise<unknown> | null;
  start(): void;
  stop(): void;
  rescan(full?: boolean): void;
  chatQueue?: QueueRef | null;
  attachmentQueue?: QueueRef | null;
  knowledgeQueue?: QueueRef | null;
}

const _barStyle = "height:100%;width:0%;border-radius:999px;transition:width 0.3s;";
const _barTrackStyle = "flex:1;height:5px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;min-width:40px;";
const _inputStyle = "width:36px;padding:3px 4px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;text-align:center;font-size:11px;";

const _statsRow = (label: string, prefix: string, barColor: string): string =>
  '<div style="display:flex;gap:8px;align-items:center;font-size:11px;margin-bottom:3px;">' +
  '<span style="width:72px;text-align:right;opacity:0.8;">' + label + '</span>' +
  '<span id="cvz-' + prefix + '-count" style="width:80px;font-variant-numeric:tabular-nums;">0</span>' +
  '<div style="' + _barTrackStyle + '">' +
  '<div id="cvz-' + prefix + '-bar" style="' + _barStyle + 'background:' + barColor + ';"></div>' +
  '</div>' +
  '<span style="opacity:0.6;font-size:10px;">Dead: <span id="cvz-' + prefix + '-dead">0</span></span>' +
  '</div>';

export const createUI = (deps: UIDeps): UI => {
  const { S, log, net, taskList, saveDebounce } = deps;
  const _scanProjects = deps.scanProjects || defaultScanProjects;
  let _exporter: ExporterRef | null = null;
  let _maximized = false;
  let _projectLoadPromise: Promise<unknown> | null = null;
  let _projectLoadAbort: AbortController | null = null;
  let _tickId: ReturnType<typeof setInterval> | 0 = 0;

  const _populateProjectSelect = (): void => {
    const sel =
      ui.container && ui.container.querySelector("#cvz-proj-select");
    if (!sel) return;
    const current = S.settings.filterGizmoId || "";
    const projects = S.projects || [];
    let html = "";
    if (_projectLoadPromise) {
      html = '<option value="">Loading projects\u2026</option>';
    } else if (!projects.length) {
      html = '<option value="">(no projects found)</option>';
    } else {
      html = '<option value="">-- select a project --</option>';
      for (let i = 0; i < projects.length; i++) {
        const p = projects[i];
        const label = (p.emoji ? p.emoji + " " : "") + (p.name || p.gizmoId);
        const selected = p.gizmoId === current ? " selected" : "";
        html +=
          '<option value="' +
          p.gizmoId +
          '"' +
          selected +
          ">" +
          label +
          "</option>";
      }
    }
    (sel as HTMLSelectElement).innerHTML = html;
    (sel as HTMLSelectElement).disabled =
      !!_projectLoadPromise || !!S.run.isRunning;
  };

  const _loadProjectsOnly = (): void => {
    if (_projectLoadPromise) return;
    const ac = new AbortController();
    _projectLoadAbort = ac;
    log("info", "scan", "Loading projects");
    const p = net
      .getToken(ac.signal)
      .then(() =>
        _scanProjects(
          net,
          ac.signal,
          (proj: ProjectInfo) => {
            if (ui.container) {
              const statusEl = ui.container.querySelector("#cvz-status");
              if (statusEl)
                statusEl.textContent =
                  "Loading projects\u2026 found " + proj.name;
            }
          },
          (msg: string) => ui.setStatus(msg),
        ),
      )
      .then((projects: ProjectInfo[]) => {
        S.projects = projects;
        S.scan.totalProjects = projects.length;
        saveDebounce(true);
        log("info", "scan", "Found " + projects.length + " projects", { count: projects.length });
      })
      .catch((e: unknown) => {
        const err = e as { name?: string; message?: string };
        if (err && err.name === "AbortError") {
          log("info", "scan", "Project load cancelled");
        } else {
          log("error", "scan", "Failed to load projects", {
            error: err && err.message ? err.message : String(e),
          });
        }
      })
      .then(() => {
        _projectLoadPromise = null;
        _projectLoadAbort = null;
        _populateProjectSelect();
        ui.renderAll();
      });
    _projectLoadPromise = p;
    _populateProjectSelect();
  };

  const _setupConcInput = (
    d: HTMLElement,
    inputId: string,
    settingKey: "chatConcurrency" | "fileConcurrency" | "knowledgeFileConcurrency",
    queueKey: "chatQueue" | "attachmentQueue" | "knowledgeQueue",
    label: string,
  ): void => {
    const el = d.querySelector("#" + inputId) as HTMLInputElement;
    el.value = String(S.settings[settingKey] || 3);
    el.addEventListener("change", () => {
      const n = parseInt(el.value, 10);
      const clamped = clamp(isFinite(n) ? n : 3, 1, 10);
      S.settings[settingKey] = clamped;
      el.value = String(clamped);
      // Call setConcurrency on the live queue if running
      if (_exporter) {
        const q = _exporter[queueKey];
        if (q) q.setConcurrency(clamped);
      }
      log("info", "ui", "Concurrency changed", { queue: label.toLowerCase(), value: clamped });
      saveDebounce(true);
      ui.renderAll();
    });
  };

  const _setBarWidth = (id: string, pct: number): void => {
    const el =
      ui.container &&
      (ui.container.querySelector("#" + id) as HTMLElement | null);
    if (el) el.style.width = clamp(pct || 0, 0, 100).toFixed(1) + "%";
  };

  const ui: UI & {
    _exporter: ExporterRef | null;
    setExporter(e: ExporterRef): void;
    ensureTick(): void;
  } = {
    container: null,
    _exporter: null,

    async updateDownloadButton(): Promise<void> {
      const btn = ui.container && (ui.container.querySelector("#cvz-download") as HTMLButtonElement | null);
      const accEl = ui.container && (ui.container.querySelector("#cvz-accumulated") as HTMLElement | null);
      if (!btn) return;
      if (!deps.getAccumulatedSize) {
        btn.style.display = "none";
        if (accEl) accEl.textContent = "0 B";
        return;
      }
      const size = await deps.getAccumulatedSize();
      if (accEl) accEl.textContent = fmtSize(size);
      if (size > 0) {
        btn.style.display = "";
        btn.textContent = "Download (" + fmtSize(size) + ")";
        btn.disabled = false;
      } else {
        btn.style.display = "none";
      }
    },

    setExporter(e: ExporterRef): void {
      _exporter = e;
    },

    inject(): void {
      const existing = document.getElementById("cvz-resume-ui");
      if (existing) {
        ui.container = existing;
        existing.style.display = "block";
        return;
      }
      const d = document.createElement("div");
      d.id = "cvz-resume-ui";
      d.style.cssText =
        "position:fixed;top:20px;right:20px;width:380px;max-width:calc(100vw - 40px);background:rgba(32,33,35,0.95);color:#ececf1;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;z-index:2147483647;font-family:-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 12px 24px rgba(0,0,0,0.35);backdrop-filter:blur(10px);";

      const _useLocalStorage = isUsingLocalStorage();
      d.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
        '<div style="font-weight:700;font-size:14px;">Convoviz Direct Export</div>' +
        '<div style="display:flex;gap:6px;align-items:center;">' +
        '<button id="cvz-max" style="border:0;background:transparent;color:#ececf1;font-size:14px;line-height:18px;cursor:pointer;opacity:0.7;" title="Maximize">\u26f6</button>' +
        '<button id="cvz-x" style="border:0;background:transparent;color:#ececf1;font-size:18px;line-height:18px;cursor:pointer;">\u00d7</button>' +
        "</div>" +
        "</div>" +
        '<div style="opacity:0.75;font-size:11px;margin-top:2px;">' +
        VER +
        (_useLocalStorage
          ? " \u00b7 \u26A0 localStorage fallback \u2014 large exports may lose state"
          : " \u00b7 state in IndexedDB") +
        "</div>" +
        // Per-queue stats area
        '<div data-testid="cvz-stats" style="margin-top:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">' +
        _statsRow("Chats:", "chat", "#10a37f") +
        _statsRow("Files:", "file", "#3b82f6") +
        _statsRow("Knowledge:", "kf", "#a855f7") +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-top:4px;justify-content:flex-end;">' +
        '<div><b>Accumulated:</b> <span id="cvz-accumulated">0 B</span></div>' +
        "</div>" +
        "</div>" +
        // Controls area: Workers + buttons
        '<div data-testid="cvz-controls" style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<span style="font-size:11px;opacity:0.9;">Workers:</span>' +
        '<label style="font-size:10px;opacity:0.7;">Chats</label>' +
        '<input id="cvz-conc-chat" type="number" min="1" max="10" style="' + _inputStyle + '" />' +
        '<label style="font-size:10px;opacity:0.7;">Files</label>' +
        '<input id="cvz-conc-file" type="number" min="1" max="10" style="' + _inputStyle + '" />' +
        '<label style="font-size:10px;opacity:0.7;">KF</label>' +
        '<input id="cvz-conc-kf" type="number" min="1" max="10" style="' + _inputStyle + '" />' +
        "</div>" +
        '<div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<button id="cvz-rescan" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;">Rescan</button>' +
        '<button id="cvz-start" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(16,163,127,0.6);background:rgba(16,163,127,0.15);color:#ececf1;cursor:pointer;font-weight:600;">Start</button>' +
        '<button id="cvz-stop" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;font-weight:600;">Stop</button>' +
        "</div>" +
        '<div id="cvz-project-filter" style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<label style="font-size:11px;cursor:pointer;display:flex;align-items:center;gap:4px;"><input id="cvz-single-proj" type="checkbox" style="margin:0;cursor:pointer;" /> Single project</label>' +
        '<select id="cvz-proj-select" style="flex:1;min-width:0;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;font-size:11px;display:none;"><option value="">(rescan first to load projects)</option></select>' +
        "</div>" +
        '<div id="cvz-status" style="margin-top:6px;font-size:11px;opacity:0.85;min-height:14px;"></div>' +
        '<div id="cvz-tasks" style="margin-top:6px;height:180px;overflow-y:auto;border-radius:10px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);padding:6px 8px;font-size:11px;"></div>' +
        '<textarea id="cvz-log" readonly style="margin-top:10px;height:80px;width:100%;box-sizing:border-box;resize:vertical;font-size:11px;white-space:pre-wrap;background:rgba(0,0,0,0.25);color:#ececf1;border:1px solid rgba(255,255,255,0.08);padding:8px;border-radius:10px;font-family:inherit;outline:none;"></textarea>' +
        '<div style="margin-top:10px;display:flex;justify-content:space-between;gap:8px;">' +
        '<button id="cvz-reset" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;font-size:11px;">Reset</button>' +
        '<button id="cvz-download" data-testid="cvz-download" style="display:none;padding:6px 10px;border-radius:8px;border:1px solid rgba(16,163,127,0.6);background:rgba(16,163,127,0.15);color:#ececf1;cursor:pointer;font-size:11px;font-weight:600;">Download</button>' +
        '<button id="cvz-dllogs" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;font-size:11px;">Logs (0)</button>' +
        '<button id="cvz-dlstate" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;font-size:11px;">Export state</button>' +
        "</div>";

      document.body.appendChild(d);
      ui.container = d;

      if (!document.getElementById("cvz-spin-style")) {
        const styleEl = document.createElement("style");
        styleEl.id = "cvz-spin-style";
        styleEl.textContent =
          "@keyframes cvz-spin { to { transform: rotate(360deg); } }";
        document.head.appendChild(styleEl);
      }

      d.querySelector("#cvz-x")!.addEventListener("click", () => {
        d.style.display = "none";
      });

      d.querySelector("#cvz-max")!.addEventListener("click", () => {
        _maximized = !_maximized;
        const m = _maximized;
        d.style.top = m ? "0" : "20px";
        d.style.right = m ? "0" : "20px";
        d.style.width = m ? "100vw" : "380px";
        d.style.maxWidth = m ? "100vw" : "calc(100vw - 40px)";
        d.style.height = m ? "100vh" : "";
        d.style.borderRadius = m ? "0" : "12px";
        d.style.display = m ? "flex" : "block";
        d.style.flexDirection = m ? "column" : "";
        const tasks = d.querySelector("#cvz-tasks") as HTMLElement | null;
        if (tasks) tasks.style.flex = m ? "1" : "";
        if (tasks) tasks.style.height = m ? "" : "180px";
        const log = d.querySelector("#cvz-log") as HTMLElement | null;
        if (log) log.style.flex = m ? "1" : "";
        if (log) log.style.height = m ? "" : "80px";
        const btn = d.querySelector("#cvz-max")!;
        btn.textContent = m ? "\u2750" : "\u26f6";
        (btn as HTMLElement).title = m ? "Restore" : "Maximize";
      });

      d.querySelector("#cvz-start")!.addEventListener("click", () => {
        if (_exporter) _exporter.start();
      });
      d.querySelector("#cvz-stop")!.addEventListener("click", () => {
        if (_exporter) _exporter.stop();
      });
      d.querySelector("#cvz-rescan")!.addEventListener("click", () => {
        if (_exporter) _exporter.rescan(false);
      });

      d.querySelector("#cvz-reset")!.addEventListener("click", async () => {
        if (!deps.onReset) return;
        const ok = confirm(
          "Reset all export state and accumulated export data? This cannot be undone.",
        );
        if (!ok) return;
        await deps.onReset();
      });

      d.querySelector("#cvz-download")!.addEventListener("click", () => {
        if (deps.onDownload) deps.onDownload();
      });

      d.querySelector("#cvz-dllogs")!.addEventListener("click", () => {
        if (deps.onDownloadLogs) deps.onDownloadLogs();
      });

      d.querySelector("#cvz-dlstate")!.addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(S, null, 2)], {
          type: "application/json",
        });
        net.download(blob, "convoviz_export_state.json");
      });

      // Per-queue concurrency inputs
      _setupConcInput(d, "cvz-conc-chat", "chatConcurrency", "chatQueue", "Chat");
      _setupConcInput(d, "cvz-conc-file", "fileConcurrency", "attachmentQueue", "File");
      _setupConcInput(d, "cvz-conc-kf", "knowledgeFileConcurrency", "knowledgeQueue", "Knowledge");

      const singleProjCheck = d.querySelector(
        "#cvz-single-proj",
      ) as HTMLInputElement;
      const projSelect = d.querySelector(
        "#cvz-proj-select",
      ) as HTMLSelectElement;
      singleProjCheck.checked = !!S.settings.filterGizmoId;
      projSelect.style.display = S.settings.filterGizmoId ? "" : "none";

      singleProjCheck.addEventListener("change", () => {
        if (S.run.isRunning) {
          singleProjCheck.checked = !!S.settings.filterGizmoId;
          log("warn", "ui", "Stop first to change project filter.");
          return;
        }
        if (!singleProjCheck.checked) {
          S.settings.filterGizmoId = null;
          projSelect.style.display = "none";
          saveDebounce(true);
          log("info", "ui", "Project filter cleared");
          ui.renderAll();
        } else {
          projSelect.style.display = "";
          if (!(S.projects || []).length && !_projectLoadPromise) {
            _loadProjectsOnly();
          } else {
            _populateProjectSelect();
          }
          if (projSelect.value) {
            S.settings.filterGizmoId = projSelect.value;
            saveDebounce(true);
          }
        }
      });

      projSelect.addEventListener("change", () => {
        if (S.run.isRunning) {
          projSelect.value = S.settings.filterGizmoId || "";
          log("warn", "ui", "Stop first to change project filter.");
          return;
        }
        S.settings.filterGizmoId = projSelect.value || null;
        saveDebounce(true);
        if (projSelect.value) {
          const name =
            projSelect.options[projSelect.selectedIndex].textContent;
          log("info", "ui", "Filter set to project", { projectName: name, gizmoId: projSelect.value });
        }
        ui.renderAll();
      });
    },

    setStatus(msg: string): void {
      const el =
        ui.container && ui.container.querySelector("#cvz-status");
      if (el) el.textContent = msg;
    },

    setBar(pct: number): void {
      _setBarWidth("cvz-chat-bar", pct);
    },

    renderLogs(): void {
      const el =
        ui.container &&
        (ui.container.querySelector("#cvz-log") as HTMLTextAreaElement | null);
      if (!el) return;
      if (deps.getSessionLogs) {
        const entries = deps.getSessionLogs();
        const lines: string[] = [];
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (e.level === "debug") continue;
          lines.push(formatLogLine(e));
        }
        el.value = lines.join("\n");
      }
      el.scrollTop = el.scrollHeight;
    },

    renderProjects(): void {
      _populateProjectSelect();
    },

    renderAll(): void {
      if (!ui.container) return;
      const exported = Object.keys(S.progress.exported || {}).length;
      const dead = (S.progress.dead || []).length;
      const scanning = !!(_exporter && _exporter.scanPromise);

      // Chat row — total from scanner API; fallback to exported + queue in-flight + dead
      const chatInFlight = _exporter?.chatQueue?.stats
        ? _exporter.chatQueue.stats.pending + _exporter.chatQueue.stats.active
        : 0;
      const chatTotal = S.scan.total ? S.scan.total : (exported + chatInFlight + dead);
      const chatLabel = scanning
        ? exported + "/" + chatTotal + "\u2026"
        : exported + "/" + chatTotal;
      const chatEl = ui.container.querySelector("#cvz-chat-count");
      if (chatEl) chatEl.textContent = chatLabel;
      const chatDeadEl = ui.container.querySelector("#cvz-chat-dead");
      if (chatDeadEl) chatDeadEl.textContent = String(dead);
      const chatPct = chatTotal ? (exported / chatTotal) * 100 : 0;
      _setBarWidth("cvz-chat-bar", chatPct);

      // File row — total from done + queue in-flight + dead
      const fileDone = S.progress.fileDoneCount || 0;
      const fileInFlight = _exporter?.attachmentQueue?.stats
        ? _exporter.attachmentQueue.stats.pending + _exporter.attachmentQueue.stats.active
        : 0;
      const fileDead = (S.progress.fileDead || []).length;
      const fileTotal = fileDone + fileInFlight + fileDead;
      const fileLabel = fileTotal
        ? fileDone + "/" + fileTotal
        : String(fileDone);
      const fileEl = ui.container.querySelector("#cvz-file-count");
      if (fileEl) fileEl.textContent = fileLabel;
      const fileDeadEl = ui.container.querySelector("#cvz-file-dead");
      if (fileDeadEl) fileDeadEl.textContent = String(fileDead);
      const filePct = fileTotal ? (fileDone / fileTotal) * 100 : 0;
      _setBarWidth("cvz-file-bar", filePct);

      // Knowledge row — total from done + queue in-flight + dead
      const kfExp = (S.progress.knowledgeFilesExported || []).length;
      const kfInFlight = _exporter?.knowledgeQueue?.stats
        ? _exporter.knowledgeQueue.stats.pending + _exporter.knowledgeQueue.stats.active
        : 0;
      const kfDead = (S.progress.knowledgeFilesDead || []).length;
      const kfTotal = kfExp + kfInFlight + kfDead;
      const kfLabel = kfTotal
        ? kfExp + "/" + kfTotal
        : String(kfExp);
      const kfEl = ui.container.querySelector("#cvz-kf-count");
      if (kfEl) kfEl.textContent = kfLabel;
      const kfDeadEl = ui.container.querySelector("#cvz-kf-dead");
      if (kfDeadEl) kfDeadEl.textContent = String(kfDead);
      const kfPct = kfTotal ? (kfExp / kfTotal) * 100 : 0;
      _setBarWidth("cvz-kf-bar", kfPct);

      const singleCheck = ui.container.querySelector(
        "#cvz-single-proj",
      ) as HTMLInputElement | null;
      if (singleCheck) {
        singleCheck.disabled = !!S.run.isRunning;
        if (singleCheck.checked) _populateProjectSelect();
      }

      ui.renderLogs();
      ui.updateDownloadButton();
      // Update log count on the download logs button
      if (deps.getLogCount) {
        deps.getLogCount().then((count: number) => {
          const btn = ui.container && (ui.container.querySelector("#cvz-dllogs") as HTMLButtonElement | null);
          if (btn) btn.textContent = "Logs (" + count.toLocaleString() + ")";
        }).catch(() => {});
      }
      taskList.render();
    },

    ensureTick(): void {
      if (_tickId) return;
      _tickId = setInterval(() => {
        if (!document.getElementById("cvz-resume-ui")) {
          clearInterval(_tickId as ReturnType<typeof setInterval>);
          _tickId = 0;
          return;
        }
        ui.renderAll();
        if (!S.run.isRunning && !(_exporter && _exporter.scanPromise)) {
          clearInterval(_tickId as ReturnType<typeof setInterval>);
          _tickId = 0;
        }
      }, 1000);
    },
  };

  return ui;
};
