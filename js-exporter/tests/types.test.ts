import { describe, it, expect } from "vitest";
import type {
  ExportState,
  Settings,
  Progress,
  ScanState,
  RunState,
  Stats,
  Changes,
  PendingItem,
  DeadItem,
  KfPendingItem,
  KfDeadItem,
  ProjectInfo,
  ProjectFile,
  FileRef,
  Task,
  TaskStatus,
  AttachmentItem,
} from "../src/types";

describe("types", () => {
  it("ExportState has the correct top-level shape", () => {
    const state: ExportState = {
      v: 3,
      ver: "cvz-bookmarklet-5.0",
      projects: [],
      settings: {
        chatConcurrency: 3,
        fileConcurrency: 3,
        knowledgeFileConcurrency: 3,
        pause: 300,
        filterGizmoId: null,
      },
      progress: {
        exported: {},
        pending: [],
        dead: [],
        failCounts: {},
        filePending: [],
        fileDead: [],
        fileFailCounts: {},
        fileDoneCount: 0,
        knowledgeFilesExported: [],
        knowledgeFilesPending: [],
        knowledgeFilesDead: [],
        knowledgeFilesFailCounts: {},
      },
      scan: { at: 0, total: 0, totalProjects: 0, snapshot: [] },
      stats: {
        chatsExported: 0,
        chatsMs: 0,
        filesDownloaded: 0,
        filesMs: 0,
        knowledgeFilesDownloaded: 0,
        knowledgeFilesMs: 0,
      },
      run: {
        isRunning: false,
        startedAt: 0,
        stoppedAt: 0,
        lastError: "",
        backoffUntil: 0,
        backoffCount: 0,
      },
      changes: { at: 0, newChats: 0, removedChats: 0, updatedChats: 0, newPending: 0, pendingDelta: 0 },
    };
    expect(state.v).toBe(3);
    expect(state.ver).toBe("cvz-bookmarklet-5.0");
  });

  it("Settings has all expected fields", () => {
    const settings: Settings = {
      chatConcurrency: 3,
      fileConcurrency: 3,
      knowledgeFileConcurrency: 3,
      pause: 300,
      filterGizmoId: null,
    };
    expect(settings.chatConcurrency).toBe(3);
    expect(settings.filterGizmoId).toBeNull();
  });

  it("PendingItem has id, title, update_time, gizmo_id", () => {
    const item: PendingItem = { id: "abc", title: "Test", update_time: 123, gizmo_id: null };
    expect(item.id).toBe("abc");
  });

  it("DeadItem extends PendingItem with lastError", () => {
    const item: DeadItem = { id: "abc", title: "Test", update_time: 123, gizmo_id: null, lastError: "failed" };
    expect(item.lastError).toBe("failed");
  });

  it("KfPendingItem has project and file fields", () => {
    const item: KfPendingItem = {
      projectId: "p1",
      projectName: "Proj",
      fileId: "f1",
      fileName: "file.txt",
      fileType: "text",
      fileSize: 100,
    };
    expect(item.fileId).toBe("f1");
  });

  it("KfDeadItem extends KfPendingItem with lastError", () => {
    const item: KfDeadItem = {
      projectId: "p1",
      projectName: "Proj",
      fileId: "f1",
      fileName: "file.txt",
      fileType: "text",
      fileSize: 100,
      lastError: "timeout",
    };
    expect(item.lastError).toBe("timeout");
  });

  it("AttachmentItem has id, name, conversationId, conversationTitle", () => {
    const item: AttachmentItem = {
      id: "file-1",
      name: "readme.txt",
      conversationId: "c1",
      conversationTitle: "Chat 1",
    };
    expect(item.id).toBe("file-1");
    expect(item.name).toBe("readme.txt");
  });

  it("ProjectInfo has the correct shape", () => {
    const proj: ProjectInfo = {
      gizmoId: "g1",
      name: "My Project",
      emoji: "",
      theme: "blue",
      instructions: "Do stuff",
      memoryEnabled: true,
      memoryScope: "global",
      files: [{ fileId: "f1", name: "doc.pdf", type: "pdf", size: 1024 }],
      raw: {},
    };
    expect(proj.gizmoId).toBe("g1");
  });

  it("ProjectFile has fileId, name, type, size", () => {
    const file: ProjectFile = { fileId: "f1", name: "doc.pdf", type: "pdf", size: 1024 };
    expect(file.fileId).toBe("f1");
  });

  it("FileRef has id and name", () => {
    const ref: FileRef = { id: "file-123", name: "image.png" };
    expect(ref.id).toBe("file-123");
    const refNull: FileRef = { id: "file-456", name: null };
    expect(refNull.name).toBeNull();
  });

  it("Task has all expected fields with TaskStatus type", () => {
    const statuses: TaskStatus[] = ["queued", "active", "done", "failed"];
    expect(statuses).toHaveLength(4);

    const task: Task = {
      id: "t1",
      type: "conversation",
      label: "Export chat",
      projectName: null,
      status: "queued",
      detail: null,
      error: null,
      startedAt: null,
      completedAt: null,
    };
    expect(task.status).toBe("queued");
  });

  it("ScanState snapshot is array of [string, number] tuples", () => {
    const scan: ScanState = {
      at: Date.now(),
      total: 2,
      totalProjects: 1,
      snapshot: [
        ["id1", 1234567890],
        ["id2", 1234567891],
      ],
    };
    expect(scan.snapshot).toHaveLength(2);
  });

  it("Changes has all diff fields", () => {
    const changes: Changes = {
      at: Date.now(),
      newChats: 5,
      removedChats: 1,
      updatedChats: 3,
      newPending: 4,
      pendingDelta: 2,
    };
    expect(changes.newChats).toBe(5);
  });

  it("RunState has all expected fields", () => {
    const run: RunState = {
      isRunning: false,
      startedAt: 0,
      stoppedAt: 0,
      lastError: "",
      backoffUntil: 0,
      backoffCount: 0,
    };
    expect(run.isRunning).toBe(false);
  });

  it("Stats has all expected fields", () => {
    const stats: Stats = {
      chatsExported: 100,
      chatsMs: 5000,
      filesDownloaded: 50,
      filesMs: 3000,
      knowledgeFilesDownloaded: 5,
      knowledgeFilesMs: 1000,
    };
    expect(stats.chatsExported).toBe(100);
  });

  it("Progress has all expected fields", () => {
    const progress: Progress = {
      exported: { "chat-1": 123, "chat-2": 456 },
      pending: [{ id: "chat-3", title: "Test", update_time: 789, gizmo_id: null }],
      dead: [],
      failCounts: { "chat-3": 1 },
      filePending: [],
      fileDead: [],
      fileFailCounts: {},
      fileDoneCount: 0,
      knowledgeFilesExported: [],
      knowledgeFilesPending: [],
      knowledgeFilesDead: [],
      knowledgeFilesFailCounts: {},
    };
    expect(progress.exported["chat-1"]).toBe(123);
  });
});
