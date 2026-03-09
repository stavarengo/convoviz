import type { ExportState } from "../types";

interface StoreLike {
  save(st: ExportState): Promise<void>;
}

export const createSaveDebounce = (
  store: StoreLike,
  state: ExportState,
): ((immediate: boolean) => void) => {
  let t: ReturnType<typeof setTimeout> | 0 = 0;
  return (immediate: boolean) => {
    if (immediate) {
      if (t) {
        clearTimeout(t);
        t = 0;
      }
      store.save(state);
      return;
    }
    if (t) return;
    t = setTimeout(() => {
      t = 0;
      store.save(state);
    }, 250);
  };
};
