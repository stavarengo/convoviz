// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { defaultState } from "../../src/state/defaults";
import type { ExportState } from "../../src/types";
import { reconcileExportState } from "../../src/state/reconcile";

const makeState = (overrides?: Partial<ExportState>): ExportState => ({
  ...defaultState(),
  ...overrides,
});

describe("reconcileExportState", () => {
  it("does nothing when IDB conv keys match S.progress.exported", async () => {
    const S = makeState({
      progress: {
        ...defaultState().progress,
        exported: { "conv-1": 100, "conv-2": 200 },
      },
    });
    const getAllConvKeys = vi.fn().mockResolvedValue(["conv-1", "conv-2"]);
    const saveDebounce = vi.fn();
    const addLog = vi.fn();

    await reconcileExportState({ S, getAllConvKeys, saveDebounce, addLog });

    expect(S.progress.exported).toEqual({ "conv-1": 100, "conv-2": 200 });
    expect(saveDebounce).not.toHaveBeenCalled();
  });

  it("adds IDB conv keys missing from S.progress.exported with update_time 0", async () => {
    const S = makeState({
      progress: {
        ...defaultState().progress,
        exported: { "conv-1": 100 },
      },
    });
    const getAllConvKeys = vi.fn().mockResolvedValue(["conv-1", "conv-2", "conv-3"]);
    const saveDebounce = vi.fn();
    const addLog = vi.fn();

    await reconcileExportState({ S, getAllConvKeys, saveDebounce, addLog });

    expect(S.progress.exported).toEqual({
      "conv-1": 100,
      "conv-2": 0,
      "conv-3": 0,
    });
    expect(saveDebounce).toHaveBeenCalledWith(true);
  });

  it("removes reconciled keys from S.progress.pending", async () => {
    const S = makeState({
      progress: {
        ...defaultState().progress,
        exported: {},
        pending: [
          { id: "conv-1", title: "C1", update_time: 50, gizmo_id: null },
          { id: "conv-2", title: "C2", update_time: 60, gizmo_id: null },
          { id: "conv-3", title: "C3", update_time: 70, gizmo_id: null },
        ],
      },
    });
    const getAllConvKeys = vi.fn().mockResolvedValue(["conv-1", "conv-3"]);
    const saveDebounce = vi.fn();
    const addLog = vi.fn();

    await reconcileExportState({ S, getAllConvKeys, saveDebounce, addLog });

    expect(S.progress.exported).toEqual({
      "conv-1": 50,
      "conv-3": 70,
    });
    expect(S.progress.pending).toEqual([
      { id: "conv-2", title: "C2", update_time: 60, gizmo_id: null },
    ]);
  });

  it("logs the number of reconciled conversations", async () => {
    const S = makeState({
      progress: {
        ...defaultState().progress,
        exported: { "conv-1": 100 },
      },
    });
    const getAllConvKeys = vi.fn().mockResolvedValue(["conv-1", "conv-2"]);
    const saveDebounce = vi.fn();
    const addLog = vi.fn();

    await reconcileExportState({ S, getAllConvKeys, saveDebounce, addLog });

    expect(addLog).toHaveBeenCalled();
    const msg = addLog.mock.calls.find((c: string[]) => c[0].includes("1"));
    expect(msg).toBeDefined();
  });

  it("does nothing when IDB is empty", async () => {
    const S = makeState({
      progress: {
        ...defaultState().progress,
        exported: { "conv-1": 100 },
      },
    });
    const getAllConvKeys = vi.fn().mockResolvedValue([]);
    const saveDebounce = vi.fn();
    const addLog = vi.fn();

    await reconcileExportState({ S, getAllConvKeys, saveDebounce, addLog });

    expect(S.progress.exported).toEqual({ "conv-1": 100 });
    expect(saveDebounce).not.toHaveBeenCalled();
  });

  it("does nothing when IDB keys and exported are both empty", async () => {
    const S = makeState();
    const getAllConvKeys = vi.fn().mockResolvedValue([]);
    const saveDebounce = vi.fn();
    const addLog = vi.fn();

    await reconcileExportState({ S, getAllConvKeys, saveDebounce, addLog });

    expect(S.progress.exported).toEqual({});
    expect(saveDebounce).not.toHaveBeenCalled();
  });

  it("uses update_time from pending item when reconciling", async () => {
    const S = makeState({
      progress: {
        ...defaultState().progress,
        exported: {},
        pending: [
          { id: "conv-1", title: "C1", update_time: 12345, gizmo_id: null },
        ],
      },
    });
    const getAllConvKeys = vi.fn().mockResolvedValue(["conv-1"]);
    const saveDebounce = vi.fn();
    const addLog = vi.fn();

    await reconcileExportState({ S, getAllConvKeys, saveDebounce, addLog });

    expect(S.progress.exported).toEqual({ "conv-1": 12345 });
    expect(S.progress.pending).toEqual([]);
  });
});
