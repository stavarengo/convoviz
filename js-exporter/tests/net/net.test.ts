// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExportState } from "../../src/types";
import { defaultState } from "../../src/state/defaults";

function makeState(): ExportState {
  return defaultState();
}

function makeDeps(overrides?: Partial<{ S: ExportState; addLog: (msg: string) => void; setStatus: (msg: string) => void; saveDebounce: (immediate: boolean) => void }>) {
  return {
    S: overrides?.S ?? makeState(),
    addLog: overrides?.addLog ?? vi.fn(),
    setStatus: overrides?.setStatus ?? vi.fn(),
    saveDebounce: overrides?.saveDebounce ?? vi.fn(),
  };
}

describe("Net", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  describe("getToken", () => {
    it("fetches from /api/auth/session and caches the token", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: "tok-123" }),
      });

      const token = await net.getToken();
      expect(token).toBe("tok-123");
      expect(net.token).toBe("tok-123");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/auth/session");
    });

    it("deduplicates concurrent getToken calls", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: "tok-456" }),
      });

      const [t1, t2] = await Promise.all([net.getToken(), net.getToken()]);
      expect(t1).toBe("tok-456");
      expect(t2).toBe("tok-456");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("throws when session fetch fails", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(net.getToken()).rejects.toThrow("Session fetch failed");
    });

    it("throws when no accessToken in response", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(net.getToken()).rejects.toThrow("No accessToken");
    });
  });

  describe("_fetch", () => {
    it("adds Authorization header when auth is not false", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "pre-set-token";

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await net._fetch("/api/test", {});
      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = callArgs[1].headers as Headers;
      expect(headers.get("Authorization")).toBe("Bearer pre-set-token");
    });

    it("retries on 429 with backoff", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "tok";

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ "retry-after": "1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        });

      const promise = net._fetch("/api/test", {});
      // Wait for the sleep (retry-after: 1 → 1000ms, jittered 850-1150ms)
      await vi.advanceTimersByTimeAsync(2000);
      const resp = await promise;
      expect(resp.ok).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("respects abort signal", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "tok";

      const controller = new AbortController();
      controller.abort();

      await expect(
        net._fetch("/api/test", { signal: controller.signal }),
      ).rejects.toThrow("Aborted");
    });

    it("refreshes token on 401", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "old-tok";

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ accessToken: "new-tok" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        });

      const resp = await net._fetch("/api/test", {});
      expect(resp.ok).toBe(true);
      expect(net.token).toBe("new-tok");
    });

    it("retries on 502/503/504 up to 3 times", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "tok";

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          text: async () => "bad gateway",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => "unavailable",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 504,
          text: async () => "timeout",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        });

      const promise = net._fetch("/api/test", {});
      // Advance through retry sleeps: 1s, 2s, 3s
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(3000);
      const resp = await promise;
      expect(resp.ok).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    });

    it("throws after exhausting 502/503/504 retries", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "tok";

      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 502, text: async () => "err" })
        .mockResolvedValueOnce({ ok: false, status: 502, text: async () => "err" })
        .mockResolvedValueOnce({ ok: false, status: 502, text: async () => "err" })
        .mockResolvedValueOnce({ ok: false, status: 502, text: async () => "err" });

      const promise = net._fetch("/api/test", {}).catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(3000);
      const err = await promise;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("HTTP 502");
    });

    it("throws after 10 consecutive 429s", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "tok";

      const mock429 = () => ({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "0.1" }),
      });

      globalThis.fetch = vi.fn();
      for (let i = 0; i < 10; i++) {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mock429());
      }

      const promise = net._fetch("/api/test", {}).catch((e: Error) => e);
      // Advance through all retries
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }
      const err = await promise;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("Rate limit exceeded");
    });

    it("resets backoff state on successful response", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      deps.S.run.backoffCount = 5;
      deps.S.run.backoffUntil = Date.now() + 10000;
      const net = createNet(deps);
      net.token = "tok";

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await net._fetch("/api/test", {});
      expect(deps.S.run.backoffCount).toBe(0);
      expect(deps.S.run.backoffUntil).toBe(0);
    });

    it("skips auth header when auth is false", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await net._fetch("/api/test", { auth: false });
      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = callArgs[1].headers as Headers;
      expect(headers.has("Authorization")).toBe(false);
    });
  });

  describe("fetchJson", () => {
    it("parses response as JSON", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "tok";

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [1, 2, 3] }),
      });

      const result = await net.fetchJson("/api/data", {});
      expect(result).toEqual({ data: [1, 2, 3] });
    });

    it("defaults credentials to same-origin", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "tok";

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await net.fetchJson("/api/data", {});
      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1].credentials).toBe("same-origin");
    });
  });

  describe("fetchBlob", () => {
    it("returns response as Blob", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "tok";

      const blob = new Blob(["hello"]);
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => blob,
      });

      const result = await net.fetchBlob("/files/1", {});
      expect(result).toBe(blob);
    });

    it("defaults credentials to omit", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);
      net.token = "tok";

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => new Blob(),
      });

      await net.fetchBlob("/files/1", {});
      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1].credentials).toBe("omit");
    });
  });

  describe("download", () => {
    it("creates and clicks a temporary anchor element", async () => {
      const { createNet } = await import("../../src/net/net");
      const deps = makeDeps();
      const net = createNet(deps);

      const blob = new Blob(["test content"]);
      const mockUrl = "blob:http://localhost/test-uuid";

      const origCreateObjectURL = URL.createObjectURL;
      const origRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn().mockReturnValue(mockUrl);
      URL.revokeObjectURL = vi.fn();

      const clickSpy = vi.fn();
      const removeSpy = vi.fn();
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        if (tag === "a") {
          const a = origCreateElement("a") as HTMLAnchorElement;
          a.click = clickSpy;
          a.remove = removeSpy;
          return a;
        }
        return origCreateElement(tag);
      });

      net.download(blob, "test.zip");

      expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
      expect(clickSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();

      // Revoke should happen after timeout
      vi.advanceTimersByTime(10000);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(mockUrl);

      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    });
  });
});
