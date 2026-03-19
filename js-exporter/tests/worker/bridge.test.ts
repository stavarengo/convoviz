// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkerToMainMessage, WorkerStatePayload } from "../../src/worker/protocol";
import type { WorkerBridge } from "../../src/worker/bridge";
import { defaultState } from "../../src/state/defaults";

/* ------------------------------------------------------------------ */
/*  Mock Worker class (no real threads in jsdom)                       */
/* ------------------------------------------------------------------ */

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  _listeners: Map<string, Function[]> = new Map();
  _sent: any[] = [];
  _terminated = false;

  postMessage(data: any): void {
    this._sent.push(data);
  }

  terminate(): void {
    this._terminated = true;
  }

  addEventListener(type: string, fn: Function): void {
    const arr = this._listeners.get(type) || [];
    arr.push(fn);
    this._listeners.set(type, arr);
  }

  removeEventListener(type: string, fn: Function): void {
    const arr = this._listeners.get(type) || [];
    this._listeners.set(
      type,
      arr.filter((f) => f !== fn),
    );
  }

  /** Simulate the worker sending a message back to main thread. */
  _emit(msg: WorkerToMainMessage): void {
    const event = { data: msg } as MessageEvent;
    if (this.onmessage) this.onmessage(event);
    for (const fn of this._listeners.get("message") || []) {
      fn(event);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Intercept Worker + Blob + URL so createWorkerBridge works          */
/* ------------------------------------------------------------------ */

let lastMockWorker: MockWorker;

beforeEach(() => {
  vi.stubGlobal("Blob", class FakeBlob {
    constructor(public parts: any[], public opts: any) {}
  });
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
  });
  vi.stubGlobal("Worker", class FakeWorkerProxy extends MockWorker {
    constructor() {
      super();
      lastMockWorker = this;
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("createWorkerBridge", () => {
  it("creates a worker and sends init command", async () => {
    // Dynamic import to pick up mocks
    const { createWorkerBridge } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");
    expect(lastMockWorker._sent).toEqual([{ type: "init" }]);
    expect(bridge.state).toBeNull();
    bridge.terminate();
  });

  it("dispatches start/stop/rescan commands", async () => {
    const { createWorkerBridge } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");
    bridge.start();
    bridge.stop();
    bridge.rescan(true);
    expect(lastMockWorker._sent).toEqual([
      { type: "init" },
      { type: "start" },
      { type: "stop" },
      { type: "rescan", force: true },
    ]);
    bridge.terminate();
  });

  it("dispatches updateSettings command", async () => {
    const { createWorkerBridge } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");
    bridge.updateSettings({ chatConcurrency: 5, pause: 500 });
    expect(lastMockWorker._sent[1]).toEqual({
      type: "update-settings",
      settings: { chatConcurrency: 5, pause: 500 },
    });
    bridge.terminate();
  });

  it("routes ready message to onReady callback", async () => {
    const { createWorkerBridge } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");
    const cb = vi.fn();
    bridge.onReady = cb;
    lastMockWorker._emit({ type: "ready", version: "v1", sessionId: "abc" });
    expect(cb).toHaveBeenCalledWith("v1", "abc");
    bridge.terminate();
  });

  it("routes state message and updates bridge.state", async () => {
    const { createWorkerBridge } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");
    const cb = vi.fn();
    bridge.onStateUpdate = cb;

    const snap = { pending: 0, active: 0, done: 0, dead: 0 };
    const payload: WorkerToMainMessage = {
      type: "state",
      state: defaultState(),
      tasks: [],
      queues: { chat: snap, attachment: snap, knowledge: snap },
      scanning: false,
    };
    lastMockWorker._emit(payload);

    expect(bridge.state).not.toBeNull();
    expect(bridge.state!.v).toBe(3);
    expect(bridge.scanning).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
    bridge.terminate();
  });

  it("routes status message to onStatus callback", async () => {
    const { createWorkerBridge } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");
    const cb = vi.fn();
    bridge.onStatus = cb;
    lastMockWorker._emit({ type: "status", message: "Running…" });
    expect(cb).toHaveBeenCalledWith("Running…");
    bridge.terminate();
  });

  it("routes log message and appends to sessionLogs", async () => {
    const { createWorkerBridge } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");
    const cb = vi.fn();
    bridge.onLog = cb;

    lastMockWorker._emit({
      type: "log",
      entry: {
        timestamp: 1000,
        session: "s1",
        level: "info",
        category: "sys",
        message: "hello",
      },
    });

    expect(bridge.sessionLogs).toHaveLength(1);
    expect(bridge.sessionLogs[0].message).toBe("hello");
    expect(cb).toHaveBeenCalledTimes(1);
    bridge.terminate();
  });

  it("routes error message to onError callback", async () => {
    const { createWorkerBridge } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");
    const cb = vi.fn();
    bridge.onError = cb;
    lastMockWorker._emit({ type: "error", message: "boom" });
    expect(cb).toHaveBeenCalledWith("boom");
    bridge.terminate();
  });

  it("routes reset-done message to onResetDone callback", async () => {
    const { createWorkerBridge } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");
    const cb = vi.fn();
    bridge.onResetDone = cb;
    lastMockWorker._emit({ type: "reset-done" });
    expect(cb).toHaveBeenCalledTimes(1);
    bridge.terminate();
  });

  it("terminate() calls worker.terminate()", async () => {
    const { createWorkerBridge } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");
    bridge.terminate();
    expect(lastMockWorker._terminated).toBe(true);
  });
});

describe("pingWorker", () => {
  it("resolves with version when worker responds to ping", async () => {
    const { createWorkerBridge, pingWorker } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");

    const promise = pingWorker(bridge, 1000);

    // Simulate the worker responding to the ping
    lastMockWorker._emit({ type: "pong", version: "cvz-bookmarklet-6.0" });

    const result = await promise;
    expect(result).toBe("cvz-bookmarklet-6.0");
    bridge.terminate();
  });

  it("resolves with null when worker doesn't respond in time", async () => {
    vi.useFakeTimers();
    const { createWorkerBridge, pingWorker } = await import("../../src/worker/bridge");
    const bridge = createWorkerBridge("// worker code");

    const promise = pingWorker(bridge, 100);

    // Advance time past timeout
    vi.advanceTimersByTime(200);

    const result = await promise;
    expect(result).toBeNull();
    bridge.terminate();
    vi.useRealTimers();
  });
});

describe("getOrCreateBridge", () => {
  it("creates a new bridge when no existing bridge", async () => {
    const { getOrCreateBridge } = await import("../../src/worker/bridge");
    const bridge = await getOrCreateBridge("// worker code", null);
    expect(bridge).toBeDefined();
    expect(lastMockWorker._sent[0]).toEqual({ type: "init" });
    bridge.terminate();
  });

  it("reuses existing bridge when version matches", async () => {
    const { createWorkerBridge, getOrCreateBridge } = await import("../../src/worker/bridge");
    const existing = createWorkerBridge("// worker code");
    const existingWorker = lastMockWorker;

    // getOrCreateBridge will ping, simulate the response
    const bridgePromise = getOrCreateBridge("// worker code", existing);
    existingWorker._emit({ type: "pong", version: "cvz-bookmarklet-6.0" });

    const bridge = await bridgePromise;
    expect(bridge).toBe(existing); // Same reference — reused
    expect(existingWorker._terminated).toBe(false);
    bridge.terminate();
  });

  it("terminates and recreates when version mismatches", async () => {
    const { createWorkerBridge, getOrCreateBridge } = await import("../../src/worker/bridge");
    const existing = createWorkerBridge("// worker code");
    const existingWorker = lastMockWorker;

    const bridgePromise = getOrCreateBridge("// worker code", existing);
    existingWorker._emit({ type: "pong", version: "cvz-bookmarklet-OLD" });

    const bridge = await bridgePromise;
    expect(bridge).not.toBe(existing); // Different reference — new bridge
    expect(existingWorker._terminated).toBe(true);
    bridge.terminate();
  });
});
