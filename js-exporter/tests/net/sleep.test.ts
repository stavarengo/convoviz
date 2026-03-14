import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after specified delay", async () => {
    const { sleep } = await import("../../src/net/sleep");
    const resolved = vi.fn();
    const p = sleep(1000).then(resolved);
    expect(resolved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(resolved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await p;
    expect(resolved).toHaveBeenCalled();
  });

  it("rejects immediately if signal is already aborted", async () => {
    const { sleep } = await import("../../src/net/sleep");
    const controller = new AbortController();
    controller.abort();
    await expect(sleep(1000, controller.signal)).rejects.toThrow("Aborted");
  });

  it("rejects with AbortError when signal is aborted during sleep", async () => {
    const { sleep } = await import("../../src/net/sleep");
    const controller = new AbortController();
    const p = sleep(5000, controller.signal);
    vi.advanceTimersByTime(1000);
    controller.abort();
    await expect(p).rejects.toThrow("Aborted");
  });

  it("cleans up timeout when aborted", async () => {
    const { sleep } = await import("../../src/net/sleep");
    const controller = new AbortController();
    const p = sleep(5000, controller.signal);
    controller.abort();
    await expect(p).rejects.toThrow("Aborted");
    // Timer should be cleaned up; advancing should not cause issues
    vi.advanceTimersByTime(10000);
  });

  it("resolves with undefined", async () => {
    const { sleep } = await import("../../src/net/sleep");
    const p = sleep(100);
    vi.advanceTimersByTime(100);
    const result = await p;
    expect(result).toBeUndefined();
  });
});
