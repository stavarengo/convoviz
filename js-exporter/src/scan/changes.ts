import type { Changes, PendingItem } from "../types";
import { now } from "../utils/format";

export const computeChanges = (
  prevSnap: [string, number][] | null | undefined,
  items: { id: string; update_time: number }[],
  freshPending: PendingItem[],
  oldPending: PendingItem[],
): Changes => {
  const snap = Array.isArray(prevSnap) ? prevSnap : [];
  const prevSet = new Set(snap.map((x) => x[0]));
  const prevTime = new Map(snap.map((x) => [x[0], x[1] || 0]));
  const curTime = new Map(items.map((x) => [x.id, x.update_time || 0]));
  let newChats = 0,
    removedChats = 0,
    updatedChats = 0;
  for (const it of items) {
    if (!prevSet.has(it.id)) newChats++;
  }
  for (const id of prevSet) {
    if (!curTime.has(id)) removedChats++;
  }
  for (const [id, t1] of curTime) {
    if (prevSet.has(id)) {
      const t0 = prevTime.get(id) || 0;
      if (t0 && t1 && t0 !== t1) updatedChats++;
    }
  }
  const oldPendingIds = new Set((oldPending || []).map((x) => x.id));
  let newPending = 0;
  for (const it of freshPending) if (!oldPendingIds.has(it.id)) newPending++;
  const pendingDelta = freshPending.length - (oldPending || []).length;
  return {
    at: now(),
    newChats,
    removedChats,
    updatedChats,
    newPending,
    pendingDelta,
  };
};
