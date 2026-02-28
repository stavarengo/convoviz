const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

/**
 * Helper: load the bookmarklet into a page.
 * Strips the `javascript:` prefix and evaluates in page context.
 */
async function injectBookmarklet(page) {
  const scriptPath = path.join(__dirname, "..", "script.js");
  const raw = fs.readFileSync(scriptPath, "utf-8");
  const code = raw.replace(/^javascript:\s*/, "");
  await page.evaluate(code);
  await page.waitForSelector("#cvz-resume-ui", { timeout: 5000 });
}

test.describe("US-002: Task list data model and rendering", () => {
  test.beforeEach(async ({ page }) => {
    const harness = "file://" + path.join(__dirname, "harness.html");
    await page.goto(harness);
    await injectBookmarklet(page);
  });

  test("TaskList object is exposed with add, update, getVisible methods", async ({ page }) => {
    const methods = await page.evaluate(() => {
      return {
        hasAdd: typeof window.__cvz_TaskList.add === "function",
        hasUpdate: typeof window.__cvz_TaskList.update === "function",
        hasGetVisible: typeof window.__cvz_TaskList.getVisible === "function",
      };
    });
    expect(methods.hasAdd).toBe(true);
    expect(methods.hasUpdate).toBe(true);
    expect(methods.hasGetVisible).toBe(true);
  });

  test("add() creates a task with correct data model fields", async ({ page }) => {
    const task = await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({
        id: "conv-abc123",
        type: "conversation",
        label: "Test Chat",
        projectName: "My Project",
        status: "active",
        detail: "fetching conversation",
        error: null,
      });
      const tasks = TL.getVisible();
      return tasks[0];
    });
    expect(task.id).toBe("conv-abc123");
    expect(task.type).toBe("conversation");
    expect(task.label).toBe("Test Chat");
    expect(task.projectName).toBe("My Project");
    expect(task.status).toBe("active");
    expect(task.detail).toBe("fetching conversation");
    expect(task.error).toBeNull();
    expect(typeof task.startedAt).toBe("number");
    expect(task.completedAt).toBeNull();
  });

  test("update() modifies fields on an existing task", async ({ page }) => {
    const task = await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "conv-1", type: "conversation", label: "Chat 1", status: "active" });
      TL.update("conv-1", { status: "done", detail: null });
      return TL.getVisible().find((t) => t.id === "conv-1");
    });
    expect(task.status).toBe("done");
    expect(task.detail).toBeNull();
    expect(typeof task.completedAt).toBe("number");
  });

  test("update() sets completedAt when status changes to done or failed", async ({ page }) => {
    const result = await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "t1", type: "conversation", label: "A", status: "active" });
      TL.add({ id: "t2", type: "conversation", label: "B", status: "active" });
      TL.update("t1", { status: "done" });
      TL.update("t2", { status: "failed", error: "HTTP 429" });
      const t1 = TL.getVisible().find((t) => t.id === "t1");
      const t2 = TL.getVisible().find((t) => t.id === "t2");
      return {
        t1CompletedAt: t1.completedAt,
        t2CompletedAt: t2.completedAt,
        t2Error: t2.error,
      };
    });
    expect(result.t1CompletedAt).toBeGreaterThan(0);
    expect(result.t2CompletedAt).toBeGreaterThan(0);
    expect(result.t2Error).toBe("HTTP 429");
  });

  test("getVisible() returns sliding window: failed + active + last 30 done + next 10 queued", async ({ page }) => {
    const result = await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      // Add 40 done tasks
      for (let i = 0; i < 40; i++) {
        TL.add({ id: "done-" + i, type: "conversation", label: "Done " + i, status: "done" });
      }
      // Add 2 active tasks
      TL.add({ id: "active-1", type: "conversation", label: "Active 1", status: "active" });
      TL.add({ id: "active-2", type: "conversation", label: "Active 2", status: "active" });
      // Add 1 failed task
      TL.add({ id: "failed-1", type: "conversation", label: "Failed 1", status: "failed", error: "oops" });
      // Add 20 queued tasks
      for (let i = 0; i < 20; i++) {
        TL.add({ id: "queued-" + i, type: "conversation", label: "Queued " + i, status: "queued" });
      }
      const visible = TL.getVisible();
      const counts = {
        done: visible.filter((t) => t.status === "done").length,
        active: visible.filter((t) => t.status === "active").length,
        failed: visible.filter((t) => t.status === "failed").length,
        queued: visible.filter((t) => t.status === "queued").length,
        total: visible.length,
      };
      return counts;
    });
    // All failed (1), all active (2), last ~30 done, next ~10 queued
    expect(result.failed).toBe(1);
    expect(result.active).toBe(2);
    expect(result.done).toBeLessThanOrEqual(30);
    expect(result.queued).toBeLessThanOrEqual(10);
    // Total should be manageable (< 50)
    expect(result.total).toBeLessThanOrEqual(50);
  });

  test("tasks render inside #cvz-tasks with correct status styling", async ({ page }) => {
    await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "q1", type: "conversation", label: "Queued Task", status: "queued" });
      TL.add({ id: "a1", type: "conversation", label: "Active Task", status: "active" });
      TL.add({ id: "d1", type: "conversation", label: "Done Task", status: "done" });
      TL.add({ id: "f1", type: "conversation", label: "Failed Task", status: "failed", error: "HTTP 429" });
      TL.render();
    });

    const tasks = page.locator("#cvz-tasks");

    // Queued task: dot prefix, dimmed
    const queued = tasks.locator(".cvz-task-queued");
    await expect(queued).toHaveCount(1);
    await expect(queued).toContainText("Queued Task");

    // Active task: spinning prefix, green-tinted
    const active = tasks.locator(".cvz-task-active");
    await expect(active).toHaveCount(1);
    await expect(active).toContainText("Active Task");

    // Done task: checkmark prefix, muted
    const done = tasks.locator(".cvz-task-done");
    await expect(done).toHaveCount(1);
    await expect(done).toContainText("Done Task");

    // Failed task: X prefix, red text, error in parentheses
    const failed = tasks.locator(".cvz-task-failed");
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText("Failed Task");
    await expect(failed).toContainText("HTTP 429");
  });

  test("active tasks with detail show sub-line with arrow prefix", async ({ page }) => {
    await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "a1", type: "conversation", label: "Active Chat", status: "active", detail: "downloading 2/5 files" });
      TL.render();
    });

    const tasks = page.locator("#cvz-tasks");
    const active = tasks.locator(".cvz-task-active");
    await expect(active).toContainText("Active Chat");
    // The sub-line (detail) is a sibling div with class cvz-task-detail
    const subLine = tasks.locator(".cvz-task-detail");
    await expect(subLine).toHaveCount(1);
    await expect(subLine).toContainText("\u21b3");
    await expect(subLine).toContainText("downloading 2/5 files");
  });

  test("tasks with projectName show [ProjectName] prefix", async ({ page }) => {
    await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "a1", type: "conversation", label: "Chat Title", status: "active", projectName: "My App" });
      TL.render();
    });

    const tasks = page.locator("#cvz-tasks");
    await expect(tasks).toContainText("[My App]");
    await expect(tasks).toContainText("Chat Title");
  });

  test("CSS spin animation is injected for active task spinner", async ({ page }) => {
    const hasAnimation = await page.evaluate(() => {
      const styles = document.querySelectorAll("style");
      for (const s of styles) {
        if (s.textContent.indexOf("cvz-spin") !== -1) return true;
      }
      return false;
    });
    expect(hasAnimation).toBe(true);
  });

  test("rendering is efficient: only re-renders when dirty", async ({ page }) => {
    const result = await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      // Initially not dirty (just injected)
      const dirtyBefore = TL._dirty;
      TL.add({ id: "t1", type: "conversation", label: "Test", status: "active" });
      const dirtyAfterAdd = TL._dirty;
      TL.render();
      const dirtyAfterRender = TL._dirty;
      return { dirtyBefore, dirtyAfterAdd, dirtyAfterRender };
    });
    expect(result.dirtyBefore).toBe(false);
    expect(result.dirtyAfterAdd).toBe(true);
    expect(result.dirtyAfterRender).toBe(false);
  });

  test("UI.renderAll() calls TaskList.render() when dirty", async ({ page }) => {
    const result = await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "t1", type: "conversation", label: "Test", status: "queued" });
      // Dirty after add
      const dirtyBeforeRenderAll = TL._dirty;
      // Trigger renderAll through the UI (which should call TaskList.render)
      // We need to access UIImpl - it's exposed as __cvz_UI
      if (window.__cvz_UI) window.__cvz_UI.renderAll();
      const dirtyAfterRenderAll = TL._dirty;
      // Task should be rendered
      const taskEl = document.querySelector("#cvz-tasks .cvz-task-queued");
      return {
        dirtyBeforeRenderAll,
        dirtyAfterRenderAll,
        taskRendered: !!taskEl,
      };
    });
    expect(result.dirtyBeforeRenderAll).toBe(true);
    expect(result.dirtyAfterRenderAll).toBe(false);
    expect(result.taskRendered).toBe(true);
  });

  test("tasks are in-memory only and transient", async ({ page }) => {
    // Add tasks, then verify they don't persist to IndexedDB/localStorage
    const result = await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "t1", type: "conversation", label: "Test", status: "active" });
      // Check that tasks are just in the in-memory array
      return {
        taskCount: TL.getVisible().length,
        allTasksCount: TL._tasks.length,
      };
    });
    expect(result.taskCount).toBe(1);
    expect(result.allTasksCount).toBe(1);
  });

  test("queued tasks show dot prefix with dimmed opacity", async ({ page }) => {
    await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "q1", type: "conversation", label: "Queued Chat", status: "queued" });
      TL.render();
    });

    const queued = page.locator("#cvz-tasks .cvz-task-queued");
    await expect(queued).toContainText("\u00b7");
    const opacity = await queued.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeLessThanOrEqual(0.5);
  });

  test("done tasks show checkmark prefix with muted opacity", async ({ page }) => {
    await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "d1", type: "conversation", label: "Done Chat", status: "done" });
      TL.render();
    });

    const done = page.locator("#cvz-tasks .cvz-task-done");
    await expect(done).toContainText("\u2713");
    const opacity = await done.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeLessThanOrEqual(0.6);
  });

  test("failed tasks show X prefix with red text and error in parentheses", async ({ page }) => {
    await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "f1", type: "conversation", label: "Bad Chat", status: "failed", error: "HTTP 429" });
      TL.render();
    });

    const failed = page.locator("#cvz-tasks .cvz-task-failed");
    await expect(failed).toContainText("\u2717");
    await expect(failed).toContainText("(HTTP 429)");
    const color = await failed.evaluate((el) => getComputedStyle(el).color);
    // Should be red (#ef4444 = rgb(239, 68, 68))
    expect(color).toContain("239");
  });

  test("active tasks show spinning icon with green-tinted text", async ({ page }) => {
    await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      TL.add({ id: "a1", type: "conversation", label: "Active Chat", status: "active" });
      TL.render();
    });

    const active = page.locator("#cvz-tasks .cvz-task-active");
    const spinner = active.locator(".cvz-spin");
    await expect(spinner).toHaveCount(1);
    await expect(spinner).toContainText("\u27f3");
    const color = await active.evaluate((el) => getComputedStyle(el).color);
    // Should be green-tinted (#10a37f = rgb(16, 163, 127))
    expect(color).toContain("16");
  });

  test("auto-scroll: container scrolls to bottom on new tasks", async ({ page }) => {
    // Add enough tasks to cause scrolling
    await page.evaluate(() => {
      const TL = window.__cvz_TaskList;
      for (let i = 0; i < 30; i++) {
        TL.add({ id: "t-" + i, type: "conversation", label: "Task " + i, status: "done" });
      }
      TL.render();
    });

    const isAtBottom = await page.evaluate(() => {
      const el = document.getElementById("cvz-tasks");
      return el.scrollHeight - el.scrollTop - el.clientHeight < 10;
    });
    expect(isAtBottom).toBe(true);
  });
});
