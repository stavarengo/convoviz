import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSaveDebounce } from "../../src/state/debounce";
import type { ExportState } from "../../src/types";

describe("createSaveDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeMockStore = () => ({
    save: vi.fn<(st: ExportState) => Promise<void>>().mockResolvedValue(undefined),
  });

  const makeMockState = () =>
    ({ v: 3, ver: "test" }) as unknown as ExportState;

  it("immediate=true saves synchronously and clears pending timer", () => {
    const store = makeMockStore();
    const state = makeMockState();
    const save = createSaveDebounce(store, state);

    save(true);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith(state);
  });

  it("immediate=false debounces and saves after 250ms", () => {
    const store = makeMockStore();
    const state = makeMockState();
    const save = createSaveDebounce(store, state);

    save(false);
    expect(store.save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith(state);
  });

  it("multiple non-immediate calls within 250ms only trigger one save", () => {
    const store = makeMockStore();
    const state = makeMockState();
    const save = createSaveDebounce(store, state);

    save(false);
    save(false);
    save(false);
    expect(store.save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("immediate=true cancels a pending debounced save", () => {
    const store = makeMockStore();
    const state = makeMockState();
    const save = createSaveDebounce(store, state);

    // Schedule a debounced save
    save(false);
    expect(store.save).not.toHaveBeenCalled();

    // Immediate save should cancel the debounced one and save now
    save(true);
    expect(store.save).toHaveBeenCalledTimes(1);

    // Advancing time should NOT trigger another save (the timer was cleared)
    vi.advanceTimersByTime(500);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("after debounced save fires, a new non-immediate call schedules again", () => {
    const store = makeMockStore();
    const state = makeMockState();
    const save = createSaveDebounce(store, state);

    save(false);
    vi.advanceTimersByTime(250);
    expect(store.save).toHaveBeenCalledTimes(1);

    // Another debounced save
    save(false);
    vi.advanceTimersByTime(250);
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it("saves the current state reference (captures mutations)", () => {
    const store = makeMockStore();
    const state = { v: 3, ver: "initial" } as unknown as ExportState;
    const save = createSaveDebounce(store, state);

    // Mutate state before the debounced save fires
    (state as any).ver = "mutated";
    save(false);
    vi.advanceTimersByTime(250);

    // It should save the mutated state object (same reference)
    expect(store.save).toHaveBeenCalledWith(state);
    expect((store.save.mock.calls[0][0] as ExportState).ver).toBe("mutated");
  });
});
