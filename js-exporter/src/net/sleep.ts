export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((res, rej) => {
    if (signal && signal.aborted)
      return rej(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => {
      cleanup();
      res();
    }, ms);
    const onAbort = () => {
      cleanup();
      rej(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", onAbort);
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
