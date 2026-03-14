// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultState } from "../../src/state/defaults";
import type { ExportState } from "../../src/types";
import { createUI } from "../../src/ui/panel";
import type { UI } from "../../src/ui/panel";
import type { Net } from "../../src/net/net";
import type { TaskList } from "../../src/ui/task-list";

const makeDeps = (stateOverrides?: Partial<ExportState>) => {
  const S: ExportState = { ...defaultState(), ...stateOverrides };
  const addLog = vi.fn();
  const net: Net = {
    token: "",
    _tokenPromise: null,
    _consecutive429: 0,
    getToken: vi.fn().mockResolvedValue("tok"),
    _fetch: vi.fn(),
    fetchJson: vi.fn(),
    fetchBlob: vi.fn(),
    download: vi.fn(),
  };
  const taskList: TaskList = {
    add: vi.fn(),
    update: vi.fn(),
    getVisible: vi.fn().mockReturnValue([]),
    render: vi.fn(),
  };
  const saveDebounce = vi.fn();
  const scanProjects = vi.fn().mockResolvedValue([]);
  return { S, addLog, net, taskList, saveDebounce, scanProjects };
};

describe("createUI", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  describe("inject()", () => {
    it("creates the panel with expected DOM structure", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      const panel = document.getElementById("cvz-resume-ui");
      expect(panel).not.toBeNull();
      expect(document.getElementById("cvz-status")).not.toBeNull();
      expect(document.getElementById("cvz-bar")).not.toBeNull();
      expect(document.getElementById("cvz-log")).not.toBeNull();
      expect(document.getElementById("cvz-tasks")).not.toBeNull();
      expect(document.getElementById("cvz-batch")).not.toBeNull();
      expect(document.getElementById("cvz-max")).not.toBeNull();
    });

    it("does not inject duplicate panels", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      ui.inject();
      const panels = document.querySelectorAll("#cvz-resume-ui");
      expect(panels.length).toBe(1);
    });

    it("re-shows an existing hidden panel", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      const panel = document.getElementById("cvz-resume-ui")!;
      panel.style.display = "none";
      ui.inject();
      expect(panel.style.display).toBe("block");
    });

    it("adds spinner keyframe style to head", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      const styleEl = document.getElementById("cvz-spin-style");
      expect(styleEl).not.toBeNull();
      expect(styleEl!.textContent).toContain("cvz-spin");
    });

    it("sets batch input to S.settings.batch", () => {
      const deps = makeDeps();
      deps.S.settings.batch = 75;
      const ui = createUI(deps);
      ui.inject();
      const batchEl = document.getElementById("cvz-batch") as HTMLInputElement;
      expect(batchEl.value).toBe("75");
    });
  });

  describe("setStatus(msg)", () => {
    it("updates #cvz-status text content", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      ui.setStatus("Exporting...");
      const el = document.getElementById("cvz-status")!;
      expect(el.textContent).toBe("Exporting...");
    });
  });

  describe("setBar(pct)", () => {
    it("updates #cvz-bar width style", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      ui.setBar(42.567);
      const el = document.getElementById("cvz-bar")!;
      expect(el.style.width).toBe("42.6%");
    });

    it("clamps to 0-100", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      ui.setBar(-10);
      expect(parseFloat(document.getElementById("cvz-bar")!.style.width)).toBe(0);
      ui.setBar(150);
      expect(parseFloat(document.getElementById("cvz-bar")!.style.width)).toBe(100);
    });
  });

  describe("renderLogs()", () => {
    it("populates #cvz-log from S.logs array", () => {
      const deps = makeDeps();
      deps.S.logs = ["line 1", "line 2", "line 3"];
      const ui = createUI(deps);
      ui.inject();
      ui.renderLogs();
      const el = document.getElementById("cvz-log") as HTMLTextAreaElement;
      expect(el.value).toBe("line 1\nline 2\nline 3");
    });

    it("limits to last 200 logs", () => {
      const deps = makeDeps();
      deps.S.logs = Array.from({ length: 250 }, (_, i) => "log " + i);
      const ui = createUI(deps);
      ui.inject();
      ui.renderLogs();
      const el = document.getElementById("cvz-log") as HTMLTextAreaElement;
      const lines = el.value.split("\n");
      expect(lines.length).toBe(200);
      expect(lines[0]).toBe("log 50");
      expect(lines[199]).toBe("log 249");
    });
  });

  describe("renderAll()", () => {
    it("reflects correct exported/pending/dead counts from state", () => {
      const deps = makeDeps();
      deps.S.progress.exported = { a: 1, b: 2, c: 3 };
      deps.S.progress.pending = [
        { id: "d", title: "d", update_time: 0, gizmo_id: null },
        { id: "e", title: "e", update_time: 0, gizmo_id: null },
      ];
      deps.S.progress.dead = [
        { id: "f", title: "f", update_time: 0, gizmo_id: null, lastError: "err" },
      ];
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      expect(document.getElementById("cvz-exported")!.textContent).toBe("3");
      expect(document.getElementById("cvz-pending")!.textContent).toBe("2");
      expect(document.getElementById("cvz-dead")!.textContent).toBe("1");
    });

    it("computes progress bar from exported vs total", () => {
      const deps = makeDeps();
      deps.S.progress.exported = { a: 1, b: 2 };
      deps.S.scan.total = 10;
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      expect(parseFloat(document.getElementById("cvz-bar")!.style.width)).toBe(20);
    });

    it("disables batch input when running", () => {
      const deps = makeDeps();
      deps.S.run.isRunning = true;
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      const batchEl = document.getElementById("cvz-batch") as HTMLInputElement;
      expect(batchEl.disabled).toBe(true);
    });

    it("shows project count", () => {
      const deps = makeDeps();
      deps.S.projects = [
        {
          gizmoId: "g1",
          name: "Project 1",
          emoji: "",
          theme: "",
          instructions: "",
          memoryEnabled: false,
          memoryScope: "",
          files: [],
          raw: {},
        },
      ];
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      expect(document.getElementById("cvz-projects")!.textContent).toBe("1");
    });

    it("shows knowledge file counts", () => {
      const deps = makeDeps();
      deps.S.progress.kfExported = [
        { projectId: "p1", projectName: "P1", fileId: "f1", fileName: "a.txt", fileType: "text", fileSize: 10 },
      ];
      deps.S.progress.kfPending = [
        { projectId: "p1", projectName: "P1", fileId: "f2", fileName: "b.txt", fileType: "text", fileSize: 20 },
      ];
      deps.S.progress.kfDead = [];
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      expect(document.getElementById("cvz-kf-count")!.textContent).toBe("1/2");
    });

    it("calls TaskList.render()", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      expect(deps.taskList.render).toHaveBeenCalled();
    });
  });
});
