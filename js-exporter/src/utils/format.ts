export const now = (): number => Date.now();

export const clamp = (n: number, a: number, b: number): number =>
  Math.max(a, Math.min(b, n));

export const safeJsonParse = <T>(s: string, fb: T): T => {
  try {
    return JSON.parse(s);
  } catch {
    return fb;
  }
};

export const fmtMs = (ms: number): string => {
  if (!ms || ms < 0 || !isFinite(ms)) return "-";
  let s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  const p: string[] = [];
  if (h) p.push(h + "h");
  if (m || h) p.push(m + "m");
  p.push(s + "s");
  return p.join(" ");
};

export const fmtTs = (ts: number | string): string => {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
};
