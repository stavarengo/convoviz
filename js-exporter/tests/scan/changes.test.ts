import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeChanges } from "../../src/scan/changes";
import type { PendingItem } from "../../src/types";

describe("computeChanges", () => {
  const makeItem = (
    id: string,
    update_time: number,
  ): { id: string; update_time: number } => ({
    id,
    update_time,
  });

  const makePending = (id: string): PendingItem => ({
    id,
    title: id,
    update_time: 0,
    gizmo_id: null,
  });

  it("detects new chats (present in items, absent from prevSnap)", () => {
    const prevSnap: [string, number][] = [["a", 100]];
    const items = [makeItem("a", 100), makeItem("b", 200)];
    const result = computeChanges(prevSnap, items, [], []);
    expect(result.newChats).toBe(1);
  });

  it("detects removed chats (present in prevSnap, absent from items)", () => {
    const prevSnap: [string, number][] = [
      ["a", 100],
      ["b", 200],
    ];
    const items = [makeItem("a", 100)];
    const result = computeChanges(prevSnap, items, [], []);
    expect(result.removedChats).toBe(1);
  });

  it("detects updated chats (present in both, different update_time)", () => {
    const prevSnap: [string, number][] = [
      ["a", 100],
      ["b", 200],
    ];
    const items = [makeItem("a", 150), makeItem("b", 200)];
    const result = computeChanges(prevSnap, items, [], []);
    expect(result.updatedChats).toBe(1);
  });

  it("does not count as updated if both times are 0", () => {
    const prevSnap: [string, number][] = [["a", 0]];
    const items = [makeItem("a", 0)];
    const result = computeChanges(prevSnap, items, [], []);
    expect(result.updatedChats).toBe(0);
  });

  it("handles null/undefined prevSnap as empty array", () => {
    const items = [makeItem("a", 100), makeItem("b", 200)];
    const result = computeChanges(
      null as unknown as [string, number][],
      items,
      [],
      [],
    );
    expect(result.newChats).toBe(2);
    expect(result.removedChats).toBe(0);
    expect(result.updatedChats).toBe(0);
  });

  it("computes correct pending delta", () => {
    const oldPending = [makePending("x"), makePending("y")];
    const freshPending = [
      makePending("x"),
      makePending("y"),
      makePending("z"),
    ];
    const result = computeChanges([], [], freshPending, oldPending);
    expect(result.pendingDelta).toBe(1); // 3 - 2
  });

  it("computes newPending count correctly", () => {
    const oldPending = [makePending("x")];
    const freshPending = [makePending("x"), makePending("y")];
    const result = computeChanges([], [], freshPending, oldPending);
    expect(result.newPending).toBe(1); // y is new
  });

  it("returns zero counts when nothing changed", () => {
    const prevSnap: [string, number][] = [
      ["a", 100],
      ["b", 200],
    ];
    const items = [makeItem("a", 100), makeItem("b", 200)];
    const oldPending = [makePending("a")];
    const freshPending = [makePending("a")];
    const result = computeChanges(prevSnap, items, freshPending, oldPending);
    expect(result.newChats).toBe(0);
    expect(result.removedChats).toBe(0);
    expect(result.updatedChats).toBe(0);
    expect(result.newPending).toBe(0);
    expect(result.pendingDelta).toBe(0);
  });

  it("includes timestamp in result", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234567890);
    const result = computeChanges([], [], [], []);
    expect(result.at).toBe(1234567890);
    vi.restoreAllMocks();
  });
});
