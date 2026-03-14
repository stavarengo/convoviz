import type { ExportState } from "../types";
import { now } from "../utils/format";
import { fmtMs } from "../utils/format";
import { sleep } from "./sleep";

export interface FetchOpts {
  method?: string;
  auth?: boolean;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  headers?: HeadersInit;
}

export interface NetDeps {
  S: ExportState;
  addLog: (msg: string) => void;
  setStatus: (msg: string) => void;
  saveDebounce: (immediate: boolean) => void;
}

export interface Net {
  token: string;
  _tokenPromise: Promise<string> | null;
  _consecutive429: number;
  getToken(signal?: AbortSignal): Promise<string>;
  _fetch(url: string, opts: FetchOpts): Promise<Response>;
  fetchJson(url: string, opts?: FetchOpts): Promise<unknown>;
  fetchBlob(url: string, opts?: FetchOpts): Promise<Blob>;
  download(blob: Blob, name: string): void;
}

export const createNet = (deps: NetDeps): Net => {
  const { S, addLog, setStatus, saveDebounce } = deps;

  const net: Net = {
    token: "",
    _tokenPromise: null,
    _consecutive429: 0,

    async getToken(signal?: AbortSignal): Promise<string> {
      if (net._tokenPromise) return net._tokenPromise;
      net._tokenPromise = (async () => {
        const resp = await fetch("/api/auth/session", {
          credentials: "same-origin",
          signal,
        });
        if (!resp.ok)
          throw new Error("Session fetch failed: HTTP " + resp.status);
        const js = await resp.json();
        if (!js || !js.accessToken)
          throw new Error("No accessToken in /api/auth/session response");
        net.token = js.accessToken;
        return net.token;
      })().finally(() => {
        net._tokenPromise = null;
      });
      return net._tokenPromise;
    },

    async _fetch(url: string, opts: FetchOpts): Promise<Response> {
      const auth = opts.auth !== false;
      const signal = opts.signal;
      const credentials = opts.credentials || "same-origin";
      const headers = new Headers(opts.headers || {});
      if (auth) {
        if (!net.token) await net.getToken(signal);
        headers.set("Authorization", "Bearer " + net.token);
      }
      let attempt = 0;
      while (true) {
        if (signal && signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        const resp = await fetch(url, {
          method: opts.method || "GET",
          credentials,
          headers,
          signal,
        });
        if (resp.status === 401 && auth && attempt < 1) {
          addLog("Auth 401, refreshing token\u2026");
          await net.getToken(signal);
          headers.set("Authorization", "Bearer " + net.token);
          attempt++;
          continue;
        }
        if (resp.status === 429) {
          net._consecutive429++;
          if (net._consecutive429 >= 10) {
            throw new Error(
              "Rate limit exceeded after 10 retries \u2014 try again later",
            );
          }
          const ra = resp.headers.get("retry-after");
          let waitMs = ra
            ? Math.max(1, parseFloat(ra)) * 1000
            : Math.min(
                120000,
                10000 * Math.pow(1.6, Math.max(0, S.run.backoffCount || 0)),
              );
          waitMs = Math.floor(waitMs * (0.85 + Math.random() * 0.3));
          S.run.backoffUntil = now() + waitMs;
          S.run.backoffCount = (S.run.backoffCount || 0) + 1;
          saveDebounce(true);
          setStatus("Rate limited (429) \u2192 sleeping " + fmtMs(waitMs));
          addLog(
            "HTTP 429. Sleeping " + fmtMs(waitMs) + " then retrying\u2026",
          );
          await sleep(waitMs, signal);
          continue;
        }
        if (resp.ok) {
          net._consecutive429 = 0;
          if (S.run.backoffCount) {
            S.run.backoffCount = 0;
            S.run.backoffUntil = 0;
            saveDebounce(false);
          }
          return resp;
        }
        const txt = await resp.text().catch(() => "");
        if ([502, 503, 504].includes(resp.status) && attempt < 3) {
          attempt++;
          const w = 1000 * attempt;
          addLog(
            "HTTP " + resp.status + " retrying in " + fmtMs(w) + "\u2026",
          );
          await sleep(w, signal);
          continue;
        }
        throw new Error(
          "HTTP " + resp.status + " " + (txt ? txt.slice(0, 200) : ""),
        );
      }
    },

    async fetchJson(url: string, opts?: FetchOpts): Promise<unknown> {
      const o = opts || {};
      if (!o.credentials) o.credentials = "same-origin";
      const resp = await net._fetch(url, o);
      return resp.json();
    },

    async fetchBlob(url: string, opts?: FetchOpts): Promise<Blob> {
      const o = opts || {};
      if (!o.credentials) o.credentials = "omit";
      const resp = await net._fetch(url, o);
      return resp.blob();
    },

    download(blob: Blob, name: string): void {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  };

  return net;
};
