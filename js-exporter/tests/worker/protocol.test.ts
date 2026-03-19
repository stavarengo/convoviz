import { describe, it, expect } from "vitest";
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  WorkerLogEntry,
  QueueSnapshot,
  WorkerStatePayload,
} from "../../src/worker/protocol";
import type { ExportState } from "../../src/types";
import { defaultState } from "../../src/state/defaults";

describe("MainToWorkerMessage", () => {
  it("init message has correct shape", () => {
    const msg: MainToWorkerMessage = { type: "init" };
    expect(msg.type).toBe("init");
  });

  it("start message has correct shape", () => {
    const msg: MainToWorkerMessage = { type: "start" };
    expect(msg.type).toBe("start");
  });

  it("stop message has correct shape", () => {
    const msg: MainToWorkerMessage = { type: "stop" };
    expect(msg.type).toBe("stop");
  });

  it("rescan message carries force flag", () => {
    const msg: MainToWorkerMessage = { type: "rescan", force: true };
    expect(msg.type).toBe("rescan");
    expect(msg.force).toBe(true);
  });

  it("update-settings message carries partial settings", () => {
    const msg: MainToWorkerMessage = {
      type: "update-settings",
      settings: { chatConcurrency: 5 },
    };
    expect(msg.type).toBe("update-settings");
    expect(msg.settings.chatConcurrency).toBe(5);
  });

  it("ping message has correct shape", () => {
    const msg: MainToWorkerMessage = { type: "ping" };
    expect(msg.type).toBe("ping");
  });

  it("reset message has correct shape", () => {
    const msg: MainToWorkerMessage = { type: "reset" };
    expect(msg.type).toBe("reset");
  });
});

describe("WorkerToMainMessage", () => {
  it("ready message carries version and sessionId", () => {
    const msg: WorkerToMainMessage = {
      type: "ready",
      version: "cvz-bookmarklet-6.0",
      sessionId: "abc12345",
    };
    expect(msg.type).toBe("ready");
    if (msg.type === "ready") {
      expect(msg.version).toBe("cvz-bookmarklet-6.0");
      expect(msg.sessionId).toBe("abc12345");
    }
  });

  it("state message carries full state payload", () => {
    const state = defaultState();
    const snap: QueueSnapshot = { pending: 0, active: 0, done: 0, dead: 0 };
    const msg: WorkerToMainMessage = {
      type: "state",
      state,
      tasks: [],
      queues: { chat: snap, attachment: snap, knowledge: snap },
      scanning: false,
    };
    expect(msg.type).toBe("state");
    if (msg.type === "state") {
      expect(msg.state.v).toBe(3);
      expect(msg.tasks).toEqual([]);
      expect(msg.scanning).toBe(false);
    }
  });

  it("status message carries text", () => {
    const msg: WorkerToMainMessage = { type: "status", message: "Scanning…" };
    expect(msg.type).toBe("status");
  });

  it("log message carries a WorkerLogEntry", () => {
    const entry: WorkerLogEntry = {
      timestamp: Date.now(),
      session: "ses123",
      level: "info",
      category: "sys",
      message: "hello",
    };
    const msg: WorkerToMainMessage = { type: "log", entry };
    expect(msg.type).toBe("log");
    if (msg.type === "log") {
      expect(msg.entry.level).toBe("info");
    }
  });

  it("pong message carries version", () => {
    const msg: WorkerToMainMessage = { type: "pong", version: "v1" };
    if (msg.type === "pong") {
      expect(msg.version).toBe("v1");
    }
  });

  it("error message carries text", () => {
    const msg: WorkerToMainMessage = { type: "error", message: "boom" };
    if (msg.type === "error") {
      expect(msg.message).toBe("boom");
    }
  });

  it("reset-done message has correct shape", () => {
    const msg: WorkerToMainMessage = { type: "reset-done" };
    expect(msg.type).toBe("reset-done");
  });
});

describe("WorkerStatePayload", () => {
  it("is JSON-serializable (no Blob / DOM references)", () => {
    const state = defaultState();
    const snap: QueueSnapshot = { pending: 1, active: 2, done: 3, dead: 0 };
    const payload: WorkerStatePayload = {
      state,
      tasks: [
        {
          id: "conv-1",
          type: "conversation",
          label: "Test chat",
          projectName: null,
          status: "active",
          detail: null,
          error: null,
          startedAt: Date.now(),
          completedAt: null,
        },
      ],
      queues: { chat: snap, attachment: snap, knowledge: snap },
      scanning: true,
    };

    // Round-trip through JSON
    const json = JSON.stringify(payload);
    const parsed = JSON.parse(json) as WorkerStatePayload;
    expect(parsed.state.v).toBe(3);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.queues.chat.pending).toBe(1);
    expect(parsed.scanning).toBe(true);
  });
});
