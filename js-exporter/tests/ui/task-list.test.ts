// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/format", () => ({
  now: vi.fn(() => 1000),
}));

import { createTaskList } from "../../src/ui/task-list";
import { now } from "../../src/utils/format";

const mockedNow = vi.mocked(now);

describe("createTaskList", () => {
  beforeEach(() => {
    mockedNow.mockReturnValue(1000);
    document.body.innerHTML = "";
  });

  describe("add", () => {
    it("creates a task with correct initial status", () => {
      const tl = createTaskList();
      tl.add({ id: "t1", label: "Test task" });
      const visible = tl.getVisible();
      expect(visible).toHaveLength(1);
      expect(visible[0]).toMatchObject({
        id: "t1",
        type: "conversation",
        label: "Test task",
        projectName: null,
        status: "queued",
        detail: null,
        error: null,
        startedAt: null,
        completedAt: null,
      });
    });

    it("uses provided values for optional fields", () => {
      const tl = createTaskList();
      tl.add({
        id: "t2",
        label: "Active task",
        type: "knowledge",
        projectName: "MyProject",
        status: "active",
        detail: "downloading",
        error: null,
      });
      const visible = tl.getVisible();
      expect(visible[0]).toMatchObject({
        id: "t2",
        type: "knowledge",
        label: "Active task",
        projectName: "MyProject",
        status: "active",
        detail: "downloading",
        startedAt: 1000,
        completedAt: null,
      });
    });

    it("sets completedAt for done status on add", () => {
      const tl = createTaskList();
      tl.add({ id: "t3", label: "Done task", status: "done" });
      const visible = tl.getVisible();
      expect(visible[0].completedAt).toBe(1000);
    });

    it("sets completedAt for failed status on add", () => {
      const tl = createTaskList();
      tl.add({ id: "t4", label: "Failed task", status: "failed" });
      const visible = tl.getVisible();
      expect(visible[0].completedAt).toBe(1000);
    });

    it("marks task list as dirty", () => {
      const tl = createTaskList();
      // render once to clear dirty flag
      document.body.innerHTML = '<div id="cvz-tasks"></div>';
      tl.add({ id: "t1", label: "A" });
      tl.render();
      // After render, dirty is cleared. Add a new task to mark dirty again.
      tl.add({ id: "t2", label: "B" });
      // Render should update (because dirty is true)
      tl.render();
      const el = document.getElementById("cvz-tasks")!;
      expect(el.innerHTML).toContain("B");
    });
  });

  describe("update", () => {
    it("changes status and optional fields", () => {
      const tl = createTaskList();
      tl.add({ id: "t1", label: "Test" });
      tl.update("t1", { status: "active", detail: "working" });
      const visible = tl.getVisible();
      expect(visible[0].status).toBe("active");
      expect(visible[0].detail).toBe("working");
    });

    it("sets startedAt when transitioning to active", () => {
      mockedNow.mockReturnValue(2000);
      const tl = createTaskList();
      tl.add({ id: "t1", label: "Test" });
      mockedNow.mockReturnValue(3000);
      tl.update("t1", { status: "active" });
      expect(tl.getVisible()[0].startedAt).toBe(3000);
    });

    it("sets completedAt when transitioning to done", () => {
      const tl = createTaskList();
      tl.add({ id: "t1", label: "Test", status: "active" });
      mockedNow.mockReturnValue(5000);
      tl.update("t1", { status: "done" });
      expect(tl.getVisible()[0].completedAt).toBe(5000);
    });

    it("sets completedAt when transitioning to failed", () => {
      const tl = createTaskList();
      tl.add({ id: "t1", label: "Test", status: "active" });
      mockedNow.mockReturnValue(5000);
      tl.update("t1", { status: "failed", error: "timeout" });
      const t = tl.getVisible()[0];
      expect(t.completedAt).toBe(5000);
      expect(t.error).toBe("timeout");
    });

    it("does not overwrite existing startedAt", () => {
      const tl = createTaskList();
      mockedNow.mockReturnValue(1000);
      tl.add({ id: "t1", label: "Test", status: "active" });
      mockedNow.mockReturnValue(2000);
      tl.update("t1", { status: "active" });
      expect(tl.getVisible()[0].startedAt).toBe(1000);
    });

    it("does not overwrite existing completedAt", () => {
      const tl = createTaskList();
      tl.add({ id: "t1", label: "Test", status: "active" });
      mockedNow.mockReturnValue(3000);
      tl.update("t1", { status: "done" });
      mockedNow.mockReturnValue(4000);
      tl.update("t1", { status: "failed" });
      expect(tl.getVisible()[0].completedAt).toBe(3000);
    });

    it("is a no-op for unknown id", () => {
      const tl = createTaskList();
      tl.add({ id: "t1", label: "Test" });
      tl.update("unknown", { status: "done" });
      expect(tl.getVisible()[0].status).toBe("queued");
    });

    it("marks task list as dirty", () => {
      const tl = createTaskList();
      document.body.innerHTML = '<div id="cvz-tasks"></div>';
      tl.add({ id: "t1", label: "A" });
      tl.render(); // clears dirty
      tl.update("t1", { status: "done" });
      tl.render(); // should update since dirty was set
      const el = document.getElementById("cvz-tasks")!;
      expect(el.innerHTML).toContain("cvz-task-done");
    });
  });

  describe("getVisible windowing", () => {
    it("returns all tasks when counts are below limits", () => {
      const tl = createTaskList();
      tl.add({ id: "f1", label: "failed", status: "failed" });
      tl.add({ id: "a1", label: "active", status: "active" });
      tl.add({ id: "d1", label: "done", status: "done" });
      tl.add({ id: "q1", label: "queued" });
      const visible = tl.getVisible();
      expect(visible).toHaveLength(4);
    });

    it("limits done tasks to last 30", () => {
      const tl = createTaskList();
      for (let i = 0; i < 50; i++) {
        tl.add({ id: `d${i}`, label: `done-${i}`, status: "done" });
      }
      const visible = tl.getVisible();
      expect(visible).toHaveLength(30);
      // Should be the last 30 (d20..d49)
      expect(visible[0].id).toBe("d20");
      expect(visible[29].id).toBe("d49");
    });

    it("limits queued tasks to first 10", () => {
      const tl = createTaskList();
      for (let i = 0; i < 20; i++) {
        tl.add({ id: `q${i}`, label: `queued-${i}` });
      }
      const visible = tl.getVisible();
      expect(visible).toHaveLength(10);
      // Should be the first 10 (q0..q9)
      expect(visible[0].id).toBe("q0");
      expect(visible[9].id).toBe("q9");
    });

    it("shows all active and all failed tasks", () => {
      const tl = createTaskList();
      for (let i = 0; i < 15; i++) {
        tl.add({ id: `a${i}`, label: `active-${i}`, status: "active" });
      }
      for (let i = 0; i < 12; i++) {
        tl.add({ id: `f${i}`, label: `failed-${i}`, status: "failed" });
      }
      const visible = tl.getVisible();
      const activeCount = visible.filter((t) => t.status === "active").length;
      const failedCount = visible.filter((t) => t.status === "failed").length;
      expect(activeCount).toBe(15);
      expect(failedCount).toBe(12);
    });

    it("orders: failed, done, active, queued", () => {
      const tl = createTaskList();
      tl.add({ id: "q1", label: "queued" });
      tl.add({ id: "a1", label: "active", status: "active" });
      tl.add({ id: "d1", label: "done", status: "done" });
      tl.add({ id: "f1", label: "failed", status: "failed" });
      const visible = tl.getVisible();
      expect(visible.map((t) => t.status)).toEqual([
        "failed",
        "done",
        "active",
        "queued",
      ]);
    });
  });

  describe("render", () => {
    it("does nothing when not dirty", () => {
      const tl = createTaskList();
      document.body.innerHTML = '<div id="cvz-tasks">original</div>';
      // Not dirty (no add/update calls), so render is a no-op
      tl.render();
      expect(document.getElementById("cvz-tasks")!.innerHTML).toBe("original");
    });

    it("does nothing when #cvz-tasks element is missing", () => {
      const tl = createTaskList();
      tl.add({ id: "t1", label: "Test" });
      // No #cvz-tasks element in DOM
      expect(() => tl.render()).not.toThrow();
    });

    it("renders queued tasks with dot prefix and opacity", () => {
      const tl = createTaskList();
      document.body.innerHTML = '<div id="cvz-tasks"></div>';
      tl.add({ id: "t1", label: "Queued task" });
      tl.render();
      const el = document.getElementById("cvz-tasks")!;
      expect(el.innerHTML).toContain("cvz-task-queued");
      expect(el.innerHTML).toContain("\u00b7 ");
      expect(el.innerHTML).toContain("opacity:0.5;");
      expect(el.innerHTML).toContain("Queued task");
    });

    it("renders active tasks with spinner and green color", () => {
      const tl = createTaskList();
      document.body.innerHTML = '<div id="cvz-tasks"></div>';
      tl.add({ id: "t1", label: "Active task", status: "active" });
      tl.render();
      const el = document.getElementById("cvz-tasks")!;
      expect(el.innerHTML).toContain("cvz-task-active");
      expect(el.innerHTML).toContain("cvz-spin");
      expect(el.innerHTML).toContain("\u27f3");
      expect(el.innerHTML).toContain("color:#10a37f;");
      expect(el.innerHTML).toContain("Active task");
    });

    it("renders done tasks with checkmark and opacity", () => {
      const tl = createTaskList();
      document.body.innerHTML = '<div id="cvz-tasks"></div>';
      tl.add({ id: "t1", label: "Done task", status: "done" });
      tl.render();
      const el = document.getElementById("cvz-tasks")!;
      expect(el.innerHTML).toContain("cvz-task-done");
      expect(el.innerHTML).toContain("\u2713 ");
      expect(el.innerHTML).toContain("opacity:0.6;");
    });

    it("renders failed tasks with cross mark and red color", () => {
      const tl = createTaskList();
      document.body.innerHTML = '<div id="cvz-tasks"></div>';
      tl.add({
        id: "t1",
        label: "Failed task",
        status: "failed",
        error: "timeout",
      });
      tl.render();
      const el = document.getElementById("cvz-tasks")!;
      expect(el.innerHTML).toContain("cvz-task-failed");
      expect(el.innerHTML).toContain("\u2717 ");
      expect(el.innerHTML).toContain("color:#ef4444;");
      expect(el.innerHTML).toContain("(timeout)");
    });

    it("renders project name prefix", () => {
      const tl = createTaskList();
      document.body.innerHTML = '<div id="cvz-tasks"></div>';
      tl.add({
        id: "t1",
        label: "Task",
        status: "active",
        projectName: "ProjectX",
      });
      tl.render();
      const el = document.getElementById("cvz-tasks")!;
      expect(el.innerHTML).toContain("[ProjectX]");
    });

    it("renders active task detail as indented sub-line", () => {
      const tl = createTaskList();
      document.body.innerHTML = '<div id="cvz-tasks"></div>';
      tl.add({
        id: "t1",
        label: "Working",
        status: "active",
        detail: "file 3/10",
      });
      tl.render();
      const el = document.getElementById("cvz-tasks")!;
      expect(el.innerHTML).toContain("cvz-task-detail");
      expect(el.innerHTML).toContain("\u21b3 file 3/10");
    });

    it("does not render detail for non-active tasks", () => {
      const tl = createTaskList();
      document.body.innerHTML = '<div id="cvz-tasks"></div>';
      tl.add({ id: "t1", label: "Done", status: "done", detail: "finished" });
      tl.render();
      const el = document.getElementById("cvz-tasks")!;
      expect(el.innerHTML).not.toContain("cvz-task-detail");
    });

    it("clears dirty flag after render", () => {
      const tl = createTaskList();
      document.body.innerHTML = '<div id="cvz-tasks"></div>';
      tl.add({ id: "t1", label: "A" });
      tl.render();
      // Change the HTML externally
      document.getElementById("cvz-tasks")!.innerHTML = "custom";
      // Render again — should not update because dirty is false
      tl.render();
      expect(document.getElementById("cvz-tasks")!.innerHTML).toBe("custom");
    });
  });
});
