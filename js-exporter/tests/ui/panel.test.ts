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
  const getAccumulatedSize = vi.fn().mockResolvedValue(0);
  const onDownload = vi.fn().mockResolvedValue(undefined);
  return { S, addLog, net, taskList, saveDebounce, scanProjects, getAccumulatedSize, onDownload };
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
      expect(document.getElementById("cvz-log")).not.toBeNull();
      expect(document.getElementById("cvz-tasks")).not.toBeNull();
      expect(document.getElementById("cvz-max")).not.toBeNull();
      // Per-queue concurrency inputs
      expect(document.getElementById("cvz-conc-chat")).not.toBeNull();
      expect(document.getElementById("cvz-conc-file")).not.toBeNull();
      expect(document.getElementById("cvz-conc-kf")).not.toBeNull();
      // Per-queue stats rows
      expect(document.getElementById("cvz-chat-bar")).not.toBeNull();
      expect(document.getElementById("cvz-file-bar")).not.toBeNull();
      expect(document.getElementById("cvz-kf-bar")).not.toBeNull();
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

    it("sets per-queue concurrency inputs from settings", () => {
      const deps = makeDeps();
      deps.S.settings.chatConcurrency = 5;
      deps.S.settings.fileConcurrency = 4;
      deps.S.settings.knowledgeFileConcurrency = 2;
      const ui = createUI(deps);
      ui.inject();
      expect((document.getElementById("cvz-conc-chat") as HTMLInputElement).value).toBe("5");
      expect((document.getElementById("cvz-conc-file") as HTMLInputElement).value).toBe("4");
      expect((document.getElementById("cvz-conc-kf") as HTMLInputElement).value).toBe("2");
    });

    it("does not have old batch input", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      expect(document.getElementById("cvz-batch")).toBeNull();
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

  describe("per-queue progress bars", () => {
    it("chat bar reflects exported/total percentage", () => {
      const deps = makeDeps();
      deps.S.progress.exported = { a: 1, b: 2, c: 3 };
      deps.S.scan.total = 12;
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      const el = document.getElementById("cvz-chat-bar")!;
      expect(parseFloat(el.style.width)).toBe(25);
    });

    it("knowledge bar reflects exported/(exported+inFlight+dead) percentage", () => {
      const deps = makeDeps();
      deps.S.progress.knowledgeFilesExported = [
        { projectId: "p1", projectName: "P1", fileId: "f1", fileName: "a.txt", fileType: "text", fileSize: 10 },
        { projectId: "p1", projectName: "P1", fileId: "f2", fileName: "b.txt", fileType: "text", fileSize: 10 },
      ];
      deps.S.progress.knowledgeFilesDead = [];
      const ui = createUI(deps) as any;
      ui.inject();
      ui.setExporter({
        scanPromise: null,
        start: vi.fn(),
        stop: vi.fn(),
        rescan: vi.fn(),
        chatQueue: { setConcurrency: vi.fn(), stats: { pending: 0, active: 0, done: 0, dead: 0 } },
        attachmentQueue: { setConcurrency: vi.fn(), stats: { pending: 0, active: 0, done: 0, dead: 0 } },
        knowledgeQueue: { setConcurrency: vi.fn(), stats: { pending: 2, active: 0, done: 2, dead: 0 } },
      });
      ui.renderAll();
      const el = document.getElementById("cvz-kf-bar")!;
      // 2 exported / (2 exported + 2 in-flight) = 50%
      expect(parseFloat(el.style.width)).toBe(50);
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
    it("reflects correct chat exported/total and dead counts from state", () => {
      const deps = makeDeps();
      deps.S.progress.exported = { a: 1, b: 2, c: 3 };
      deps.S.scan.total = 5;
      deps.S.progress.dead = [
        { id: "f", title: "f", update_time: 0, gizmo_id: null, lastError: "err" },
      ];
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      // Chat row: 3 exported out of scan total 5
      expect(document.getElementById("cvz-chat-count")!.textContent).toContain("3/5");
      expect(document.getElementById("cvz-chat-dead")!.textContent).toBe("1");
    });

    it("chat counter falls back to exported + queue in-flight + dead when scan.total is 0", () => {
      const deps = makeDeps();
      deps.S.progress.exported = { a: 1, b: 2 };
      deps.S.scan.total = 0;
      deps.S.progress.dead = [
        { id: "c", title: "c", update_time: 0, gizmo_id: null, lastError: "err" },
      ];
      const ui = createUI(deps) as any;
      ui.inject();
      ui.setExporter({
        scanPromise: null,
        start: vi.fn(),
        stop: vi.fn(),
        rescan: vi.fn(),
        chatQueue: { setConcurrency: vi.fn(), stats: { pending: 3, active: 1, done: 2, dead: 1 } },
        attachmentQueue: { setConcurrency: vi.fn(), stats: { pending: 0, active: 0, done: 0, dead: 0 } },
        knowledgeQueue: { setConcurrency: vi.fn(), stats: { pending: 0, active: 0, done: 0, dead: 0 } },
      });
      ui.renderAll();
      // fallback: exported(2) + inFlight(3+1) + dead(1) = 7
      expect(document.getElementById("cvz-chat-count")!.textContent).toBe("2/7");
    });

    it("computes chat progress bar from exported vs total", () => {
      const deps = makeDeps();
      deps.S.progress.exported = { a: 1, b: 2 };
      deps.S.scan.total = 10;
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      expect(parseFloat(document.getElementById("cvz-chat-bar")!.style.width)).toBe(20);
    });

    it("shows per-queue stats with correct counts", () => {
      const deps = makeDeps();
      deps.S.progress.exported = { a: 1, b: 2, c: 3 };
      deps.S.scan.total = 10;
      deps.S.progress.fileDoneCount = 12;
      deps.S.progress.fileDead = [
        { id: "x", name: null, conversationId: "c1", conversationTitle: "C1", lastError: "err" },
      ];
      deps.S.progress.knowledgeFilesExported = [
        { projectId: "p1", projectName: "P1", fileId: "f1", fileName: "a.txt", fileType: "text", fileSize: 10 },
      ];
      deps.S.progress.knowledgeFilesDead = [];
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      // Chat row: 3/10 (from scan.total)
      expect(document.getElementById("cvz-chat-count")!.textContent).toContain("3");
      // File row: no exporter set, so in-flight = 0 → total = 12 + 0 + 1 = 13
      expect(document.getElementById("cvz-file-count")!.textContent).toBe("12/13");
      expect(document.getElementById("cvz-file-dead")!.textContent).toBe("1");
      // KF row: no exporter set, so in-flight = 0 → total = 1 + 0 + 0 = 1
      expect(document.getElementById("cvz-kf-count")!.textContent).toContain("1");
    });

    it("shows knowledge file counts from queue stats", () => {
      const deps = makeDeps();
      deps.S.progress.knowledgeFilesExported = [
        { projectId: "p1", projectName: "P1", fileId: "f1", fileName: "a.txt", fileType: "text", fileSize: 10 },
        { projectId: "p1", projectName: "P1", fileId: "f2", fileName: "b.txt", fileType: "text", fileSize: 10 },
      ];
      deps.S.progress.knowledgeFilesDead = [
        { projectId: "p1", projectName: "P1", fileId: "f4", fileName: "d.txt", fileType: "text", fileSize: 30, lastError: "err" },
      ];
      const ui = createUI(deps) as any;
      ui.inject();
      ui.setExporter({
        scanPromise: null,
        start: vi.fn(),
        stop: vi.fn(),
        rescan: vi.fn(),
        chatQueue: { setConcurrency: vi.fn(), stats: { pending: 0, active: 0, done: 0, dead: 0 } },
        attachmentQueue: { setConcurrency: vi.fn(), stats: { pending: 0, active: 0, done: 0, dead: 0 } },
        knowledgeQueue: { setConcurrency: vi.fn(), stats: { pending: 1, active: 0, done: 2, dead: 1 } },
      });
      ui.renderAll();
      // 2 exported out of 2 + 1 in-flight + 1 dead = 4
      expect(document.getElementById("cvz-kf-count")!.textContent).toBe("2/4");
      expect(document.getElementById("cvz-kf-dead")!.textContent).toBe("1");
    });

    it("shows file download counts from queue stats", () => {
      const deps = makeDeps();
      deps.S.progress.fileDoneCount = 42;
      deps.S.progress.fileDead = [];
      const ui = createUI(deps) as any;
      ui.inject();
      ui.setExporter({
        scanPromise: null,
        start: vi.fn(),
        stop: vi.fn(),
        rescan: vi.fn(),
        chatQueue: { setConcurrency: vi.fn(), stats: { pending: 0, active: 0, done: 0, dead: 0 } },
        attachmentQueue: { setConcurrency: vi.fn(), stats: { pending: 3, active: 1, done: 42, dead: 0 } },
        knowledgeQueue: { setConcurrency: vi.fn(), stats: { pending: 0, active: 0, done: 0, dead: 0 } },
      });
      ui.renderAll();
      // 42 done out of 42 + 4 in-flight = 46
      expect(document.getElementById("cvz-file-count")!.textContent).toBe("42/46");
      expect(document.getElementById("cvz-file-dead")!.textContent).toBe("0");
    });

    it("calls TaskList.render()", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      expect(deps.taskList.render).toHaveBeenCalled();
    });

    it("calls updateDownloadButton to refresh accumulated size", async () => {
      const deps = makeDeps();
      deps.getAccumulatedSize.mockResolvedValue(5 * 1024 * 1024);
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      // Wait for the async updateDownloadButton to complete
      await vi.waitFor(() => {
        expect(deps.getAccumulatedSize).toHaveBeenCalled();
      });
      const btn = document.getElementById("cvz-download")!;
      expect(btn.style.display).not.toBe("none");
      expect(btn.textContent).toContain("5.0 MB");
    });
  });

  describe("accumulated counter", () => {
    it("shows Accumulated label in the stats box", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      const statsBox = document.querySelector('[data-testid="cvz-stats"]')!;
      expect(statsBox.textContent).toContain("Accumulated:");
      expect(document.getElementById("cvz-accumulated")).not.toBeNull();
    });

    it("shows 0 B initially", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      const el = document.getElementById("cvz-accumulated")!;
      expect(el.textContent).toBe("0 B");
    });

    it("updates to formatted size after renderAll", async () => {
      const deps = makeDeps();
      deps.getAccumulatedSize.mockResolvedValue(42.7 * 1024 * 1024);
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      await vi.waitFor(() => {
        const el = document.getElementById("cvz-accumulated")!;
        expect(el.textContent).toBe("42.7 MB");
      });
    });

    it("updates to GB for large sizes", async () => {
      const deps = makeDeps();
      deps.getAccumulatedSize.mockResolvedValue(1.2 * 1024 * 1024 * 1024);
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      await vi.waitFor(() => {
        const el = document.getElementById("cvz-accumulated")!;
        expect(el.textContent).toBe("1.2 GB");
      });
    });

    it("resets to 0 B when accumulated size returns 0", async () => {
      const deps = makeDeps();
      deps.getAccumulatedSize.mockResolvedValue(5 * 1024 * 1024);
      const ui = createUI(deps);
      ui.inject();
      ui.renderAll();
      await vi.waitFor(() => {
        expect(document.getElementById("cvz-accumulated")!.textContent).toBe("5.0 MB");
      });
      deps.getAccumulatedSize.mockResolvedValue(0);
      ui.renderAll();
      await vi.waitFor(() => {
        expect(document.getElementById("cvz-accumulated")!.textContent).toBe("0 B");
      });
    });
  });

  describe("download button", () => {
    it("is hidden when accumulated size is 0", async () => {
      const deps = makeDeps();
      deps.getAccumulatedSize.mockResolvedValue(0);
      const ui = createUI(deps);
      ui.inject();
      await ui.updateDownloadButton();
      const btn = document.getElementById("cvz-download")!;
      expect(btn.style.display).toBe("none");
    });

    it("is visible with formatted size when data is accumulated", async () => {
      const deps = makeDeps();
      deps.getAccumulatedSize.mockResolvedValue(12.3 * 1024 * 1024);
      const ui = createUI(deps);
      ui.inject();
      await ui.updateDownloadButton();
      const btn = document.getElementById("cvz-download")!;
      expect(btn.style.display).not.toBe("none");
      expect(btn.textContent).toContain("Download");
      expect(btn.textContent).toContain("12.3 MB");
    });

    it("calls onDownload when clicked", async () => {
      const deps = makeDeps();
      deps.getAccumulatedSize.mockResolvedValue(5 * 1024 * 1024);
      const ui = createUI(deps);
      ui.inject();
      await ui.updateDownloadButton();
      const btn = document.getElementById("cvz-download")!;
      btn.click();
      expect(deps.onDownload).toHaveBeenCalled();
    });

    it("is enabled even when export is running (download what's ready)", async () => {
      const deps = makeDeps();
      deps.getAccumulatedSize.mockResolvedValue(5 * 1024 * 1024);
      deps.S.run.isRunning = true;
      const ui = createUI(deps);
      ui.inject();
      await ui.updateDownloadButton();
      const btn = document.getElementById("cvz-download") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it("is enabled when export is not running", async () => {
      const deps = makeDeps();
      deps.getAccumulatedSize.mockResolvedValue(5 * 1024 * 1024);
      deps.S.run.isRunning = false;
      const ui = createUI(deps);
      ui.inject();
      await ui.updateDownloadButton();
      const btn = document.getElementById("cvz-download") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  describe("per-queue concurrency inputs", () => {
    it("updates chatConcurrency setting when chat concurrency input changes", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      const input = document.getElementById("cvz-conc-chat") as HTMLInputElement;
      input.value = "5";
      input.dispatchEvent(new Event("change"));
      expect(deps.S.settings.chatConcurrency).toBe(5);
      expect(deps.saveDebounce).toHaveBeenCalledWith(true);
    });

    it("updates fileConcurrency setting when file concurrency input changes", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      const input = document.getElementById("cvz-conc-file") as HTMLInputElement;
      input.value = "6";
      input.dispatchEvent(new Event("change"));
      expect(deps.S.settings.fileConcurrency).toBe(6);
      expect(deps.saveDebounce).toHaveBeenCalledWith(true);
    });

    it("updates knowledgeFileConcurrency setting when knowledge concurrency input changes", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      const input = document.getElementById("cvz-conc-kf") as HTMLInputElement;
      input.value = "4";
      input.dispatchEvent(new Event("change"));
      expect(deps.S.settings.knowledgeFileConcurrency).toBe(4);
      expect(deps.saveDebounce).toHaveBeenCalledWith(true);
    });

    it("calls setConcurrency on the respective queue when running and input changes", () => {
      const deps = makeDeps();
      deps.S.run.isRunning = true;
      const ui = createUI(deps) as any;
      ui.inject();
      const zeroStats = { pending: 0, active: 0, done: 0, dead: 0 };
      const mockQueue = { setConcurrency: vi.fn(), stats: zeroStats };
      ui.setExporter({
        scanPromise: null,
        start: vi.fn(),
        stop: vi.fn(),
        rescan: vi.fn(),
        chatQueue: mockQueue,
        attachmentQueue: { setConcurrency: vi.fn(), stats: zeroStats },
        knowledgeQueue: { setConcurrency: vi.fn(), stats: zeroStats },
      });
      const input = document.getElementById("cvz-conc-chat") as HTMLInputElement;
      input.value = "7";
      input.dispatchEvent(new Event("change"));
      expect(mockQueue.setConcurrency).toHaveBeenCalledWith(7);
    });

    it("clamps concurrency values to 1-10 range", () => {
      const deps = makeDeps();
      const ui = createUI(deps);
      ui.inject();
      const input = document.getElementById("cvz-conc-chat") as HTMLInputElement;
      input.value = "99";
      input.dispatchEvent(new Event("change"));
      expect(deps.S.settings.chatConcurrency).toBe(10);
      expect(input.value).toBe("10");

      input.value = "0";
      input.dispatchEvent(new Event("change"));
      expect(deps.S.settings.chatConcurrency).toBe(1);
      expect(input.value).toBe("1");
    });
  });

  describe("reset button", () => {
    it("shows a confirmation dialog mentioning accumulated export data", () => {
      const deps = makeDeps();
      const onReset = vi.fn().mockResolvedValue(undefined);
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      const ui = createUI({ ...deps, onReset });
      ui.inject();
      const btn = document.getElementById("cvz-reset")!;
      btn.click();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      const msg = confirmSpy.mock.calls[0][0] as string;
      expect(msg).toMatch(/accumulated export data/i);
      confirmSpy.mockRestore();
    });

    it("does not call onReset when user cancels the dialog", () => {
      const deps = makeDeps();
      const onReset = vi.fn().mockResolvedValue(undefined);
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      const ui = createUI({ ...deps, onReset });
      ui.inject();
      const btn = document.getElementById("cvz-reset")!;
      btn.click();
      expect(onReset).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it("calls onReset when user confirms the dialog", async () => {
      const deps = makeDeps();
      const onReset = vi.fn().mockResolvedValue(undefined);
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      const ui = createUI({ ...deps, onReset });
      ui.inject();
      const btn = document.getElementById("cvz-reset")!;
      btn.click();
      await vi.waitFor(() => {
        expect(onReset).toHaveBeenCalledTimes(1);
      });
      confirmSpy.mockRestore();
    });
  });
});
