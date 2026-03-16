import type { EventMap } from "./types";

type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void;

export interface EventBus {
  on<K extends keyof EventMap>(event: K, listener: Listener<K>): () => void;
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
  off<K extends keyof EventMap>(event: K, listener: Listener<K>): void;
  clear(): void;
}

export function createEventBus(
  onError?: (event: keyof EventMap, err: unknown) => void,
): EventBus {
  const listeners = new Map<keyof EventMap, Array<Listener<never>>>();

  function getListeners<K extends keyof EventMap>(
    event: K,
  ): Array<Listener<K>> {
    let arr = listeners.get(event);
    if (!arr) {
      arr = [];
      listeners.set(event, arr);
    }
    return arr as Array<Listener<K>>;
  }

  return {
    on<K extends keyof EventMap>(event: K, listener: Listener<K>): () => void {
      const arr = getListeners(event);
      arr.push(listener);
      return () => {
        this.off(event, listener);
      };
    },

    emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
      const arr = listeners.get(event);
      if (!arr) return;
      for (const fn of [...arr]) {
        try {
          (fn as Listener<K>)(payload);
        } catch (err) {
          if (onError) onError(event, err);
        }
      }
    },

    off<K extends keyof EventMap>(event: K, listener: Listener<K>): void {
      const arr = listeners.get(event);
      if (!arr) return;
      const idx = arr.indexOf(listener as Listener<never>);
      if (idx !== -1) arr.splice(idx, 1);
    },

    clear(): void {
      listeners.clear();
    },
  };
}
