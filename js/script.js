javascript: (async () => {
  try {
    const KEY = "__cvz_export_state_v1__";
    const VER = "cvz-bookmarklet-2.0";
    const now = () => Date.now();
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const safeJsonParse = (s, fb) => {
      try {
        return JSON.parse(s);
      } catch (e) {
        return fb;
      }
    };
    const fmtMs = (ms) => {
      if (!ms || ms < 0 || !isFinite(ms)) return "-";
      let s = Math.round(ms / 1000);
      const h = Math.floor(s / 3600);
      s %= 3600;
      const m = Math.floor(s / 60);
      s %= 60;
      const p = [];
      if (h) p.push(h + "h");
      if (m || h) p.push(m + "m");
      p.push(s + "s");
      return p.join(" ");
    };
    const fmtTs = (ts) => {
      if (!ts) return "-";
      try {
        return new Date(ts).toLocaleString();
      } catch (e) {
        return String(ts);
      }
    };
    const enc = (str) => new TextEncoder().encode(str);
    const sanitizeName = (name) => {
      name = String(name || "file").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\/\\?%*:|"<>]/g, "_");
      name = name.replace(/\s+/g, " ").trim();
      if (!name) name = "file";
      if (name.length > 180) name = name.slice(0, 180);
      return name;
    };
    const crcTable = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
      }
      return t;
    })();
    const crc32 = (u8) => {
      let c = 0xFFFFFFFF;
      for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    };
    const dosTimeDate = (d) => {
      d = d || new Date();
      let time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
      let date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | ((d.getDate()) & 31);
      return {
        time: time & 0xFFFF,
        date: date & 0xFFFF
      };
    };
    const u16 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255]);
    const u32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
    class ZipLite {
      constructor() {
        this.files = [];
      }
      addBytes(name, u8) {
        this.files.push({
          name: String(name),
          u8: (u8 instanceof Uint8Array) ? u8 : new Uint8Array(u8)
        });
      }
      async addBlob(name, blob) {
        const ab = await blob.arrayBuffer();
        this.addBytes(name, new Uint8Array(ab));
      }
      buildBlob() {
        const td = dosTimeDate(new Date());
        const chunks = [],
          central = [];
        let offset = 0;
        for (const f of this.files) {
          const nameBytes = enc(f.name);
          const data = f.u8;
          const crc = crc32(data);
          const size = data.length >>> 0;
          const flags = 0x0800;
          const localHdr = new Uint8Array(30 + nameBytes.length);
          let p = 0;
          localHdr.set([0x50, 0x4b, 0x03, 0x04], p);
          p += 4;
          localHdr.set(u16(20), p);
          p += 2;
          localHdr.set(u16(flags), p);
          p += 2;
          localHdr.set(u16(0), p);
          p += 2;
          localHdr.set(u16(td.time), p);
          p += 2;
          localHdr.set(u16(td.date), p);
          p += 2;
          localHdr.set(u32(crc), p);
          p += 4;
          localHdr.set(u32(size), p);
          p += 4;
          localHdr.set(u32(size), p);
          p += 4;
          localHdr.set(u16(nameBytes.length), p);
          p += 2;
          localHdr.set(u16(0), p);
          p += 2;
          localHdr.set(nameBytes, p);
          chunks.push(localHdr, data);
          const cHdr = new Uint8Array(46 + nameBytes.length);
          p = 0;
          cHdr.set([0x50, 0x4b, 0x01, 0x02], p);
          p += 4;
          cHdr.set(u16(20), p);
          p += 2;
          cHdr.set(u16(20), p);
          p += 2;
          cHdr.set(u16(flags), p);
          p += 2;
          cHdr.set(u16(0), p);
          p += 2;
          cHdr.set(u16(td.time), p);
          p += 2;
          cHdr.set(u16(td.date), p);
          p += 2;
          cHdr.set(u32(crc), p);
          p += 4;
          cHdr.set(u32(size), p);
          p += 4;
          cHdr.set(u32(size), p);
          p += 4;
          cHdr.set(u16(nameBytes.length), p);
          p += 2;
          cHdr.set(u16(0), p);
          p += 2;
          cHdr.set(u16(0), p);
          p += 2;
          cHdr.set(u16(0), p);
          p += 2;
          cHdr.set(u16(0), p);
          p += 2;
          cHdr.set(u32(0), p);
          p += 4;
          cHdr.set(u32(offset), p);
          p += 4;
          cHdr.set(nameBytes, p);
          central.push(cHdr);
          offset += localHdr.length + data.length;
        }
        const centralStart = offset;
        let centralSize = 0;
        for (const c of central) centralSize += c.length;
        const end = new Uint8Array(22);
        let p = 0;
        end.set([0x50, 0x4b, 0x05, 0x06], p);
        p += 4;
        end.set(u16(0), p);
        p += 2;
        end.set(u16(0), p);
        p += 2;
        end.set(u16(this.files.length), p);
        p += 2;
        end.set(u16(this.files.length), p);
        p += 2;
        end.set(u32(centralSize), p);
        p += 4;
        end.set(u32(centralStart), p);
        p += 4;
        end.set(u16(0), p);
        return new Blob([...chunks, ...central, end], {
          type: "application/zip"
        });
      }
    }
    const defaultState = () => ({
      v: 1,
      ver: VER,
      settings: {
        batch: 50,
        conc: 3,
        pause: 300,
        autoRescan: true
      },
      progress: {
        exported: [],
        pending: [],
        dead: [],
        failCounts: {}
      },
      scan: {
        at: 0,
        total: 0,
        snapshot: []
      },
      stats: {
        batches: 0,
        batchMs: 0,
        chats: 0
      },
      run: {
        isRunning: false,
        startedAt: 0,
        stoppedAt: 0,
        lastError: "",
        backoffUntil: 0,
        backoffCount: 0,
        lastPhase: "idle"
      },
      changes: {
        at: 0,
        newChats: 0,
        removedChats: 0,
        updatedChats: 0,
        newPending: 0,
        pendingDelta: 0
      },
      logs: []
    });
    const mergeState = (s) => {
      if (!s || !s.v) return defaultState();
      const d = defaultState();
      const out = {
        ...d,
        ...s
      };
      out.settings = {
        ...d.settings,
        ...(s.settings || {})
      };
      out.progress = {
        ...d.progress,
        ...(s.progress || {})
      };
      out.progress.failCounts = {
        ...(d.progress.failCounts || {}),
        ...((s.progress || {}).failCounts || {})
      };
      out.scan = {
        ...d.scan,
        ...(s.scan || {})
      };
      out.stats = {
        ...d.stats,
        ...(s.stats || {})
      };
      out.run = {
        ...d.run,
        ...(s.run || {})
      };
      out.changes = {
        ...d.changes,
        ...(s.changes || {})
      };
      out.logs = Array.isArray(s.logs) ? s.logs.slice(-200) : [];
      return out;
    };
    const IDB_NAME = "cvz-export";
    const IDB_STORE = "state";
    const IDB_KEY = "state";
    const openIdb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    let _idb = null;
    let _useLocalStorage = false;
    const initIdb = async () => {
      try {
        _idb = await openIdb();
      } catch (e) {
        console.warn("convoviz: IndexedDB unavailable, falling back to localStorage", e);
        _useLocalStorage = true;
      }
    };
    const idbGet = (db) => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    const idbPut = (db, val) => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(val, IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    const idbDelete = (db) => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const req = store.delete(IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    const Store = {
      async load() {
        if (_useLocalStorage) {
          const raw = localStorage.getItem(KEY);
          return mergeState(raw ? safeJsonParse(raw, null) : null);
        }
        if (!_idb) return defaultState();
        try {
          const s = await idbGet(_idb);
          return mergeState(s);
        } catch (e) {
          console.warn("convoviz: failed to load from IndexedDB", e);
          return defaultState();
        }
      },
      async save(st) {
        if (_useLocalStorage) {
          try {
            localStorage.setItem(KEY, JSON.stringify(st));
          } catch (e) {
            console.warn("convoviz: failed to save state to localStorage", e);
          }
          return;
        }
        if (!_idb) return;
        try {
          await idbPut(_idb, st);
        } catch (e) {
          console.warn("convoviz: failed to save state to IndexedDB", e);
        }
      },
      async reset() {
        if (_useLocalStorage) {
          localStorage.removeItem(KEY);
          return;
        }
        if (!_idb) return;
        try {
          await idbDelete(_idb);
        } catch (e) {
          console.warn("convoviz: failed to reset IndexedDB state", e);
        }
      }
    };
    await initIdb();
    let S = await Store.load();
    const saveDebounce = (() => {
      let t = 0;
      return (immediate) => {
        if (immediate) {
          if (t) {
            clearTimeout(t);
            t = 0;
          }
          Store.save(S);
          return;
        }
        if (t) return;
        t = setTimeout(() => {
          t = 0;
          Store.save(S);
        }, 250);
      };
    })();
    let UI = null;
    let _exporter = null;
    const addLog = (msg) => {
      const stamp = new Date().toLocaleTimeString();
      const line = "[" + stamp + "] " + msg;
      S.logs.push(line);
      if (S.logs.length > 200) S.logs = S.logs.slice(-200);
      saveDebounce(false);
      if (UI) UI.renderLogs();
    };
    const assertOnChatGPT = () => {
      const h = location.hostname || "";
      if (!/chatgpt\.com$/.test(h) && !/chat\.openai\.com$/.test(h)) throw new Error("Run this on chatgpt.com (logged in). Host: " + h);
    };
    const sleep = (ms, signal) => new Promise((res, rej) => {
      if (signal && signal.aborted) return rej(new DOMException("Aborted", "AbortError"));
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
      if (signal) signal.addEventListener("abort", onAbort, {
        once: true
      });
    });
    const Net = {
      token: "",
      _tokenPromise: null,
      _consecutive429: 0,
      async getToken(signal) {
        if (this._tokenPromise) return this._tokenPromise;
        this._tokenPromise = (async () => {
          const resp = await fetch("/api/auth/session", {
            credentials: "same-origin",
            signal
          });
          if (!resp.ok) throw new Error("Session fetch failed: HTTP " + resp.status);
          const js = await resp.json();
          if (!js || !js.accessToken) throw new Error("No accessToken in /api/auth/session response");
          this.token = js.accessToken;
          return this.token;
        })().finally(() => { this._tokenPromise = null; });
        return this._tokenPromise;
      },
      async _fetch(url, opts) {
        opts = opts || {};
        const auth = opts.auth !== false;
        const signal = opts.signal;
        const credentials = opts.credentials || "same-origin";
        const headers = new Headers(opts.headers || {});
        if (auth) {
          if (!this.token) await this.getToken(signal);
          headers.set("Authorization", "Bearer " + this.token);
        }
        let attempt = 0;
        while (true) {
          if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
          const resp = await fetch(url, {
            method: opts.method || "GET",
            credentials,
            headers,
            signal
          });
          if (resp.status === 401 && auth && attempt < 1) {
            addLog("Auth 401, refreshing token…");
            await this.getToken(signal);
            headers.set("Authorization", "Bearer " + this.token);
            attempt++;
            continue;
          }
          if (resp.status === 429) {
            this._consecutive429++;
            if (this._consecutive429 >= 10) {
              throw new Error("Rate limit exceeded after 10 retries — try again later");
            }
            const ra = resp.headers.get("retry-after");
            let waitMs = ra ? Math.max(1, parseFloat(ra)) * 1000 : Math.min(120000, 10000 * Math.pow(1.6, Math.max(0, S.run.backoffCount || 0)));
            waitMs = Math.floor(waitMs * (0.85 + Math.random() * 0.3));
            S.run.backoffUntil = now() + waitMs;
            S.run.backoffCount = (S.run.backoffCount || 0) + 1;
            saveDebounce(true);
            if (UI) UI.setStatus("Rate limited (429) → sleeping " + fmtMs(waitMs));
            addLog("HTTP 429. Sleeping " + fmtMs(waitMs) + " then retrying…");
            await sleep(waitMs, signal);
            continue;
          }
          if (resp.ok) {
            this._consecutive429 = 0;
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
            addLog("HTTP " + resp.status + " retrying in " + fmtMs(w) + "…");
            await sleep(w, signal);
            continue;
          }
          throw new Error("HTTP " + resp.status + " " + (txt ? txt.slice(0, 200) : ""));
        }
      },
      async fetchJson(url, opts) {
        opts = opts || {};
        if (!opts.credentials) opts.credentials = "same-origin";
        const resp = await this._fetch(url, opts);
        return resp.json();
      },
      async fetchBlob(url, opts) {
        opts = opts || {};
        if (!opts.credentials) opts.credentials = "omit";
        const resp = await this._fetch(url, opts);
        return resp.blob();
      },
      download(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    };
    const UIImpl = {
      container: null,
      inject() {
        const existing = document.getElementById("cvz-resume-ui");
        if (existing) {
          this.container = existing;
          existing.style.display = "block";
          return;
        }
        const d = document.createElement("div");
        d.id = "cvz-resume-ui";
        d.style = "position:fixed;top:20px;right:20px;width:380px;max-width:calc(100vw - 40px);background:rgba(32,33,35,0.95);color:#ececf1;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;z-index:2147483647;font-family:-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 12px 24px rgba(0,0,0,0.35);backdrop-filter:blur(10px);";
        d.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' + '<div style="font-weight:700;font-size:14px;">Convoviz Direct Export</div>' + '<button id="cvz-x" style="border:0;background:transparent;color:#ececf1;font-size:18px;line-height:18px;cursor:pointer;">×</button>' + '</div>' + '<div style="opacity:0.75;font-size:11px;margin-top:2px;">' + VER + (_useLocalStorage ? ' · \u26A0 localStorage fallback \u2014 large exports may lose state' : ' · state in IndexedDB') + '</div>' + '<div style="margin-top:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">' + '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;">' + '<div><b>Exported:</b> <span id="cvz-exported">0</span></div>' + '<div><b>Pending:</b> <span id="cvz-pending">0</span></div>' + '<div><b>Total:</b> <span id="cvz-total">?</span></div>' + '<div><b>Dead:</b> <span id="cvz-dead">0</span></div>' + '</div>' + '<div style="margin-top:6px;font-size:11px;opacity:0.85;">' + 'Avg/chat: <span id="cvz-avgChat">-</span> · Avg/batch: <span id="cvz-avgBatch">-</span> · ETA: <span id="cvz-eta">-</span>' + '</div>' + '<div style="margin-top:6px;font-size:11px;opacity:0.85;">Last stop: <span id="cvz-lastStop">-</span></div>' + '<div style="margin-top:4px;font-size:11px;opacity:0.85;">Last error: <span id="cvz-lastErr">-</span></div>' + '<div style="margin-top:6px;font-size:11px;opacity:0.9;">Δ since last scan: <span id="cvz-delta">-</span></div>' + '<div style="margin-top:4px;font-size:11px;opacity:0.9;">Δ pending: <span id="cvz-pdelta">-</span></div>' + '</div>' + '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' + '<label style="font-size:11px;opacity:0.9;">Batch</label>' + '<input id="cvz-batch" type="number" min="1" max="500" style="width:90px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;" />' + '<button id="cvz-rescan" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;">Rescan</button>' + '</div>' + '<div style="margin-top:10px;display:flex;gap:8px;">' + '<button id="cvz-start" style="flex:1;padding:8px 10px;border-radius:10px;border:1px solid rgba(16,163,127,0.6);background:rgba(16,163,127,0.15);color:#ececf1;cursor:pointer;font-weight:600;">Start</button>' + '<button id="cvz-stop" style="flex:1;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;font-weight:600;">Stop</button>' + '</div>' + '<div id="cvz-status" style="margin-top:10px;font-size:12px;">Idle</div>' + '<div style="height:8px;margin-top:6px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;">' + '<div id="cvz-bar" style="height:100%;width:0%;background:#10a37f;"></div>' + '</div>' + '<textarea id="cvz-log" readonly style="margin-top:10px;height:160px;width:100%;box-sizing:border-box;resize:vertical;font-size:11px;white-space:pre-wrap;background:rgba(0,0,0,0.25);color:#ececf1;border:1px solid rgba(255,255,255,0.08);padding:8px;border-radius:10px;font-family:inherit;outline:none;"></textarea>' + '<div style="margin-top:10px;display:flex;justify-content:space-between;gap:8px;">' + '<button id="cvz-reset" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;font-size:11px;">Reset</button>' + '<button id="cvz-dlstate" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;font-size:11px;">Export state</button>' + '</div>';
        document.body.appendChild(d);
        this.container = d;
        d.querySelector("#cvz-x").onclick = () => {
          d.style.display = "none";
        };
        d.querySelector("#cvz-start").onclick = () => Exporter.start();
        d.querySelector("#cvz-stop").onclick = () => Exporter.stop();
        d.querySelector("#cvz-rescan").onclick = () => Exporter.rescan(false);
        d.querySelector("#cvz-reset").onclick = async () => {
          if (confirm("Reset Convoviz exporter state? This will forget what was already exported.")) {
            await Store.reset();
            S = await Store.load();
            addLog("State reset.");
            this.renderAll();
          }
        };
        d.querySelector("#cvz-dlstate").onclick = () => {
          const blob = new Blob([JSON.stringify(S, null, 2)], {
            type: "application/json"
          });
          Net.download(blob, "convoviz_export_state.json");
        };
        const batchEl = d.querySelector("#cvz-batch");
        batchEl.value = String(S.settings.batch || 50);
        batchEl.onchange = () => {
          const n = parseInt(batchEl.value, 10);
          if (S.run.isRunning) {
            batchEl.value = String(S.settings.batch || 50);
            addLog("Stop first to change batch size.");
            return;
          }
          S.settings.batch = clamp(isFinite(n) ? n : 50, 1, 500);
          batchEl.value = String(S.settings.batch);
          addLog("Batch size set to " + S.settings.batch + ".");
          saveDebounce(true);
          this.renderAll();
        };
      },
      setStatus(msg) {
        const el = this.container && this.container.querySelector("#cvz-status");
        if (el) el.textContent = msg;
      },
      setBar(pct) {
        const el = this.container && this.container.querySelector("#cvz-bar");
        if (el) el.style.width = clamp(pct || 0, 0, 100).toFixed(1) + "%";
      },
      renderLogs() {
        const el = this.container && this.container.querySelector("#cvz-log");
        if (!el) return;
        el.value = (S.logs || []).slice(-200).join("\n");
        el.scrollTop = el.scrollHeight;
      },
      renderAll() {
        if (!this.container) return;
        const exported = (S.progress.exported || []).length;
        const pending = (S.progress.pending || []).length;
        const dead = (S.progress.dead || []).length;
        const scanning = !!(_exporter && _exporter.scanPromise);
        const total = S.scan.total ? S.scan.total : (exported + pending) || "?";
        const totalLabel = scanning ? (exported + pending) + "…" : String(total);
        const batches = S.stats.batches || 0;
        const batchMs = S.stats.batchMs || 0;
        const chats = S.stats.chats || 0;
        const avgChat = chats ? batchMs / chats : 0;
        const avgBatch = batches ? batchMs / batches : 0;
        const eta = pending && avgChat ? pending * avgChat : 0;
        this.container.querySelector("#cvz-exported").textContent = String(exported);
        this.container.querySelector("#cvz-pending").textContent = scanning ? pending + "…" : String(pending);
        this.container.querySelector("#cvz-total").textContent = totalLabel;
        this.container.querySelector("#cvz-dead").textContent = String(dead);
        this.container.querySelector("#cvz-avgChat").textContent = avgChat ? fmtMs(avgChat) : "-";
        this.container.querySelector("#cvz-avgBatch").textContent = avgBatch ? fmtMs(avgBatch) : "-";
        this.container.querySelector("#cvz-eta").textContent = eta ? fmtMs(eta) : "-";
        this.container.querySelector("#cvz-lastStop").textContent = S.run.stoppedAt ? fmtTs(S.run.stoppedAt) : "-";
        this.container.querySelector("#cvz-lastErr").textContent = S.run.lastError ? String(S.run.lastError).slice(0, 80) : "-";
        const c = S.changes || {};
        if (scanning) {
          this.container.querySelector("#cvz-delta").textContent = "scanning…";
          this.container.querySelector("#cvz-pdelta").textContent = "scanning…";
        } else {
          const delta = "+" + (c.newChats || 0) + " new, -" + (c.removedChats || 0) + " removed, ~" + (c.updatedChats || 0) + " updated";
          this.container.querySelector("#cvz-delta").textContent = delta;
          const pdelta = ((c.pendingDelta || 0) >= 0 ? "+" : "") + (c.pendingDelta || 0) + " (new pending: " + (c.newPending || 0) + ")";
          this.container.querySelector("#cvz-pdelta").textContent = pdelta;
        }
        const batchEl = this.container.querySelector("#cvz-batch");
        if (batchEl) batchEl.disabled = !!S.run.isRunning;
        this.renderLogs();
        const done = exported;
        const tot = S.scan.total ? S.scan.total : (exported + pending);
        const pct = tot ? (done / tot) * 100 : 0;
        this.setBar(pct);
      },
      _tickId: 0,
      ensureTick() {
        if (this._tickId) return;
        this._tickId = setInterval(() => {
          if (!document.getElementById("cvz-resume-ui")) {
            clearInterval(this._tickId);
            this._tickId = 0;
            return;
          }
          this.renderAll();
          if (!S.run.isRunning && !(_exporter && _exporter.scanPromise)) {
            clearInterval(this._tickId);
            this._tickId = 0;
          }
        }, 1000);
      }
    };
    UI = UIImpl;
    UI.inject();
    UI.renderAll();
    if (S.run.isRunning) {
      S.run.isRunning = false;
      S.run.lastError = S.run.lastError || "Previous run interrupted (reload?)";
      addLog("Detected interrupted run. State preserved; click Start to resume.");
      saveDebounce(true);
      UI.renderAll();
    }
    const extractFileRefs = (chatJson) => {
      const out = [],
        seen = new Set();
      const mapping = (chatJson && chatJson.mapping) ? chatJson.mapping : {};
      for (const k in mapping) {
        const node = mapping[k];
        const msg = node && node.message;
        if (!msg) continue;
        const atts = msg.metadata && msg.metadata.attachments;
        if (Array.isArray(atts)) {
          for (const a of atts) {
            if (a && a.id && !seen.has(a.id)) {
              seen.add(a.id);
              out.push({
                id: a.id,
                name: a.name || null
              });
            }
          }
        }
        const parts = msg.content && msg.content.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (p && p.content_type === "image_asset_pointer" && p.asset_pointer) {
              const id = String(p.asset_pointer).replace("sediment://", "");
              if (id && !seen.has(id)) {
                seen.add(id);
                out.push({
                  id: id,
                  name: null
                });
              }
            }
          }
        }
      }
      return out;
    };
    const scanConversations = async (signal, onPage) => {
      await Net.getToken(signal);
      const rawBatch = clamp(parseInt(S.settings.batch, 10) || 50, 1, 500);
      const pageSize = Math.min(rawBatch, 100);
      if (rawBatch > 100 && UI) UI.setStatus("Scan page size capped at 100 (API limit)");
      let offset = 0;
      const items = [];
      while (true) {
        if (UI) UI.setStatus("Scanning list… offset " + offset);
        const data = await Net.fetchJson("/backend-api/conversations?offset=" + offset + "&limit=" + pageSize + "&order=updated", {
          signal,
          auth: true
        });
        const got = (data && data.items) || [];
        if (!got.length) break;
        const pageItems = [];
        for (const it of got) {
          const item = {
            id: it.id,
            title: it.title || "",
            update_time: it.update_time || it.updated_time || 0
          };
          items.push(item);
          pageItems.push(item);
        }
        if (onPage) onPage(pageItems);
        offset += got.length;
        if (got.length < pageSize) break;
        if (data.total && offset >= data.total) break;
      }
      return items;
    };
    const computeChanges = (prevSnap, items, freshPending) => {
      prevSnap = Array.isArray(prevSnap) ? prevSnap : [];
      const prevSet = new Set(prevSnap.map(x => x[0]));
      const prevTime = new Map(prevSnap.map(x => [x[0], x[1] || 0]));
      const curTime = new Map(items.map(x => [x.id, x.update_time || 0]));
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
      const oldPendingIds = new Set((S.progress.pending || []).map(x => x.id));
      let newPending = 0;
      for (const it of freshPending)
        if (!oldPendingIds.has(it.id)) newPending++;
      const pendingDelta = freshPending.length - ((S.progress.pending || []).length);
      return {
        at: now(),
        newChats,
        removedChats,
        updatedChats,
        newPending,
        pendingDelta
      };
    };
    const Exporter = {
      abort: null,
      _scanAbort: null,
      stopRequested: false,
      scanPromise: null,
      async rescan(force) {
        if (S.run.isRunning && !force) {
          addLog("Can't rescan while running. Stop first.");
          return;
        }
        if (this.scanPromise) return this.scanPromise;
        const ac = new AbortController();
        this._scanAbort = ac;
        if (UI && UI.ensureTick) UI.ensureTick();
        this.scanPromise = (async () => {
          try {
            assertOnChatGPT();
            S.run.lastPhase = "scan";
            S.scan.total = 0;
            S.changes = { at: 0, newChats: 0, removedChats: 0, updatedChats: 0, newPending: 0, pendingDelta: 0 };
            saveDebounce(true);
            if (UI) UI.renderAll();
            addLog("Rescan started…");
            const exportedSet = new Set(S.progress.exported || []);
            const deadSet = new Set((S.progress.dead || []).map(x => x.id));
            const pendingSet = new Set((S.progress.pending || []).map(x => x.id));
            const onPage = (pageItems) => {
              let added = 0;
              for (const it of pageItems) {
                if (!exportedSet.has(it.id) && !deadSet.has(it.id) && !pendingSet.has(it.id)) {
                  S.progress.pending.push(it);
                  pendingSet.add(it.id);
                  added++;
                }
              }
              if (added) {
                saveDebounce(false);
                if (UI) UI.renderAll();
              }
            };
            const items = await scanConversations(ac.signal, onPage);
            S.changes = computeChanges(S.scan.snapshot, items, S.progress.pending);
            S.scan = {
              at: now(),
              total: items.length,
              snapshot: items.map(x => [x.id, x.update_time || 0])
            };
            saveDebounce(true);
            if (UI) UI.setStatus("Rescan done.");
            addLog("Rescan done. Total " + items.length + ", pending " + S.progress.pending.length + ".");
            if (UI) UI.renderAll();
          } catch (e) {
            if (e && e.name === "AbortError") {
              if (UI) UI.setStatus("Scan stopped.");
              addLog("Scan stopped.");
            } else {
              S.run.lastError = String(e && e.message || e);
              saveDebounce(true);
              if (UI) UI.setStatus("Rescan error: " + (e && e.message || e));
              addLog("Rescan error: " + (e && e.message || e));
              console.error(e);
            }
          } finally {
            this._scanAbort = null;
            this.scanPromise = null;
            S.run.lastPhase = "idle";
            saveDebounce(false);
          }
        })();
        return this.scanPromise;
      },
      async start() {
        if (S.run.isRunning) {
          addLog("Already running.");
          return;
        }
        try {
          assertOnChatGPT();
          this.stopRequested = false;
          const ac = new AbortController();
          this.abort = ac;
          if (UI && UI.ensureTick) UI.ensureTick();
          S.run.lastError = "";
          S.run.startedAt = now();
          S.run.lastPhase = "prepare";
          saveDebounce(true);
          if (UI) UI.renderAll();
          addLog("Start.");
          if (UI) UI.setStatus("Preparing…");
          await Net.getToken(ac.signal);
          const scanAge = S.scan.at ? (now() - S.scan.at) : Infinity;
          const needsScan = !Array.isArray(S.progress.pending) || !S.progress.pending.length || (S.settings.autoRescan !== false && scanAge > 6 * 60 * 60 * 1000);
          if (needsScan && !this.scanPromise) {
            this.rescan(true);
          }
          if (S.run.backoffUntil && S.run.backoffUntil > now()) {
            const wait = S.run.backoffUntil - now();
            if (UI) UI.setStatus("Backoff carryover → sleeping " + fmtMs(wait));
            addLog("Backoff carryover: sleeping " + fmtMs(wait) + "…");
            await sleep(wait, ac.signal);
          }
          S.run.isRunning = true;
          S.run.lastPhase = "run";
          saveDebounce(true);
          if (UI) UI.renderAll();
          if (UI) UI.setStatus("Running…");
          while (S.run.isRunning) {
            if (!S.progress.pending.length && this.scanPromise) {
              if (UI) UI.setStatus("Waiting for scan to find conversations…");
              await sleep(500, ac.signal);
              continue;
            }
            if (!S.progress.pending.length || this.stopRequested) break;
            await this.exportOneBatch(ac.signal);
            if (this.stopRequested) break;
          }
          if (UI) UI.setStatus(S.progress.pending.length ? "Paused." : "✅ All done.");
          addLog(S.progress.pending.length ? "Paused." : "All done.");
        } catch (e) {
          if (e && e.name === "AbortError") {
            if (UI) UI.setStatus("Paused.");
            addLog("Stopped.");
          } else {
            S.run.lastError = String(e && e.message || e);
            if (UI) UI.setStatus("❌ Error: " + (e && e.message || e));
            addLog("Error: " + (e && e.message || e));
            console.error(e);
          }
        } finally {
          S.run.isRunning = false;
          S.run.stoppedAt = now();
          S.run.lastPhase = "idle";
          saveDebounce(true);
          if (UI) UI.renderAll();
          this.abort = null;
        }
      },
      stop() {
        if (!this.abort && !this._scanAbort && !S.run.isRunning) {
          addLog("Not running.");
          return;
        }
        this.stopRequested = true;
        S.run.isRunning = false;
        S.run.lastPhase = "idle";
        saveDebounce(true);
        addLog("Stop requested…");
        if (UI) UI.setStatus("Stopping…");
        if (this.abort) this.abort.abort();
        if (this._scanAbort) this._scanAbort.abort();
      },
      async exportOneBatch(signal) {
        const batchSize = clamp(parseInt(S.settings.batch, 10) || 50, 1, 500);
        const conc = clamp(parseInt(S.settings.conc, 10) || 3, 1, 8);
        const pause = clamp(parseInt(S.settings.pause, 10) || 300, 0, 5000);
        const batchItems = S.progress.pending.slice(0, batchSize);
        if (!batchItems.length) return;
        const zip = new ZipLite();
        const successes = [];
        const successIds = new Set();
        const exportedSet = new Set(S.progress.exported || []);
        const failInfo = {};
        let filesSaved = 0,
          filesFailed = 0;
        const queue = batchItems.slice();
        const tBatchStart = now();
        addLog("Batch starting: " + batchItems.length + " chats (conc " + conc + ").");
        const worker = async () => {
          while (queue.length && !(signal && signal.aborted)) {
            const item = queue.shift();
            const title = item.title || item.id;
            if (UI) UI.setStatus("Fetching: " + title);
            const t0 = now();
            try {
              const detail = await Net.fetchJson("/backend-api/conversation/" + item.id, {
                signal,
                auth: true
              });
              const refs = extractFileRefs(detail);
              if (refs.length && UI) UI.setStatus("Media: " + title + " (" + refs.length + " files)");
              for (let i = 0; i < refs.length; i++) {
                if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
                const f = refs[i];
                try {
                  if (UI) UI.setStatus("Downloading file " + (i + 1) + "/" + refs.length + " for " + title);
                  const meta = await Net.fetchJson("/backend-api/files/download/" + f.id, {
                    signal,
                    auth: true
                  });
                  if (meta && meta.download_url) {
                    const isSameOrigin = meta.download_url.startsWith("/") || meta.download_url.startsWith(location.origin);
                    const blob = await Net.fetchBlob(meta.download_url, {
                      signal,
                      auth: false,
                      credentials: isSameOrigin ? "same-origin" : "omit"
                    });
                    const ext = (blob.type && blob.type.indexOf("/") > -1) ? blob.type.split("/")[1] : "bin";
                    const fname = f.name ? (f.id + "_" + sanitizeName(f.name)) : (f.id + "." + sanitizeName(ext));
                    await zip.addBlob(fname, blob);
                    filesSaved++;
                  } else {
                    filesFailed++;
                    addLog("No download_url for file " + f.id + " (" + title + ")");
                  }
                } catch (e) {
                  filesFailed++;
                  addLog("File failed " + f.id + " (" + title + "): " + (e && e.message || e));
                }
                if (pause) await sleep(pause, signal).catch(() => { });
              }
              successes.push(detail);
              successIds.add(item.id);
              if (!exportedSet.has(item.id)) {
                S.progress.exported.push(item.id);
                exportedSet.add(item.id);
              }
              if (UI) UI.setStatus("Saved: " + title);
              addLog("✓ " + title + " (" + fmtMs(now() - t0) + ", files " + refs.length + ")");
            } catch (e) {
              if (e && e.name === "AbortError") throw e;
              const msg = (e && e.message) || String(e);
              failInfo[item.id] = msg;
              addLog("✗ " + title + ": " + msg);
            }
            if (UI) UI.renderAll();
            if (pause) await sleep(pause, signal).catch(() => { });
          }
        };
        const workers = [];
        for (let i = 0; i < Math.min(conc, queue.length || 1); i++) workers.push(worker());
        try {
          await Promise.all(workers);
        } catch (e) {
          if (!(e && e.name === "AbortError")) throw e;
        }
        const batchWall = now() - tBatchStart;
        const updatePendingAfterBatch = () => {
          const rest = S.progress.pending.slice(batchItems.length);
          const requeue = [],
            dead = [];
          const fc = S.progress.failCounts || {};
          for (const it of batchItems) {
            if (successIds.has(it.id)) continue;
            const n = (fc[it.id] || 0) + 1;
            fc[it.id] = n;
            if (n >= 3) dead.push({
              ...it,
              lastError: failInfo[it.id] || "failed"
            });
            else requeue.push(it);
          }
          if (dead.length) {
            S.progress.dead = (S.progress.dead || []).concat(dead).slice(-500);
            addLog("Moved " + dead.length + " chats to dead-letter after 3 failures.");
          }
          S.progress.failCounts = fc;
          S.progress.pending = rest.concat(requeue);
          return {
            requeueCount: requeue.length,
            deadCount: dead.length
          };
        };
        if (successes.length) {
          if (UI) UI.setStatus("Building ZIP (" + successes.length + " chats)…");
          const meta = {
            created_at: new Date().toISOString(),
            tool: VER,
            chats: successes.length,
            files_saved: filesSaved,
            files_failed: filesFailed,
            batch_wall_ms: batchWall,
            pending_before: S.progress.pending.length
          };
          zip.addBytes("conversations.json", enc(JSON.stringify(successes)));
          zip.addBytes("convoviz_export_meta.json", enc(JSON.stringify(meta, null, 2)));
          const blob = zip.buildBlob();
          const ts = new Date();
          const pad = (n) => String(n).padStart(2, "0");
          const name = "convoviz_export_" + ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + "_" + pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds()) + "_n" + successes.length + ".zip";
          Net.download(blob, name);
          S.stats.batches = (S.stats.batches || 0) + 1;
          S.stats.batchMs = (S.stats.batchMs || 0) + batchWall;
          S.stats.chats = (S.stats.chats || 0) + successes.length;
          const moved = updatePendingAfterBatch();
          saveDebounce(true);
          addLog("Batch done: exported " + successes.length + " chats in " + fmtMs(batchWall) + ". Pending " + S.progress.pending.length + ". Files +" + filesSaved + "/-" + filesFailed + ".");
          if (moved.requeueCount === batchItems.length) {
            addLog("No progress detected; pausing to avoid infinite retries.");
            this.stopRequested = true;
            if (this.abort) this.abort.abort();
          }
        } else {
          const moved = updatePendingAfterBatch();
          saveDebounce(true);
          addLog("Batch ended with 0 exports (" + fmtMs(batchWall) + "). Requeued " + moved.requeueCount + ", dead " + moved.deadCount + ".");
          if (UI) UI.setStatus("Batch had 0 exports (see log).");
          if (moved.requeueCount && moved.requeueCount === batchItems.length) {
            addLog("No progress this batch; pausing to avoid infinite retries.");
            this.stopRequested = true;
            if (this.abort) this.abort.abort();
          }
        }
        if (UI) UI.renderAll();
      }
    };
    _exporter = Exporter;
    if (S.settings.autoRescan !== false && !S.run.isRunning && !Exporter.scanPromise) {
      setTimeout(() => {
        if (!S.run.isRunning) Exporter.rescan(false);
      }, 800);
    }
    S.logs = [];
    addLog("v10");
    addLog("UI ready. Exported " + (S.progress.exported || []).length + ", pending " + (S.progress.pending || []).length + ".");
    UI.renderAll();
    UI.ensureTick();
  } catch (e) {
    console.error(e);
    alert("Convoviz bookmarklet error: " + (e && e.message || e));
  }
})();