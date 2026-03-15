import { describe, it, expect, vi, beforeEach } from "vitest";
import { createQueue } from "../../src/export/queue";
import type { QueueItem, QueueCallbacks } from "../../src/export/queue";

interface TestItem extends QueueItem {
  value: string;
}

const item = (id: string, value = ""): TestItem => ({ id, value });

describe("Queue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("basic enqueue, process, done flow", () => {
    it("processes enqueued items and reports stats", async () => {
      const processed: string[] = [];
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 0,
        worker: async (t) => {
          processed.push(t.id);
        },
      });

      q.enqueue([item("a"), item("b"), item("c")]);
      const ac = new AbortController();
      await q.start(ac.signal);

      expect(processed).toEqual(["a", "b", "c"]);
      expect(q.stats.done).toBe(3);
      expect(q.stats.pending).toBe(0);
      expect(q.stats.active).toBe(0);
      expect(q.stats.dead).toBe(0);
    });

    it("fires onItemDone for each completed item", async () => {
      const onItemDone = vi.fn();
      const q = createQueue<TestItem>(
        {
          name: "test",
          concurrency: 1,
          maxRetries: 3,
          pauseMs: 0,
          worker: async () => {},
        },
        { onItemDone },
      );

      q.enqueue([item("a"), item("b")]);
      await q.start(new AbortController().signal);

      expect(onItemDone).toHaveBeenCalledTimes(2);
      expect(onItemDone).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
      expect(onItemDone).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    });
  });

  describe("concurrency limit", () => {
    it("respects the concurrency limit", async () => {
      let maxConcurrent = 0;
      let current = 0;
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 2,
        maxRetries: 3,
        pauseMs: 0,
        worker: async () => {
          current++;
          if (current > maxConcurrent) maxConcurrent = current;
          await new Promise((r) => setTimeout(r, 10));
          current--;
        },
      });

      q.enqueue([item("a"), item("b"), item("c"), item("d")]);
      await q.start(new AbortController().signal);

      expect(maxConcurrent).toBe(2);
      expect(q.stats.done).toBe(4);
    });
  });

  describe("retry and dead-letter", () => {
    it("retries failed items up to maxRetries then dead-letters", async () => {
      const onItemFailed = vi.fn();
      const onItemDead = vi.fn();
      let attempts = 0;
      const q = createQueue<TestItem>(
        {
          name: "test",
          concurrency: 1,
          maxRetries: 3,
          pauseMs: 0,
          worker: async () => {
            attempts++;
            throw new Error("fail");
          },
        },
        { onItemFailed, onItemDead },
      );

      q.enqueue([item("a")]);
      await q.start(new AbortController().signal);

      // 1 initial attempt + 2 retries = 3 total attempts
      expect(attempts).toBe(3);
      expect(onItemFailed).toHaveBeenCalledTimes(3);
      expect(onItemDead).toHaveBeenCalledTimes(1);
      expect(onItemDead).toHaveBeenCalledWith(
        expect.objectContaining({ id: "a" }),
        "fail",
      );
      expect(q.stats.dead).toBe(1);
      expect(q.stats.done).toBe(0);
    });

    it("immediate dead-letter when error has immediateDeadLetter property", async () => {
      const onItemFailed = vi.fn();
      const onItemDead = vi.fn();
      let attempts = 0;

      class ImmediateError extends Error {
        readonly immediateDeadLetter = true;
        constructor() {
          super("file not found");
          this.name = "ImmediateError";
        }
      }

      const q = createQueue<TestItem>(
        {
          name: "test",
          concurrency: 1,
          maxRetries: 3,
          pauseMs: 0,
          worker: async () => {
            attempts++;
            throw new ImmediateError();
          },
        },
        { onItemFailed, onItemDead },
      );

      q.enqueue([item("a")]);
      await q.start(new AbortController().signal);

      // Should only attempt once — immediate dead-letter bypasses retries
      expect(attempts).toBe(1);
      expect(onItemFailed).toHaveBeenCalledTimes(1);
      expect(onItemDead).toHaveBeenCalledTimes(1);
      expect(onItemDead).toHaveBeenCalledWith(
        expect.objectContaining({ id: "a" }),
        "file not found",
      );
      expect(q.stats.dead).toBe(1);
    });

    it("requeues items that fail fewer than maxRetries times", async () => {
      let attempts = 0;
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 0,
        worker: async () => {
          attempts++;
          if (attempts < 2) throw new Error("temporary");
        },
      });

      q.enqueue([item("a")]);
      await q.start(new AbortController().signal);

      expect(attempts).toBe(2);
      expect(q.stats.done).toBe(1);
      expect(q.stats.dead).toBe(0);
    });
  });

  describe("enqueue while running (wake parked workers)", () => {
    it("wakes parked workers when new items are enqueued", async () => {
      const processed: string[] = [];
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 0,
        worker: async (t) => {
          processed.push(t.id);
        },
      });

      // Start with empty queue (workers park immediately)
      const ac = new AbortController();
      const done = q.start(ac.signal);

      // Enqueue items after start - workers should wake up
      await new Promise((r) => setTimeout(r, 10));
      q.enqueue([item("a")]);
      await new Promise((r) => setTimeout(r, 10));
      q.enqueue([item("b")]);

      // Wait a bit for processing, then stop
      await new Promise((r) => setTimeout(r, 50));
      q.stop();
      await done;

      expect(processed).toEqual(["a", "b"]);
    });
  });

  describe("stop while running", () => {
    it("workers finish current item then exit on stop", async () => {
      const processed: string[] = [];
      let workerResolve: (() => void) | null = null;
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 0,
        worker: async (t) => {
          processed.push(t.id);
          if (t.id === "a") {
            await new Promise<void>((r) => {
              workerResolve = r;
            });
          }
        },
      });

      q.enqueue([item("a"), item("b")]);
      const ac = new AbortController();
      const done = q.start(ac.signal);

      // Wait for worker to pick up item "a"
      await new Promise((r) => setTimeout(r, 10));
      expect(q.isRunning).toBe(true);

      // Stop the queue while "a" is in progress
      q.stop();

      // Resolve "a" so the worker can finish
      workerResolve!();
      await done;

      // "a" was processed since it was already active
      // "b" may or may not be processed depending on timing
      expect(processed).toContain("a");
      expect(q.isRunning).toBe(false);
    });
  });

  describe("setConcurrency", () => {
    it("increasing concurrency spawns new workers", async () => {
      let maxConcurrent = 0;
      let current = 0;
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 0,
        worker: async () => {
          current++;
          if (current > maxConcurrent) maxConcurrent = current;
          await new Promise((r) => setTimeout(r, 30));
          current--;
        },
      });

      q.enqueue([item("a"), item("b"), item("c"), item("d")]);
      const ac = new AbortController();
      const done = q.start(ac.signal);

      // Wait for first worker to start
      await new Promise((r) => setTimeout(r, 5));
      // Increase concurrency
      q.setConcurrency(3);

      await done;

      // At some point there should have been more than 1 concurrent
      expect(maxConcurrent).toBeGreaterThan(1);
      expect(q.stats.done).toBe(4);
    });

    it("decreasing concurrency lets excess workers finish then exit", async () => {
      let maxConcurrent = 0;
      let current = 0;
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 3,
        maxRetries: 3,
        pauseMs: 0,
        worker: async () => {
          current++;
          if (current > maxConcurrent) maxConcurrent = current;
          await new Promise((r) => setTimeout(r, 20));
          current--;
        },
      });

      // 6 items with concurrency 3
      q.enqueue([
        item("a"),
        item("b"),
        item("c"),
        item("d"),
        item("e"),
        item("f"),
      ]);
      const ac = new AbortController();
      const done = q.start(ac.signal);

      // Wait for workers to get going
      await new Promise((r) => setTimeout(r, 5));
      expect(maxConcurrent).toBe(3);

      // Decrease concurrency
      q.setConcurrency(1);

      await done;
      expect(q.stats.done).toBe(6);
    });
  });

  describe("pauseMs delay", () => {
    it("delays between items by pauseMs", async () => {
      const times: number[] = [];
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 50,
        worker: async () => {
          times.push(Date.now());
        },
      });

      q.enqueue([item("a"), item("b")]);
      await q.start(new AbortController().signal);

      expect(times.length).toBe(2);
      // The gap should be at least ~40ms (allowing some timer imprecision)
      const gap = times[1] - times[0];
      expect(gap).toBeGreaterThanOrEqual(30);
    });
  });

  describe("AbortSignal cancellation", () => {
    it("AbortError from worker exits loop without counting as failure", async () => {
      const onItemFailed = vi.fn();
      const onItemDead = vi.fn();
      const q = createQueue<TestItem>(
        {
          name: "test",
          concurrency: 1,
          maxRetries: 3,
          pauseMs: 0,
          worker: async () => {
            throw new DOMException("Aborted", "AbortError");
          },
        },
        { onItemFailed, onItemDead },
      );

      q.enqueue([item("a"), item("b")]);
      await q.start(new AbortController().signal);

      // AbortError should not count as failure or dead-letter
      expect(onItemFailed).not.toHaveBeenCalled();
      expect(onItemDead).not.toHaveBeenCalled();
      expect(q.stats.dead).toBe(0);
    });

    it("external abort signal stops the queue", async () => {
      const processed: string[] = [];
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 0,
        worker: async (t) => {
          processed.push(t.id);
          await new Promise((r) => setTimeout(r, 50));
        },
      });

      q.enqueue([item("a"), item("b"), item("c")]);
      const ac = new AbortController();
      const done = q.start(ac.signal);

      // Abort after first item starts
      await new Promise((r) => setTimeout(r, 10));
      ac.abort();
      await done;

      expect(q.isRunning).toBe(false);
    });
  });

  describe("empty queue start", () => {
    it("workers park then wake on first enqueue", async () => {
      const processed: string[] = [];
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 2,
        maxRetries: 3,
        pauseMs: 0,
        worker: async (t) => {
          processed.push(t.id);
        },
      });

      // Start with no items
      const ac = new AbortController();
      const done = q.start(ac.signal);

      expect(q.isRunning).toBe(true);
      expect(q.stats.pending).toBe(0);

      // Enqueue after a delay
      await new Promise((r) => setTimeout(r, 20));
      q.enqueue([item("x")]);

      // Wait for processing
      await new Promise((r) => setTimeout(r, 20));
      q.stop();
      await done;

      expect(processed).toContain("x");
    });
  });

  describe("onDrained callback", () => {
    it("fires when queue empties (pending=0, active=0)", async () => {
      const onDrained = vi.fn();
      const q = createQueue<TestItem>(
        {
          name: "test",
          concurrency: 1,
          maxRetries: 3,
          pauseMs: 0,
          worker: async () => {},
        },
        { onDrained },
      );

      q.enqueue([item("a"), item("b")]);
      await q.start(new AbortController().signal);

      expect(onDrained).toHaveBeenCalled();
    });
  });

  describe("onStatsChanged callback", () => {
    it("fires on every stats change", async () => {
      const onStatsChanged = vi.fn();
      const q = createQueue<TestItem>(
        {
          name: "test",
          concurrency: 1,
          maxRetries: 3,
          pauseMs: 0,
          worker: async () => {},
        },
        { onStatsChanged },
      );

      q.enqueue([item("a")]);
      await q.start(new AbortController().signal);

      // Should have been called multiple times (at least: pending->active, active->done)
      expect(onStatsChanged).toHaveBeenCalled();
      expect(onStatsChanged.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("isRunning property", () => {
    it("reflects whether the queue is active", async () => {
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 0,
        worker: async () => {},
      });

      expect(q.isRunning).toBe(false);

      q.enqueue([item("a")]);
      const done = q.start(new AbortController().signal);

      // After start is called, isRunning should be true
      expect(q.isRunning).toBe(true);

      await done;
      expect(q.isRunning).toBe(false);
    });
  });

  describe("name property", () => {
    it("returns the configured name", () => {
      const q = createQueue<TestItem>({
        name: "my-queue",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 0,
        worker: async () => {},
      });
      expect(q.name).toBe("my-queue");
    });
  });

  describe("start resolves on drain or stop", () => {
    it("start resolves when stop() is called", async () => {
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 0,
        worker: async () => {
          await new Promise((r) => setTimeout(r, 1000));
        },
      });

      const ac = new AbortController();
      const done = q.start(ac.signal);

      // Stop immediately
      await new Promise((r) => setTimeout(r, 5));
      q.stop();
      await done;

      expect(q.isRunning).toBe(false);
    });

    it("start resolves when queue drains (pending=0, active=0)", async () => {
      const q = createQueue<TestItem>({
        name: "test",
        concurrency: 1,
        maxRetries: 3,
        pauseMs: 0,
        worker: async () => {},
      });

      q.enqueue([item("a")]);
      await q.start(new AbortController().signal);

      // Should resolve without stop() since queue is drained
      expect(q.isRunning).toBe(false);
      expect(q.stats.done).toBe(1);
    });
  });
});
