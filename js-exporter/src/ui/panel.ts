import type { ExportState, ProjectInfo } from "../types";
import type { Net } from "../net/net";
import type { TaskList } from "./task-list";
import { VER } from "../state/defaults";
import { isUsingLocalStorage } from "../state/store";
import { clamp, fmtSize } from "../utils/format";
import { scanProjects as defaultScanProjects } from "../scan/projects";

interface ScanNet {
  fetchJson(
    url: string,
    opts?: { signal?: AbortSignal; auth?: boolean },
  ): Promise<unknown>;
}

export interface UIDeps {
  S: ExportState;
  addLog: (msg: string) => void;
  net: Net;
  taskList: TaskList;
  saveDebounce: (immediate: boolean) => void;
  getAccumulatedSize?: () => Promise<number>;
  onDownload?: () => Promise<void>;
  onReset?: () => Promise<void>;
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

export interface ExporterRef {
  scanPromise: Promise<unknown> | null;
  start(): void;
  stop(): void;
  rescan(full?: boolean): void;
}

export const createUI = (deps: UIDeps): UI => {
  const { S, addLog, net, taskList, saveDebounce } = deps;
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
    addLog("Loading projects\u2026");
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
        addLog("Found " + projects.length + " projects.");
      })
      .catch((e: unknown) => {
        const err = e as { name?: string; message?: string };
        if (err && err.name === "AbortError") {
          addLog("Project load cancelled.");
        } else {
          addLog(
            "Failed to load projects: " + (err && err.message ? err.message : String(e)),
          );
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
        btn.disabled = !!S.run.isRunning;
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
        '<div data-testid="cvz-stats" style="margin-top:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">' +
        '<div style="display:flex;gap:10px;align-items:center;font-size:12px;">' +
        '<div><b>Exported:</b> <span id="cvz-exported">0</span></div>' +
        '<div>\u00b7</div>' +
        '<div><b>Pending:</b> <span id="cvz-pending">0</span></div>' +
        '<div>\u00b7</div>' +
        '<div><b>Dead:</b> <span id="cvz-dead">0</span></div>' +
        '<div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;min-width:40px;">' +
        '<div id="cvz-bar" style="height:100%;width:0%;background:#10a37f;"></div>' +
        "</div>" +
        "</div>" +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;margin-top:4px;">' +
        '<div><b>Projects:</b> <span id="cvz-projects">0</span></div>' +
        '<div>\u00b7</div>' +
        '<div><b>KF:</b> <span id="cvz-kf-count">0/0</span></div>' +
        '<div>\u00b7</div>' +
        '<div><b>Accumulated:</b> <span id="cvz-accumulated">0 B</span></div>' +
        "</div>" +
        "</div>" +
        '<div data-testid="cvz-controls" style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
        '<label style="font-size:11px;opacity:0.9;">Batch</label>' +
        '<input id="cvz-batch" type="number" min="1" max="500" style="width:60px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;" />' +
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

      d.querySelector("#cvz-dlstate")!.addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(S, null, 2)], {
          type: "application/json",
        });
        net.download(blob, "convoviz_export_state.json");
      });

      const batchEl = d.querySelector("#cvz-batch") as HTMLInputElement;
      batchEl.value = String(S.settings.batch || 50);
      batchEl.addEventListener("change", () => {
        const n = parseInt(batchEl.value, 10);
        if (S.run.isRunning) {
          batchEl.value = String(S.settings.batch || 50);
          addLog("Stop first to change batch size.");
          return;
        }
        S.settings.batch = clamp(isFinite(n) ? n : 50, 1, 500);
        batchEl.value = String(S.settings.batch);
        addLog("Batch size set to " + S.settings.batch + ".");
        saveDebounce(true);
        ui.renderAll();
      });

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
          addLog("Stop first to change project filter.");
          return;
        }
        if (!singleProjCheck.checked) {
          S.settings.filterGizmoId = null;
          projSelect.style.display = "none";
          saveDebounce(true);
          addLog("Project filter cleared. Will export all conversations.");
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
          addLog("Stop first to change project filter.");
          return;
        }
        S.settings.filterGizmoId = projSelect.value || null;
        saveDebounce(true);
        if (projSelect.value) {
          const name =
            projSelect.options[projSelect.selectedIndex].textContent;
          addLog("Filter set to project: " + name);
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
      const el =
        ui.container &&
        (ui.container.querySelector("#cvz-bar") as HTMLElement | null);
      if (el)
        el.style.width = clamp(pct || 0, 0, 100).toFixed(1) + "%";
    },

    renderLogs(): void {
      const el =
        ui.container &&
        (ui.container.querySelector("#cvz-log") as HTMLTextAreaElement | null);
      if (!el) return;
      el.value = (S.logs || []).slice(-200).join("\n");
      el.scrollTop = el.scrollHeight;
    },

    renderProjects(): void {
      _populateProjectSelect();
    },

    renderAll(): void {
      if (!ui.container) return;
      const exported = Object.keys(S.progress.exported || {}).length;
      const pending = (S.progress.pending || []).length;
      const dead = (S.progress.dead || []).length;
      const scanning = !!(_exporter && _exporter.scanPromise);

      ui.container.querySelector("#cvz-exported")!.textContent =
        String(exported);
      ui.container.querySelector("#cvz-pending")!.textContent = scanning
        ? pending + "\u2026"
        : String(pending);
      ui.container.querySelector("#cvz-dead")!.textContent = String(dead);

      const batchEl = ui.container.querySelector(
        "#cvz-batch",
      ) as HTMLInputElement | null;
      if (batchEl) batchEl.disabled = !!S.run.isRunning;

      const projectCount =
        (S.projects || []).length || S.scan.totalProjects || 0;
      ui.container.querySelector("#cvz-projects")!.textContent =
        String(projectCount);

      const kfExp = (S.progress.kfExported || []).length;
      const kfPend = (S.progress.kfPending || []).length;
      const kfTotal =
        kfExp + kfPend + (S.progress.kfDead || []).length;
      ui.container.querySelector("#cvz-kf-count")!.textContent =
        kfExp + "/" + kfTotal;

      const singleCheck = ui.container.querySelector(
        "#cvz-single-proj",
      ) as HTMLInputElement | null;
      if (singleCheck) {
        singleCheck.disabled = !!S.run.isRunning;
        if (singleCheck.checked) _populateProjectSelect();
      }

      ui.renderLogs();
      ui.updateDownloadButton();

      const done = exported;
      const tot = S.scan.total ? S.scan.total : exported + pending;
      const pct = tot ? (done / tot) * 100 : 0;
      ui.setBar(pct);
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
