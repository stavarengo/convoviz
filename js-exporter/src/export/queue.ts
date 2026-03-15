export interface QueueItem {
  id: string;
}

export interface QueueConfig<T extends QueueItem> {
  name: string;
  concurrency: number;
  maxRetries: number;
  pauseMs: number;
  worker: (item: T, signal: AbortSignal) => Promise<void>;
}

export interface QueueCallbacks<T extends QueueItem> {
  onItemDone?: (item: T) => void;
  onItemFailed?: (item: T, error: string, attempt: number) => void;
  onItemDead?: (item: T, error: string) => void;
  onDrained?: () => void;
  onStatsChanged?: () => void;
}

export interface QueueStats {
  pending: number;
  active: number;
  done: number;
  dead: number;
}

export interface Queue<T extends QueueItem> {
  readonly name: string;
  readonly stats: QueueStats;
  readonly isRunning: boolean;
  enqueue(items: T[]): void;
  start(signal: AbortSignal): Promise<void>;
  stop(): void;
  setConcurrency(n: number): void;
}

export const createQueue = <T extends QueueItem>(
  config: QueueConfig<T>,
  callbacks: QueueCallbacks<T> = {},
): Queue<T> => {
  const pending: T[] = [];
  const failCounts = new Map<string, number>();
  let doneCount = 0;
  let deadCount = 0;
  let activeCount = 0;
  let running = false;
  let itemsEverSeen = false;
  let targetConcurrency = config.concurrency;
  let workerCount = 0;

  let stopController: AbortController | null = null;
  let queueSignal: AbortSignal | null = null;

  // Promise-based wake mechanism for parked workers
  let wakeResolve: (() => void) | null = null;

  const notifyStats = (): void => {
    callbacks.onStatsChanged?.();
  };

  const wake = (): void => {
    if (wakeResolve) {
      const r = wakeResolve;
      wakeResolve = null;
      r();
    }
  };

  const waitForItems = (signal: AbortSignal): Promise<void> => {
    if (pending.length > 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      // If there's already a wake promise, chain onto it
      const prevResolve = wakeResolve;
      wakeResolve = () => {
        signal.removeEventListener("abort", onAbort);
        if (prevResolve) prevResolve();
        resolve();
      };

      signal.addEventListener("abort", onAbort, { once: true });
    });
  };

  const pause = (signal: AbortSignal): Promise<void> => {
    if (config.pauseMs <= 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, config.pauseMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  };

  let resolveAllDone: (() => void) | null = null;

  const checkDrained = (): void => {
    if (pending.length === 0 && activeCount === 0 && itemsEverSeen) {
      callbacks.onDrained?.();
      if (resolveAllDone) {
        running = false;
        const r = resolveAllDone;
        resolveAllDone = null;
        r();
      }
    }
  };

  const workerLoop = async (signal: AbortSignal): Promise<void> => {
    workerCount++;
    try {
      while (!signal.aborted) {
        // Check if we should exit (excess worker)
        if (workerCount > targetConcurrency) {
          break;
        }

        // Wait for items if pending is empty
        if (pending.length === 0) {
          // Before parking, check if we should drain
          if (activeCount === 0) {
            checkDrained();
            // If drained and stop was called or no more items expected, exit
            if (signal.aborted) break;
          }
          try {
            await waitForItems(signal);
          } catch (e: unknown) {
            if (e instanceof DOMException && e.name === "AbortError") break;
            throw e;
          }
          continue;
        }

        const item = pending.shift()!;
        activeCount++;
        notifyStats();

        try {
          await config.worker(item, signal);
          doneCount++;
          activeCount--;
          notifyStats();
          callbacks.onItemDone?.(item);
        } catch (e: unknown) {
          activeCount--;

          // AbortError exits without counting as failure
          if (e instanceof DOMException && e.name === "AbortError") {
            notifyStats();
            break;
          }

          const errorMsg =
            e instanceof Error ? e.message : String(e);
          // Support immediateDeadLetter: errors with this property bypass retries
          const immediate =
            e != null &&
            typeof e === "object" &&
            "immediateDeadLetter" in e &&
            (e as { immediateDeadLetter: boolean }).immediateDeadLetter;
          const count = immediate
            ? config.maxRetries
            : (failCounts.get(item.id) || 0) + 1;
          failCounts.set(item.id, count);

          callbacks.onItemFailed?.(item, errorMsg, count);

          if (count >= config.maxRetries) {
            deadCount++;
            notifyStats();
            callbacks.onItemDead?.(item, errorMsg);
          } else {
            // Requeue
            pending.push(item);
            notifyStats();
          }
        }

        // Pause between items
        if (!signal.aborted && config.pauseMs > 0) {
          try {
            await pause(signal);
          } catch {
            break;
          }
        }
      }
    } finally {
      workerCount--;
      // When last worker exits and queue is stopped, resolve the start promise
      if (workerCount === 0 && running) {
        running = false;
        checkDrained();
        if (resolveAllDone) {
          resolveAllDone();
          resolveAllDone = null;
        }
      }
    }
  };

  const queue: Queue<T> = {
    get name(): string {
      return config.name;
    },

    get stats(): QueueStats {
      return {
        pending: pending.length,
        active: activeCount,
        done: doneCount,
        dead: deadCount,
      };
    },

    get isRunning(): boolean {
      return running;
    },

    enqueue(items: T[]): void {
      if (items.length > 0) itemsEverSeen = true;
      pending.push(...items);
      notifyStats();
      wake();
    },

    async start(signal: AbortSignal): Promise<void> {
      if (running) return;
      running = true;
      if (pending.length > 0) itemsEverSeen = true;

      // Create internal stop controller that combines with external signal
      stopController = new AbortController();
      const combinedAbort = new AbortController();
      queueSignal = combinedAbort.signal;

      const onExternalAbort = (): void => combinedAbort.abort();
      const onInternalAbort = (): void => combinedAbort.abort();

      signal.addEventListener("abort", onExternalAbort, { once: true });
      stopController.signal.addEventListener("abort", onInternalAbort, {
        once: true,
      });

      return new Promise<void>((resolve) => {
        resolveAllDone = () => {
          signal.removeEventListener("abort", onExternalAbort);
          resolve();
        };

        // Spawn workers
        const combined = combinedAbort.signal;
        for (let i = 0; i < targetConcurrency; i++) {
          workerLoop(combined);
        }
      });
    },

    stop(): void {
      if (stopController) {
        stopController.abort();
        stopController = null;
      }
      // Also wake any parked workers so they can see the abort
      wake();
    },

    setConcurrency(n: number): void {
      const prev = targetConcurrency;
      targetConcurrency = n;
      if (running && queueSignal && n > prev) {
        // Spawn additional workers
        for (let i = 0; i < n - prev; i++) {
          workerLoop(queueSignal);
        }
        // Wake any parked workers
        wake();
      }
      // If decreasing, excess workers will exit after their current item
    },
  };

  return queue;
};
