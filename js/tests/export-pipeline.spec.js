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

/**
 * Helper: prepare the bookmarklet internals for a test.
 * Disables Net.download (to prevent actual file downloads)
 * and sets Net.token so auth doesn't need refreshing.
 */
async function prepareForExport(page) {
  await page.evaluate(() => {
    const Net = window.__cvz_Net;
    Net.download = function () {};
    Net.token = "fake-token";
  });
}

test.describe("US-003: Wire task list to export pipeline", () => {
  test.beforeEach(async ({ page }) => {
    // Serve the harness from a chatgpt.com origin so assertOnChatGPT passes
    const harnessHtml = fs.readFileSync(
      path.join(__dirname, "harness.html"),
      "utf-8"
    );
    await page.route("https://chatgpt.com/test-harness", (route) => {
      route.fulfill({
        contentType: "text/html",
        body: harnessHtml,
      });
    });
    // Mock API routes so auto-rescan and other API calls don't fail
    await page.route("**/api/auth/session", (route) => {
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ accessToken: "fake-token" }),
      });
    });
    await page.route("**/backend-api/conversations**", (route) => {
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0 }),
      });
    });
    await page.route("**/backend-api/gizmos/snorlax/sidebar**", (route) => {
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
    });
    await page.route("**/backend-api/conversation/**", (route) => {
      const url = route.request().url();
      const convIdMatch = url.match(/\/backend-api\/conversation\/([^?]+)/);
      const convId = convIdMatch ? convIdMatch[1] : "unknown";
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ title: "Test Conv " + convId, mapping: {} }),
      });
    });
    await page.route("**/backend-api/files/download/**", (route) => {
      const url = route.request().url();
      const fileId = url
        .split("/backend-api/files/download/")[1]
        .split("?")[0];
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          download_url: "https://chatgpt.com/fake-download/" + fileId,
        }),
      });
    });
    await page.route("**/fake-download/**", (route) => {
      route.fulfill({
        contentType: "application/octet-stream",
        body: Buffer.from("fake-file-data"),
      });
    });
    await page.goto("https://chatgpt.com/test-harness");
    await injectBookmarklet(page);
    // Wait for auto-rescan to complete (it fires after 800ms)
    await page.waitForTimeout(1500);
  });

  test("exportOneBatch creates tasks for conversations being processed", async ({
    page,
  }) => {
    await prepareForExport(page);

    const taskStates = await page.evaluate(async () => {
      const TL = window.__cvz_TaskList;
      const Exporter = window.__cvz_Exporter;
      const S = window.__cvz_S;

      S.progress.pending = [
        { id: "conv-aaa", title: "Chat Alpha" },
        { id: "conv-bbb", title: "Chat Beta" },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      const ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);

      return TL._tasks
        .filter(function (t) {
          return t.type === "conversation";
        })
        .map(function (t) {
          return {
            id: t.id,
            type: t.type,
            label: t.label,
            status: t.status,
          };
        });
    });

    const convA = taskStates.find((t) => t.id === "conv-conv-aaa");
    const convB = taskStates.find((t) => t.id === "conv-conv-bbb");
    expect(convA).toBeTruthy();
    expect(convB).toBeTruthy();
    expect(convA.type).toBe("conversation");
    expect(convB.type).toBe("conversation");
    expect(convA.status).toBe("done");
    expect(convB.status).toBe("done");
  });

  test("exportOneBatch sets task detail during fetch and download phases", async ({
    page,
  }) => {
    // Override the conversation route to return file attachments
    await page.route(
      "**/backend-api/conversation/conv-detail-test",
      (route) => {
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            title: "Detail Test",
            mapping: {
              node1: {
                message: {
                  metadata: {
                    attachments: [
                      { id: "file-001", name: "doc.pdf" },
                      { id: "file-002", name: "pic.png" },
                    ],
                  },
                  content: { parts: [] },
                },
              },
            },
          }),
        });
      }
    );

    await prepareForExport(page);

    const details = await page.evaluate(async () => {
      const TL = window.__cvz_TaskList;
      const Exporter = window.__cvz_Exporter;
      const S = window.__cvz_S;

      S.progress.pending = [
        { id: "conv-detail-test", title: "Detail Test Chat" },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      // Track detail updates from both add() and update()
      var detailHistory = [];
      var origUpdate = TL.update.bind(TL);
      TL.update = function (id, changes) {
        if (changes.detail !== undefined) {
          detailHistory.push({
            id: id,
            detail: changes.detail,
            status: changes.status,
          });
        }
        origUpdate(id, changes);
      };
      var origAdd = TL.add.bind(TL);
      TL.add = function (task) {
        if (task.detail) {
          detailHistory.push({
            id: task.id,
            detail: task.detail,
            status: task.status,
          });
        }
        origAdd(task);
      };

      var ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);

      return detailHistory;
    });

    // Should have detail updates for "fetching conversation"
    const fetchDetail = details.find(
      (d) => d.detail && d.detail.includes("fetching")
    );
    expect(fetchDetail).toBeTruthy();

    // Should have download detail updates
    const downloadDetails = details.filter(
      (d) => d.detail && d.detail.includes("downloading")
    );
    expect(downloadDetails.length).toBeGreaterThan(0);
  });

  test("exportOneBatch marks task as failed when conversation fetch fails", async ({
    page,
  }) => {
    // Override the conversation route to return 500 for this specific conv
    await page.route(
      "**/backend-api/conversation/conv-fail-test",
      (route) => {
        route.fulfill({
          status: 500,
          contentType: "text/plain",
          body: "Server Error",
        });
      }
    );

    await prepareForExport(page);

    const result = await page.evaluate(async () => {
      const TL = window.__cvz_TaskList;
      const Exporter = window.__cvz_Exporter;
      const S = window.__cvz_S;

      S.progress.pending = [{ id: "conv-fail-test", title: "Failing Chat" }];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      var ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);

      var failedTask = TL._tasks.find(function (t) {
        return t.id === "conv-conv-fail-test";
      });
      return failedTask
        ? { status: failedTask.status, error: failedTask.error }
        : null;
    });

    expect(result).toBeTruthy();
    expect(result.status).toBe("failed");
    expect(result.error).toBeTruthy();
  });

  test("exportKnowledgeBatch creates tasks for knowledge files", async ({
    page,
  }) => {
    await prepareForExport(page);

    const result = await page.evaluate(async () => {
      const TL = window.__cvz_TaskList;
      const Exporter = window.__cvz_Exporter;
      const S = window.__cvz_S;

      S.progress.kfPending = [
        {
          projectId: "proj-1",
          projectName: "My Project",
          fileId: "kf-file-1",
          fileName: "design.pdf",
          fileType: "pdf",
          fileSize: 1024,
        },
        {
          projectId: "proj-1",
          projectName: "My Project",
          fileId: "kf-file-2",
          fileName: "notes.txt",
          fileType: "text",
          fileSize: 512,
        },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      var ac = new AbortController();
      await Exporter.exportKnowledgeBatch(ac.signal);

      return TL._tasks
        .filter(function (t) {
          return t.type === "knowledge";
        })
        .map(function (t) {
          return {
            id: t.id,
            type: t.type,
            label: t.label,
            status: t.status,
            projectName: t.projectName,
          };
        });
    });

    expect(result.length).toBe(2);
    const kf1 = result.find((t) => t.id === "kf-kf-file-1");
    const kf2 = result.find((t) => t.id === "kf-kf-file-2");
    expect(kf1).toBeTruthy();
    expect(kf1.type).toBe("knowledge");
    expect(kf1.label).toBe("design.pdf");
    expect(kf1.projectName).toBe("My Project");
    expect(kf1.status).toBe("done");
    expect(kf2).toBeTruthy();
    expect(kf2.status).toBe("done");
  });

  test("scan phase creates a single scanning task", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const TL = window.__cvz_TaskList;
      const Exporter = window.__cvz_Exporter;

      // Wait for auto-rescan to finish if still in progress
      if (Exporter.scanPromise) await Exporter.scanPromise;

      var scanTasks = TL._tasks.filter(function (t) {
        return t.type === "scan";
      });
      return scanTasks.map(function (t) {
        return {
          id: t.id,
          type: t.type,
          label: t.label,
          status: t.status,
        };
      });
    });

    expect(result.length).toBe(1);
    expect(result[0].id).toBe("scan");
    expect(result[0].type).toBe("scan");
    expect(result[0].status).toBe("done");
  });

  test("UI.setStatus() still works for non-task messages", async ({
    page,
  }) => {
    const statusText = await page.evaluate(() => {
      var UI = window.__cvz_UI;
      UI.setStatus("Building ZIP...");
      return document.getElementById("cvz-status").textContent;
    });
    expect(statusText).toBe("Building ZIP...");
  });

  test("per-conversation UI.setStatus calls are replaced with TaskList.update", async ({
    page,
  }) => {
    await prepareForExport(page);

    const result = await page.evaluate(async () => {
      var TL = window.__cvz_TaskList;
      var Exporter = window.__cvz_Exporter;
      var S = window.__cvz_S;

      S.progress.pending = [
        { id: "conv-status-test", title: "Status Test Chat" },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      // Track setStatus calls
      var statusCalls = [];
      var origSetStatus = window.__cvz_UI.setStatus.bind(window.__cvz_UI);
      window.__cvz_UI.setStatus = function (msg) {
        statusCalls.push(msg);
        origSetStatus(msg);
      };

      var ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);

      // setStatus should NOT be called with "Fetching: ..." for individual conversations
      var fetchingCalls = statusCalls.filter(function (m) {
        return m.startsWith("Fetching:");
      });

      return {
        fetchingCalls: fetchingCalls.length,
        allCalls: statusCalls,
      };
    });

    // No "Fetching: ..." calls - those are now TaskList.update()
    expect(result.fetchingCalls).toBe(0);
  });

  test("per-KF UI.setStatus calls are replaced with TaskList.update", async ({
    page,
  }) => {
    await prepareForExport(page);

    const result = await page.evaluate(async () => {
      var TL = window.__cvz_TaskList;
      var Exporter = window.__cvz_Exporter;
      var S = window.__cvz_S;

      S.progress.kfPending = [
        {
          projectId: "proj-1",
          projectName: "TestProj",
          fileId: "kf-status-1",
          fileName: "test.pdf",
          fileType: "pdf",
          fileSize: 100,
        },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      // Track setStatus calls
      var statusCalls = [];
      var origSetStatus = window.__cvz_UI.setStatus.bind(window.__cvz_UI);
      window.__cvz_UI.setStatus = function (msg) {
        statusCalls.push(msg);
        origSetStatus(msg);
      };

      var ac = new AbortController();
      await Exporter.exportKnowledgeBatch(ac.signal);

      // setStatus should NOT be called with "KF: Downloading ..." for individual files
      var kfDownloadCalls = statusCalls.filter(function (m) {
        return m.startsWith("KF: Downloading");
      });

      return {
        kfDownloadCalls: kfDownloadCalls.length,
        allCalls: statusCalls,
      };
    });

    // No "KF: Downloading ..." calls - those are now TaskList.update()
    expect(result.kfDownloadCalls).toBe(0);
  });

  test("tasks show in the rendered task list during export", async ({
    page,
  }) => {
    await prepareForExport(page);

    await page.evaluate(async () => {
      var Exporter = window.__cvz_Exporter;
      var S = window.__cvz_S;

      S.progress.pending = [
        { id: "conv-render-1", title: "Rendered Chat" },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      var ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);
    });

    // After export, rendered tasks should appear in the DOM
    const tasks = page.locator("#cvz-tasks");
    // At least 1 done conversation task (scan task from auto-rescan is also done)
    const doneCount = await tasks.locator(".cvz-task-done").count();
    expect(doneCount).toBeGreaterThanOrEqual(1);
    await expect(tasks).toContainText("Rendered Chat");
  });

  test("active tasks keep their last status when stop is called", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      var TL = window.__cvz_TaskList;
      var Exporter = window.__cvz_Exporter;

      // Manually add an "active" task simulating one in progress
      TL.add({
        id: "conv-in-progress",
        type: "conversation",
        label: "In Progress Chat",
        status: "active",
        detail: "fetching conversation",
      });

      // Call stop (it should NOT modify task statuses)
      Exporter.stop();

      var task = TL._tasks.find(function (t) {
        return t.id === "conv-in-progress";
      });
      return {
        status: task.status,
        detail: task.detail,
      };
    });

    expect(result.status).toBe("active");
    expect(result.detail).toBe("fetching conversation");
  });

  test("conversation tasks use correct id format: conv-{uuid}", async ({
    page,
  }) => {
    await prepareForExport(page);

    const ids = await page.evaluate(async () => {
      var TL = window.__cvz_TaskList;
      var Exporter = window.__cvz_Exporter;
      var S = window.__cvz_S;

      S.progress.pending = [{ id: "abc-123-def", title: "Test" }];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      var ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);

      return TL._tasks
        .filter(function (t) {
          return t.type === "conversation";
        })
        .map(function (t) {
          return t.id;
        });
    });

    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0]).toBe("conv-abc-123-def");
  });

  test("knowledge file tasks use correct id format: kf-{fileId}", async ({
    page,
  }) => {
    await prepareForExport(page);

    const ids = await page.evaluate(async () => {
      var TL = window.__cvz_TaskList;
      var Exporter = window.__cvz_Exporter;
      var S = window.__cvz_S;

      S.progress.kfPending = [
        {
          projectId: "p1",
          projectName: "Proj",
          fileId: "file-xyz-789",
          fileName: "doc.pdf",
          fileType: "pdf",
          fileSize: 100,
        },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      var ac = new AbortController();
      await Exporter.exportKnowledgeBatch(ac.signal);

      return TL._tasks
        .filter(function (t) {
          return t.type === "knowledge";
        })
        .map(function (t) {
          return t.id;
        });
    });

    expect(ids.length).toBeGreaterThan(0);
    expect(ids[0]).toBe("kf-file-xyz-789");
  });

  test("scan task label includes scanning text", async ({ page }) => {
    const result = await page.evaluate(async () => {
      var TL = window.__cvz_TaskList;
      var Exporter = window.__cvz_Exporter;

      // Wait for auto-rescan to finish
      if (Exporter.scanPromise) await Exporter.scanPromise;

      var scanTask = TL._tasks.find(function (t) {
        return t.id === "scan";
      });
      return scanTask ? { label: scanTask.label, type: scanTask.type } : null;
    });

    expect(result).toBeTruthy();
    expect(result.label.toLowerCase()).toContain("scanning");
    expect(result.type).toBe("scan");
  });

  test("conversation task includes projectName when from a project", async ({
    page,
  }) => {
    await prepareForExport(page);

    const result = await page.evaluate(async () => {
      var TL = window.__cvz_TaskList;
      var Exporter = window.__cvz_Exporter;
      var S = window.__cvz_S;

      // Set up a project so gizmo_id maps to a project name
      S.projects = [{ gizmoId: "gizmo-abc", name: "My App" }];
      S.progress.pending = [
        {
          id: "conv-proj-1",
          title: "Project Chat",
          gizmo_id: "gizmo-abc",
        },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      var ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);

      var task = TL._tasks.find(function (t) {
        return t.id === "conv-conv-proj-1";
      });
      return task
        ? { projectName: task.projectName, label: task.label }
        : null;
    });

    expect(result).toBeTruthy();
    expect(result.projectName).toBe("My App");
  });

  test("exportOneBatch skips project knowledge file IDs from downloads", async ({
    page,
  }) => {
    // Track which file IDs are requested via /backend-api/files/download/
    const downloadedFileIds = [];
    await page.route("**/backend-api/files/download/**", (route) => {
      const url = route.request().url();
      const fileId = url
        .split("/backend-api/files/download/")[1]
        .split("?")[0];
      downloadedFileIds.push(fileId);
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          download_url: "https://chatgpt.com/fake-download/" + fileId,
        }),
      });
    });

    // Override conversation route to include both project file and user file
    await page.route(
      "**/backend-api/conversation/conv-proj-filter",
      (route) => {
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            title: "Project Filter Test",
            mapping: {
              node1: {
                message: {
                  metadata: {
                    attachments: [
                      { id: "proj-file-001", name: "project-knowledge.txt" },
                      { id: "user-file-999", name: "user-upload.pdf" },
                      { id: "proj-file-002", name: "another-project-file.md" },
                    ],
                  },
                  content: { parts: [] },
                },
              },
            },
          }),
        });
      }
    );

    await prepareForExport(page);

    const result = await page.evaluate(async () => {
      var TL = window.__cvz_TaskList;
      var Exporter = window.__cvz_Exporter;
      var S = window.__cvz_S;

      // Set up projects with knowledge files
      S.projects = [
        {
          gizmoId: "gizmo-proj-1",
          name: "Test Project",
          files: [
            { fileId: "proj-file-001", name: "project-knowledge.txt", type: "text", size: 100 },
            { fileId: "proj-file-002", name: "another-project-file.md", type: "text", size: 200 },
          ],
        },
      ];

      S.progress.pending = [
        { id: "conv-proj-filter", title: "Project Filter Test", gizmo_id: "gizmo-proj-1" },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      var ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);

      var task = TL._tasks.find(function (t) {
        return t.id === "conv-conv-proj-filter";
      });
      return task ? { status: task.status } : null;
    });

    // The conversation should still export successfully
    expect(result).toBeTruthy();
    expect(result.status).toBe("done");

    // Project file IDs should NOT have been requested
    expect(downloadedFileIds).not.toContain("proj-file-001");
    expect(downloadedFileIds).not.toContain("proj-file-002");

    // User file ID SHOULD have been requested
    expect(downloadedFileIds).toContain("user-file-999");
  });

  test("exportOneBatch passes all refs through when S.projects is empty", async ({
    page,
  }) => {
    // Track which file IDs are requested
    const downloadedFileIds = [];
    await page.route("**/backend-api/files/download/**", (route) => {
      const url = route.request().url();
      const fileId = url
        .split("/backend-api/files/download/")[1]
        .split("?")[0];
      downloadedFileIds.push(fileId);
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          download_url: "https://chatgpt.com/fake-download/" + fileId,
        }),
      });
    });

    // Override conversation route with file attachments
    await page.route(
      "**/backend-api/conversation/conv-no-proj",
      (route) => {
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            title: "No Project Test",
            mapping: {
              node1: {
                message: {
                  metadata: {
                    attachments: [
                      { id: "file-aaa", name: "doc.pdf" },
                      { id: "file-bbb", name: "pic.png" },
                    ],
                  },
                  content: { parts: [] },
                },
              },
            },
          }),
        });
      }
    );

    await prepareForExport(page);

    await page.evaluate(async () => {
      var Exporter = window.__cvz_Exporter;
      var S = window.__cvz_S;

      // No projects set (or empty)
      S.projects = [];

      S.progress.pending = [
        { id: "conv-no-proj", title: "No Project Test" },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      var ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);
    });

    // All file IDs should have been requested (no filtering)
    expect(downloadedFileIds).toContain("file-aaa");
    expect(downloadedFileIds).toContain("file-bbb");
  });

  test("files count in success log reflects only conversation-specific files", async ({
    page,
  }) => {
    // Override conversation route to include both project file and user file
    await page.route(
      "**/backend-api/conversation/conv-count-test",
      (route) => {
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            title: "Count Test",
            mapping: {
              node1: {
                message: {
                  metadata: {
                    attachments: [
                      { id: "proj-file-count", name: "project.txt" },
                      { id: "user-file-count", name: "user.pdf" },
                    ],
                  },
                  content: { parts: [] },
                },
              },
            },
          }),
        });
      }
    );

    await prepareForExport(page);

    const logs = await page.evaluate(async () => {
      var Exporter = window.__cvz_Exporter;
      var S = window.__cvz_S;

      // Set up project with one of the files
      S.projects = [
        {
          gizmoId: "gizmo-count",
          name: "Count Project",
          files: [
            { fileId: "proj-file-count", name: "project.txt", type: "text", size: 50 },
          ],
        },
      ];

      S.progress.pending = [
        { id: "conv-count-test", title: "Count Test", gizmo_id: "gizmo-count" },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      // Clear existing logs to isolate
      S.logs = [];

      var ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);

      return S.logs;
    });

    // Find the success log line for this conversation
    const successLog = logs.find(function (m) {
      return m.includes("Count Test") && m.includes("files ");
    });
    expect(successLog).toBeTruthy();
    // Should show "files 1" (only the user file, not the project file)
    expect(successLog).toContain("files 1");
  });

  test("extractFileRefs strips file-service:// prefix from asset pointers", async ({
    page,
  }) => {
    // Track which file IDs are requested via /backend-api/files/download/
    const downloadedFileIds = [];
    await page.route("**/backend-api/files/download/**", (route) => {
      const url = route.request().url();
      const fileId = url
        .split("/backend-api/files/download/")[1]
        .split("?")[0];
      downloadedFileIds.push(fileId);
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          download_url: "https://chatgpt.com/fake-download/" + fileId,
        }),
      });
    });

    // Override conversation route with a file-service:// asset pointer
    await page.route(
      "**/backend-api/conversation/conv-file-service",
      (route) => {
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            title: "File Service Test",
            mapping: {
              node1: {
                message: {
                  metadata: { attachments: [] },
                  content: {
                    parts: [
                      {
                        content_type: "image_asset_pointer",
                        asset_pointer: "file-service://file-test123",
                      },
                    ],
                  },
                },
              },
            },
          }),
        });
      }
    );

    await prepareForExport(page);

    const result = await page.evaluate(async () => {
      var Exporter = window.__cvz_Exporter;
      var S = window.__cvz_S;
      var TL = window.__cvz_TaskList;

      S.progress.pending = [
        { id: "conv-file-service", title: "File Service Test" },
      ];
      S.settings.batch = 10;
      S.settings.conc = 1;
      S.settings.pause = 0;

      var ac = new AbortController();
      await Exporter.exportOneBatch(ac.signal);

      var task = TL._tasks.find(function (t) {
        return t.id === "conv-conv-file-service";
      });
      return task ? { status: task.status } : null;
    });

    // The conversation should export successfully
    expect(result).toBeTruthy();
    expect(result.status).toBe("done");

    // The download should be attempted for the stripped file ID, not the full URI
    expect(downloadedFileIds).toContain("file-test123");
    expect(downloadedFileIds).not.toContain("file-service://file-test123");
  });
});
