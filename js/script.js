javascript: (async () => {
  try {
    const KEY = "__cvz_export_state_v1__";
    const VER = "cvz-bookmarklet-4.1";
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
      v: 2,
      ver: VER,
      projects: [],
      settings: {
        batch: 50,
        conc: 3,
        pause: 300,
        autoRescan: true,
        filterGizmoId: null
      },
      progress: {
        exported: {},
        pending: [],
        dead: [],
        failCounts: {},
        kfExported: [],
        kfPending: [],
        kfDead: [],
        kfFailCounts: {}
      },
      scan: {
        at: 0,
        total: 0,
        totalProjects: 0,
        snapshot: []
      },
      stats: {
        batches: 0,
        batchMs: 0,
        chats: 0,
        kfBatches: 0,
        kfMs: 0,
        kfFiles: 0
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
      if (!Array.isArray(out.projects)) out.projects = [];
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
      out.progress.kfFailCounts = {
        ...(d.progress.kfFailCounts || {}),
        ...((s.progress || {}).kfFailCounts || {})
      };
      if (!Array.isArray(out.progress.kfExported)) out.progress.kfExported = [];
      if (!Array.isArray(out.progress.kfPending)) out.progress.kfPending = [];
      if (!Array.isArray(out.progress.kfDead)) out.progress.kfDead = [];
      if (Array.isArray(out.progress.exported)) {
        const migrated = {};
        for (var i = 0; i < out.progress.exported.length; i++) migrated[out.progress.exported[i]] = 0;
        out.progress.exported = migrated;
      }
      if (!out.progress.exported || typeof out.progress.exported !== "object" || Array.isArray(out.progress.exported)) out.progress.exported = {};
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
    const TaskList = {
      _tasks: [],
      _dirty: false,
      _userScrolled: false,
      add: function(task) {
        this._tasks.push({
          id: task.id,
          type: task.type || "conversation",
          label: task.label || "",
          projectName: task.projectName || null,
          status: task.status || "queued",
          detail: task.detail || null,
          error: task.error || null,
          startedAt: (task.status === "active") ? now() : (task.status === "queued" ? null : now()),
          completedAt: (task.status === "done" || task.status === "failed") ? now() : null
        });
        this._dirty = true;
      },
      update: function(id, changes) {
        for (var i = 0; i < this._tasks.length; i++) {
          if (this._tasks[i].id === id) {
            var t = this._tasks[i];
            for (var k in changes) {
              if (changes.hasOwnProperty(k)) {
                t[k] = changes[k];
              }
            }
            if ((changes.status === "done" || changes.status === "failed") && !t.completedAt) {
              t.completedAt = now();
            }
            if (changes.status === "active" && !t.startedAt) {
              t.startedAt = now();
            }
            this._dirty = true;
            return;
          }
        }
      },
      getVisible: function() {
        var failed = [];
        var active = [];
        var done = [];
        var queued = [];
        for (var i = 0; i < this._tasks.length; i++) {
          var t = this._tasks[i];
          if (t.status === "failed") failed.push(t);
          else if (t.status === "active") active.push(t);
          else if (t.status === "done") done.push(t);
          else if (t.status === "queued") queued.push(t);
        }
        // Sliding window: all failed + all active + last ~30 done + next ~10 queued
        var visibleDone = done.length > 30 ? done.slice(done.length - 30) : done;
        var visibleQueued = queued.length > 10 ? queued.slice(0, 10) : queued;
        return [].concat(failed, visibleDone, active, visibleQueued);
      },
      render: function() {
        if (!this._dirty) return;
        this._dirty = false;
        var el = document.getElementById("cvz-tasks");
        if (!el) return;
        var wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10;
        var visible = this.getVisible();
        var html = "";
        for (var i = 0; i < visible.length; i++) {
          var t = visible[i];
          var cls = "cvz-task-" + t.status;
          var prefix = "";
          var style = "";
          if (t.status === "queued") {
            prefix = "\u00b7 ";
            style = "opacity:0.5;";
          } else if (t.status === "active") {
            prefix = '<span class="cvz-spin" style="display:inline-block;animation:cvz-spin 1s linear infinite;">\u27f3</span> ';
            style = "color:#10a37f;";
          } else if (t.status === "done") {
            prefix = "\u2713 ";
            style = "opacity:0.6;";
          } else if (t.status === "failed") {
            prefix = "\u2717 ";
            style = "color:#ef4444;";
          }
          var projPrefix = t.projectName ? "<span style=\"opacity:0.7;\">[" + t.projectName + "]</span> " : "";
          var errorSuffix = (t.status === "failed" && t.error) ? " <span style=\"opacity:0.8;\">(" + t.error + ")</span>" : "";
          html += '<div class="' + cls + '" style="' + style + 'padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + prefix + projPrefix + t.label + errorSuffix + '</div>';
          if (t.status === "active" && t.detail) {
            html += '<div class="cvz-task-detail" style="padding-left:16px;opacity:0.7;padding:1px 0;">\u21b3 ' + t.detail + '</div>';
          }
        }
        el.innerHTML = html;
        if (wasAtBottom) el.scrollTop = el.scrollHeight;
      }
    };
    window.__cvz_TaskList = TaskList;
    const UIImpl = {
      container: null,
      _maximized: false,
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
        d.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' + '<div style="font-weight:700;font-size:14px;">Convoviz Direct Export</div>' + '<div style="display:flex;gap:6px;align-items:center;">' + '<button id="cvz-max" style="border:0;background:transparent;color:#ececf1;font-size:14px;line-height:18px;cursor:pointer;opacity:0.7;" title="Maximize">\u26f6</button>' + '<button id="cvz-x" style="border:0;background:transparent;color:#ececf1;font-size:18px;line-height:18px;cursor:pointer;">\u00d7</button>' + '</div>' + '</div>' + '<div style="opacity:0.75;font-size:11px;margin-top:2px;">' + VER + (_useLocalStorage ? ' \u00b7 \u26A0 localStorage fallback \u2014 large exports may lose state' : ' \u00b7 state in IndexedDB') + '</div>' + '<div data-testid="cvz-stats" style="margin-top:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);">' + '<div style="display:flex;gap:10px;align-items:center;font-size:12px;">' + '<div><b>Exported:</b> <span id="cvz-exported">0</span></div>' + '<div>\u00b7</div>' + '<div><b>Pending:</b> <span id="cvz-pending">0</span></div>' + '<div>\u00b7</div>' + '<div><b>Dead:</b> <span id="cvz-dead">0</span></div>' + '<div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:999px;overflow:hidden;min-width:40px;">' + '<div id="cvz-bar" style="height:100%;width:0%;background:#10a37f;"></div>' + '</div>' + '</div>' + '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;margin-top:4px;">' + '<div><b>Projects:</b> <span id="cvz-projects">0</span></div>' + '<div>\u00b7</div>' + '<div><b>KF:</b> <span id="cvz-kf-count">0/0</span></div>' + '</div>' + '</div>' + '<div data-testid="cvz-controls" style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' + '<label style="font-size:11px;opacity:0.9;">Batch</label>' + '<input id="cvz-batch" type="number" min="1" max="500" style="width:60px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;" />' + '<button id="cvz-rescan" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;">Rescan</button>' + '<button id="cvz-start" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(16,163,127,0.6);background:rgba(16,163,127,0.15);color:#ececf1;cursor:pointer;font-weight:600;">Start</button>' + '<button id="cvz-stop" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;font-weight:600;">Stop</button>' + '</div>' + '<div id="cvz-project-filter" style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' + '<label style="font-size:11px;cursor:pointer;display:flex;align-items:center;gap:4px;"><input id="cvz-single-proj" type="checkbox" style="margin:0;cursor:pointer;" /> Single project</label>' + '<select id="cvz-proj-select" style="flex:1;min-width:0;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;font-size:11px;display:none;"><option value="">(rescan first to load projects)</option></select>' + '</div>' + '<div id="cvz-status" style="margin-top:6px;font-size:11px;opacity:0.85;min-height:14px;"></div>' + '<div id="cvz-tasks" style="margin-top:6px;height:180px;overflow-y:auto;border-radius:10px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);padding:6px 8px;font-size:11px;"></div>' + '<textarea id="cvz-log" readonly style="margin-top:10px;height:80px;width:100%;box-sizing:border-box;resize:vertical;font-size:11px;white-space:pre-wrap;background:rgba(0,0,0,0.25);color:#ececf1;border:1px solid rgba(255,255,255,0.08);padding:8px;border-radius:10px;font-family:inherit;outline:none;"></textarea>' + '<div style="margin-top:10px;display:flex;justify-content:space-between;gap:8px;">' + '<button id="cvz-reset" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;font-size:11px;">Reset</button>' + '<button id="cvz-dlstate" style="padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#ececf1;cursor:pointer;font-size:11px;">Export state</button>' + '</div>';
        document.body.appendChild(d);
        this.container = d;
        if (!document.getElementById("cvz-spin-style")) {
          var styleEl = document.createElement("style");
          styleEl.id = "cvz-spin-style";
          styleEl.textContent = "@keyframes cvz-spin { to { transform: rotate(360deg); } }";
          document.head.appendChild(styleEl);
        }
        d.querySelector("#cvz-x").onclick = () => {
          d.style.display = "none";
        };
        d.querySelector("#cvz-max").onclick = () => {
          this._maximized = !this._maximized;
          var m = this._maximized;
          d.style.top = m ? "0" : "20px";
          d.style.right = m ? "0" : "20px";
          d.style.width = m ? "100vw" : "380px";
          d.style.maxWidth = m ? "100vw" : "calc(100vw - 40px)";
          d.style.height = m ? "100vh" : "";
          d.style.borderRadius = m ? "0" : "12px";
          d.style.display = m ? "flex" : "block";
          d.style.flexDirection = m ? "column" : "";
          var tasks = d.querySelector("#cvz-tasks");
          if (tasks) tasks.style.flex = m ? "1" : "";
          if (tasks) tasks.style.height = m ? "" : "180px";
          var log = d.querySelector("#cvz-log");
          if (log) log.style.flex = m ? "1" : "";
          if (log) log.style.height = m ? "" : "80px";
          var btn = d.querySelector("#cvz-max");
          btn.textContent = m ? "\u2750" : "\u26f6";
          btn.title = m ? "Restore" : "Maximize";
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
        const singleProjCheck = d.querySelector("#cvz-single-proj");
        const projSelect = d.querySelector("#cvz-proj-select");
        singleProjCheck.checked = !!S.settings.filterGizmoId;
        projSelect.style.display = S.settings.filterGizmoId ? "" : "none";
        singleProjCheck.onchange = () => {
          if (S.run.isRunning) {
            singleProjCheck.checked = !!S.settings.filterGizmoId;
            addLog("Stop first to change project filter.");
            return;
          }
          if (!singleProjCheck.checked) {
            S.settings.filterGizmoId = null;
            projSelect.style.display = "none";
            saveDebounce(true);
            addLog("Project filter cleared. Will export all conversations.");
            this.renderAll();
          } else {
            projSelect.style.display = "";
            if (!(S.projects || []).length && !this._projectLoadPromise) {
              this._loadProjectsOnly();
            } else {
              this._populateProjectSelect();
            }
            if (projSelect.value) {
              S.settings.filterGizmoId = projSelect.value;
              saveDebounce(true);
            }
          }
        };
        projSelect.onchange = () => {
          if (S.run.isRunning) {
            projSelect.value = S.settings.filterGizmoId || "";
            addLog("Stop first to change project filter.");
            return;
          }
          S.settings.filterGizmoId = projSelect.value || null;
          saveDebounce(true);
          if (projSelect.value) {
            const name = projSelect.options[projSelect.selectedIndex].textContent;
            addLog("Filter set to project: " + name);
          }
          this.renderAll();
        };
      },
      _projectLoadPromise: null,
      _projectLoadAbort: null,
      _populateProjectSelect() {
        const sel = this.container && this.container.querySelector("#cvz-proj-select");
        if (!sel) return;
        const current = S.settings.filterGizmoId || "";
        const projects = S.projects || [];
        var html = "";
        if (this._projectLoadPromise) {
          html = '<option value="">Loading projects\u2026</option>';
        } else if (!projects.length) {
          html = '<option value="">(no projects found)</option>';
        } else {
          html = '<option value="">-- select a project --</option>';
          for (var i = 0; i < projects.length; i++) {
            var p = projects[i];
            var label = (p.emoji ? p.emoji + " " : "") + (p.name || p.gizmoId);
            var selected = (p.gizmoId === current) ? " selected" : "";
            html += '<option value="' + p.gizmoId + '"' + selected + '>' + label + '</option>';
          }
        }
        sel.innerHTML = html;
        sel.disabled = !!this._projectLoadPromise || !!S.run.isRunning;
      },
      _loadProjectsOnly() {
        if (this._projectLoadPromise) return;
        var self = this;
        var ac = new AbortController();
        this._projectLoadAbort = ac;
        addLog("Loading projects\u2026");
        var p = Net.getToken(ac.signal).then(function() {
          return scanProjects(ac.signal, function(proj) {
            if (self.container) {
              var statusEl = self.container.querySelector("#cvz-status");
              if (statusEl) statusEl.textContent = "Loading projects\u2026 found " + proj.name;
            }
          });
        }).then(function(projects) {
          S.projects = projects;
          S.scan.totalProjects = projects.length;
          saveDebounce(true);
          addLog("Found " + projects.length + " projects.");
        }).catch(function(e) {
          if (e && e.name === "AbortError") {
            addLog("Project load cancelled.");
          } else {
            addLog("Failed to load projects: " + (e && e.message || e));
          }
        }).then(function() {
          self._projectLoadPromise = null;
          self._projectLoadAbort = null;
          self._populateProjectSelect();
          self.renderAll();
        });
        this._projectLoadPromise = p;
        this._populateProjectSelect();
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
        const exported = Object.keys(S.progress.exported || {}).length;
        const pending = (S.progress.pending || []).length;
        const dead = (S.progress.dead || []).length;
        const scanning = !!(_exporter && _exporter.scanPromise);
        this.container.querySelector("#cvz-exported").textContent = String(exported);
        this.container.querySelector("#cvz-pending").textContent = scanning ? pending + "\u2026" : String(pending);
        this.container.querySelector("#cvz-dead").textContent = String(dead);
        const batchEl = this.container.querySelector("#cvz-batch");
        if (batchEl) batchEl.disabled = !!S.run.isRunning;
        var projectCount = (S.projects || []).length || S.scan.totalProjects || 0;
        this.container.querySelector("#cvz-projects").textContent = String(projectCount);
        var kfExp = (S.progress.kfExported || []).length;
        var kfPend = (S.progress.kfPending || []).length;
        var kfTotal = kfExp + kfPend + (S.progress.kfDead || []).length;
        this.container.querySelector("#cvz-kf-count").textContent = kfExp + "/" + kfTotal;
        var singleCheck = this.container.querySelector("#cvz-single-proj");
        if (singleCheck) {
          singleCheck.disabled = !!S.run.isRunning;
          if (singleCheck.checked) this._populateProjectSelect();
        }
        this.renderLogs();
        const done = exported;
        const tot = S.scan.total ? S.scan.total : (exported + pending);
        const pct = tot ? (done / tot) * 100 : 0;
        this.setBar(pct);
        TaskList.render();
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
    window.__cvz_UI = UIImpl;
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
    const scanConversations = async (signal, onPage, knownIds) => {
      await Net.getToken(signal);
      const rawBatch = clamp(parseInt(S.settings.batch, 10) || 50, 1, 500);
      const pageSize = Math.min(rawBatch, 100);
      if (rawBatch > 100 && UI) UI.setStatus("Scan page size capped at 100 (API limit)");
      let offset = 0;
      const items = [];
      let consecutiveKnownPages = 0;
      while (true) {
        if (UI) UI.setStatus("Scanning conversations\u2026 offset " + offset);
        const data = await Net.fetchJson("/backend-api/conversations?offset=" + offset + "&limit=" + pageSize + "&order=updated", {
          signal,
          auth: true
        });
        const got = (data && data.items) || [];
        if (!got.length) break;
        const pageItems = [];
        let pageNewCount = 0;
        for (const it of got) {
          const item = {
            id: it.id,
            title: it.title || "",
            update_time: it.update_time || it.updated_time || 0,
            gizmo_id: it.gizmo_id || it.project_id || null
          };
          items.push(item);
          pageItems.push(item);
          if (knownIds && !knownIds.has(it.id)) pageNewCount++;
        }
        if (onPage) onPage(pageItems);
        offset += got.length;
        if (knownIds && pageNewCount === 0) {
          consecutiveKnownPages++;
          if (consecutiveKnownPages >= 2) {
            if (UI) UI.setStatus("Scan: hit " + consecutiveKnownPages + " pages of known chats, stopping early.");
            addLog("Scan early-exit at offset " + offset + " (" + consecutiveKnownPages + " consecutive known pages).");
            break;
          }
        } else {
          consecutiveKnownPages = 0;
        }
        if (got.length < pageSize) break;
        if (data.total && offset >= data.total) break;
      }
      return items;
    };
    const scanProjects = async (signal, onProject) => {
      const projects = [];
      let cursor = null;
      let page = 1;
      while (true) {
        if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
        let url = "/backend-api/projects?cursor=" + encodeURIComponent(cursor || "") + "&limit=100";
        if (UI) UI.setStatus("Scanning projects\u2026 (page " + page + ")");
        const data = await Net.fetchJson(url, { signal, auth: true });
        if (page === 1) console.log("convoviz: projects API response sample", data);
        const items = (data && data.items) || [];
        if (!items.length) break;
        for (const item of items) {
          const projId = item.id || item.project_id || null;
          if (!projId) {
            if (page === 1) console.log("convoviz: skipped project item (no id)", item);
            continue;
          }
          const filesList = [];
          const projFiles = item.files || item.knowledge_files || [];
          for (const f of projFiles) {
            if (f && (f.file_id || f.id)) {
              filesList.push({
                fileId: f.file_id || f.id,
                name: f.name || f.filename || "",
                type: f.type || f.mime_type || "",
                size: f.size || 0
              });
            }
          }
          const proj = {
            gizmoId: projId,
            name: item.name || item.title || "",
            emoji: item.emoji || "",
            theme: item.color || item.accent_color || "",
            instructions: item.instructions || "",
            memoryEnabled: false,
            memoryScope: "",
            files: filesList,
            raw: item
          };
          projects.push(proj);
          if (onProject) onProject(proj);
        }
        cursor = (data && data.cursor) || null;
        if (!cursor) break;
        page++;
      }
      return projects;
    };
    const scanProjectConversations = async (gizmoId, signal, onPage, knownIds) => {
      let cursor = "0";
      const items = [];
      let consecutiveKnownPages = 0;
      while (true) {
        if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
        const url = "/backend-api/gizmos/" + encodeURIComponent(gizmoId) + "/conversations?cursor=" + encodeURIComponent(cursor);
        const data = await Net.fetchJson(url, { signal, auth: true });
        const got = (data && data.items) || [];
        if (!got.length) break;
        const pageItems = [];
        let pageNewCount = 0;
        for (const it of got) {
          const item = {
            id: it.id,
            title: it.title || "",
            update_time: it.update_time || it.updated_time || 0,
            gizmo_id: gizmoId
          };
          items.push(item);
          pageItems.push(item);
          if (knownIds && !knownIds.has(it.id)) pageNewCount++;
        }
        if (onPage) onPage(pageItems);
        if (knownIds && pageNewCount === 0) {
          consecutiveKnownPages++;
          if (consecutiveKnownPages >= 2) break;
        } else {
          consecutiveKnownPages = 0;
        }
        cursor = (data && data.cursor) || null;
        if (!cursor) break;
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
            TaskList.add({id: "scan", type: "scan", label: "Scanning conversations and projects\u2026", status: "active"});
            S.run.lastPhase = "scan";
            S.scan.total = 0;
            S.scan.totalProjects = 0;
            S.changes = { at: 0, newChats: 0, removedChats: 0, updatedChats: 0, newPending: 0, pendingDelta: 0 };
            saveDebounce(true);
            if (UI) UI.renderAll();
            addLog("Rescan started\u2026");
            const prevSnapshot = Array.isArray(S.scan.snapshot) ? S.scan.snapshot : [];
            const knownIds = new Set(prevSnapshot.map(function(x) { return x[0]; }));
            if (knownIds.size) addLog("Incremental scan: " + knownIds.size + " known conversations from previous scan.");
            const exportedMap = S.progress.exported || {};
            const deadSet = new Set((S.progress.dead || []).map(x => x.id));
            const pendingSet = new Set((S.progress.pending || []).map(x => x.id));
            const onPage = (pageItems) => {
              let added = 0;
              for (const it of pageItems) {
                if (deadSet.has(it.id) || pendingSet.has(it.id)) continue;
                const prevTime = exportedMap[it.id];
                if (prevTime !== undefined) {
                  const curTime = it.update_time || 0;
                  if (!curTime || !prevTime || curTime === prevTime) continue;
                }
                S.progress.pending.push(it);
                pendingSet.add(it.id);
                added++;
              }
              if (added) {
                saveDebounce(false);
                if (UI) UI.renderAll();
              }
            };
            const items = await scanConversations(ac.signal, onPage, knownIds.size ? knownIds : null);
            addLog("Regular scan done. Found " + items.length + " conversations.");
            let projectConvItems = [];
            try {
              if (UI) UI.setStatus("Scanning projects\u2026");
              const projects = await scanProjects(ac.signal, function(proj) {
                if (UI) UI.setStatus("Scanning projects\u2026 found " + proj.name);
              });
              S.projects = projects;
              S.scan.totalProjects = projects.length;
              saveDebounce(false);
              addLog("Found " + projects.length + " projects.");
              for (let pi = 0; pi < projects.length; pi++) {
                const proj = projects[pi];
                if (ac.signal && ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
                try {
                  if (UI) UI.setStatus("Scanning project chats: " + proj.name + " (" + (pi + 1) + "/" + projects.length + ")");
                  const projItems = await scanProjectConversations(proj.gizmoId, ac.signal, onPage, knownIds.size ? knownIds : null);
                  for (const it of projItems) projectConvItems.push(it);
                  addLog("Project " + proj.name + ": " + projItems.length + " conversations.");
                } catch (pe) {
                  if (pe && pe.name === "AbortError") throw pe;
                  addLog("\u26A0 Failed to scan project " + proj.name + ": " + (pe && pe.message || pe));
                  console.warn("convoviz: project conversation scan failed for " + proj.name, pe);
                }
              }
            } catch (projErr) {
              if (projErr && projErr.name === "AbortError") throw projErr;
              addLog("\u26A0 Project scan failed, continuing with regular conversations only: " + (projErr && projErr.message || projErr));
              console.warn("convoviz: project sidebar scan failed", projErr);
            }
            const kfExportedSet = new Set((S.progress.kfExported || []).map(function(x) { return x.fileId; }));
            const kfDeadSet = new Set((S.progress.kfDead || []).map(function(x) { return x.fileId; }));
            const kfPendingNew = [];
            const kfPendingIds = new Set();
            for (const proj of (S.projects || [])) {
              for (const f of (proj.files || [])) {
                if (!kfExportedSet.has(f.fileId) && !kfDeadSet.has(f.fileId) && !kfPendingIds.has(f.fileId)) {
                  kfPendingNew.push({
                    projectId: proj.gizmoId,
                    projectName: proj.name,
                    fileId: f.fileId,
                    fileName: f.name,
                    fileType: f.type,
                    fileSize: f.size
                  });
                  kfPendingIds.add(f.fileId);
                }
              }
            }
            S.progress.kfPending = kfPendingNew;
            saveDebounce(false);
            if (kfPendingNew.length) addLog("Knowledge files: " + kfPendingNew.length + " pending.");
            const scannedItems = items.concat(projectConvItems);
            const scannedIds = new Set(scannedItems.map(function(x) { return x.id; }));
            const carryOver = prevSnapshot.filter(function(x) { return !scannedIds.has(x[0]); });
            const allItems = scannedItems.map(function(x) { return [x.id, x.update_time || 0]; }).concat(carryOver);
            S.changes = computeChanges(S.scan.snapshot, scannedItems, S.progress.pending);
            S.scan = {
              at: now(),
              total: allItems.length,
              totalProjects: S.scan.totalProjects || 0,
              snapshot: allItems
            };
            saveDebounce(true);
            TaskList.update("scan", {status: "done", detail: null});
            if (UI) UI.setStatus("Rescan done.");
            addLog("Rescan done. Total " + allItems.length + " (scanned " + scannedItems.length + ", carried " + carryOver.length + "), pending " + S.progress.pending.length + ".");
            if (UI) UI.renderAll();
          } catch (e) {
            if (e && e.name === "AbortError") {
              TaskList.update("scan", {status: "failed", error: "Stopped"});
              if (UI) UI.setStatus("Scan stopped.");
              addLog("Scan stopped.");
            } else {
              S.run.lastError = String(e && e.message || e);
              saveDebounce(true);
              TaskList.update("scan", {status: "failed", error: String(e && e.message || e)});
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
          const filterGid = S.settings.filterGizmoId || null;
          if (filterGid) {
            const projName = ((S.projects || []).find(function(p) { return p.gizmoId === filterGid; }) || {}).name || filterGid;
            addLog("Single-project mode: " + projName);
          }
          if (UI) UI.setStatus("Running…");
          const _eligibleConvs = function() {
            return filterGid ? S.progress.pending.filter(function(x) { return x.gizmo_id === filterGid; }).length : S.progress.pending.length;
          };
          const _eligibleKf = function() {
            return filterGid ? (S.progress.kfPending || []).filter(function(x) { return x.projectId === filterGid; }).length : (S.progress.kfPending || []).length;
          };
          while (S.run.isRunning) {
            if (!_eligibleConvs() && this.scanPromise) {
              if (UI) UI.setStatus("Waiting for scan to find conversations\u2026");
              await sleep(500, ac.signal);
              continue;
            }
            if (!_eligibleConvs() || this.stopRequested) break;
            await this.exportOneBatch(ac.signal);
            if (this.stopRequested) break;
          }
          if (!this.stopRequested && _eligibleKf()) {
            addLog("Conversations done. Starting knowledge file export\u2026");
            while (S.run.isRunning) {
              if (!_eligibleKf() || this.stopRequested) break;
              await this.exportKnowledgeBatch(ac.signal);
              if (this.stopRequested) break;
            }
          }
          const anyPending = _eligibleConvs() || _eligibleKf();
          if (UI) UI.setStatus(anyPending ? "Paused." : "\u2705 All done.");
          addLog(anyPending ? "Paused." : "All done.");
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
        const filterGid = S.settings.filterGizmoId || null;
        const eligible = filterGid ? S.progress.pending.filter(function(x) { return x.gizmo_id === filterGid; }) : S.progress.pending;
        const batchItems = eligible.slice(0, batchSize);
        if (!batchItems.length) return;
        const zip = new ZipLite();
        const successes = [];
        const successIds = new Set();
        const exportedMap = S.progress.exported || {};
        const failInfo = {};
        let filesSaved = 0,
          filesFailed = 0;
        const queue = batchItems.slice();
        const tBatchStart = now();
        addLog("Batch starting: " + batchItems.length + " chats (conc " + conc + ").");
        const worker = async () => {
          while (queue.length && !(signal && signal.aborted)) {
            const item = queue.shift();
            const projName = item.gizmo_id ? ((S.projects || []).find(function(p) { return p.gizmoId === item.gizmo_id; }) || {}).name : null;
            const title = projName ? "[" + projName + "] " + (item.title || item.id) : (item.title || item.id);
            const taskId = "conv-" + item.id;
            TaskList.add({id: taskId, type: "conversation", label: item.title || item.id, projectName: projName || null, status: "active", detail: "fetching conversation"});
            const t0 = now();
            try {
              const detail = await Net.fetchJson("/backend-api/conversation/" + item.id, {
                signal,
                auth: true
              });
              const refs = extractFileRefs(detail);
              if (refs.length) TaskList.update(taskId, {detail: "downloading 1/" + refs.length + " files"});
              for (let i = 0; i < refs.length; i++) {
                if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
                const f = refs[i];
                TaskList.update(taskId, {detail: "downloading " + (i + 1) + "/" + refs.length + " files"});
                try {
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
              exportedMap[item.id] = item.update_time || 0;
              S.progress.exported = exportedMap;
              TaskList.update(taskId, {status: "done", detail: null});
              addLog("✓ " + title + " (" + fmtMs(now() - t0) + ", files " + refs.length + ")");
            } catch (e) {
              if (e && e.name === "AbortError") throw e;
              const msg = (e && e.message) || String(e);
              failInfo[item.id] = msg;
              TaskList.update(taskId, {status: "failed", error: msg});
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
          const batchIdSet = new Set(batchItems.map(function(x) { return x.id; }));
          const rest = S.progress.pending.filter(function(x) { return !batchIdSet.has(x.id); });
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
            pending_before: S.progress.pending.length,
            projects: (S.projects || []).map(function(p) {
              return {
                gizmo_id: p.gizmoId,
                name: p.name,
                emoji: p.emoji,
                theme: p.theme,
                knowledge_file_count: (p.files || []).length
              };
            })
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
      },
      async exportKnowledgeBatch(signal) {
        const batchSize = clamp(parseInt(S.settings.batch, 10) || 50, 1, 500);
        const conc = clamp(parseInt(S.settings.conc, 10) || 3, 1, 8);
        const pause = clamp(parseInt(S.settings.pause, 10) || 300, 0, 5000);
        const filterGid = S.settings.filterGizmoId || null;
        const kfEligible = filterGid ? S.progress.kfPending.filter(function(x) { return x.projectId === filterGid; }) : S.progress.kfPending;
        const batchItems = kfEligible.slice(0, batchSize);
        if (!batchItems.length) return;
        const zip = new ZipLite();
        const successes = [];
        const successIds = new Set();
        const failInfo = {};
        const projectsInBatch = new Set();
        const queue = batchItems.slice();
        const tBatchStart = now();
        addLog("KF batch starting: " + batchItems.length + " files (conc " + conc + ").");
        S.run.lastPhase = "kf";
        saveDebounce(false);
        const worker = async () => {
          while (queue.length && !(signal && signal.aborted)) {
            const item = queue.shift();
            const label = "[" + item.projectName + "] " + item.fileName;
            const taskId = "kf-" + item.fileId;
            TaskList.add({id: taskId, type: "knowledge", label: item.fileName, projectName: item.projectName, status: "active", detail: "downloading"});
            const t0 = now();
            try {
              const meta = await Net.fetchJson("/backend-api/files/download/" + encodeURIComponent(item.fileId) + "?gizmo_id=" + encodeURIComponent(item.projectId) + "&inline=false", {
                signal,
                auth: true
              });
              if (meta && meta.status === "error" && meta.error_code === "file_not_found") {
                S.progress.kfDead = (S.progress.kfDead || []).concat([{
                  ...item,
                  lastError: "file_not_found"
                }]).slice(-500);
                S.progress.kfFailCounts[item.fileId] = 3;
                failInfo[item.fileId] = "file_not_found";
                TaskList.update(taskId, {status: "failed", error: "file_not_found"});
                addLog("\u2717 KF dead-lettered (not found): " + label);
                if (UI) UI.renderAll();
                if (pause) await sleep(pause, signal).catch(function() {});
                continue;
              }
              if (meta && meta.status === "success" && meta.download_url) {
                const isSameOrigin = meta.download_url.startsWith("/") || meta.download_url.startsWith(location.origin);
                const blob = await Net.fetchBlob(meta.download_url, {
                  signal,
                  auth: false,
                  credentials: isSameOrigin ? "same-origin" : "omit"
                });
                const fname = "projects/" + item.projectId + "/files/" + item.fileId + "_" + sanitizeName(item.fileName);
                await zip.addBlob(fname, blob);
                successes.push(item);
                successIds.add(item.fileId);
                projectsInBatch.add(item.projectId);
                TaskList.update(taskId, {status: "done", detail: null});
                addLog("\u2713 KF " + label + " (" + fmtMs(now() - t0) + ")");
              } else {
                failInfo[item.fileId] = "no download_url in response";
                TaskList.update(taskId, {status: "failed", error: "no download_url in response"});
                addLog("\u2717 KF no download_url: " + label);
              }
            } catch (e) {
              if (e && e.name === "AbortError") throw e;
              const msg = (e && e.message) || String(e);
              failInfo[item.fileId] = msg;
              TaskList.update(taskId, {status: "failed", error: msg});
              addLog("\u2717 KF " + label + ": " + msg);
            }
            if (UI) UI.renderAll();
            if (pause) await sleep(pause, signal).catch(function() {});
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
        const updateKfPendingAfterBatch = () => {
          const batchFileIdSet = new Set(batchItems.map(function(x) { return x.fileId; }));
          const rest = S.progress.kfPending.filter(function(x) { return !batchFileIdSet.has(x.fileId); });
          const requeue = [];
          const dead = [];
          const fc = S.progress.kfFailCounts || {};
          for (const it of batchItems) {
            if (successIds.has(it.fileId)) continue;
            if (fc[it.fileId] >= 3) continue;
            const n = (fc[it.fileId] || 0) + 1;
            fc[it.fileId] = n;
            if (n >= 3) dead.push({
              ...it,
              lastError: failInfo[it.fileId] || "failed"
            });
            else requeue.push(it);
          }
          if (dead.length) {
            S.progress.kfDead = (S.progress.kfDead || []).concat(dead).slice(-500);
            addLog("Moved " + dead.length + " knowledge files to dead-letter after 3 failures.");
          }
          S.progress.kfFailCounts = fc;
          S.progress.kfPending = rest.concat(requeue);
          return {
            requeueCount: requeue.length,
            deadCount: dead.length
          };
        };
        if (successes.length) {
          if (UI) UI.setStatus("Building KF ZIP (" + successes.length + " files)\u2026");
          for (const projId of projectsInBatch) {
            const proj = (S.projects || []).find(function(p) { return p.gizmoId === projId; });
            if (proj && proj.raw) {
              zip.addBytes("projects/" + projId + "/project.json", enc(JSON.stringify(proj.raw, null, 2)));
            }
          }
          const meta = {
            created_at: new Date().toISOString(),
            tool: VER,
            type: "knowledge_files",
            files_exported: successes.length,
            batch_wall_ms: batchWall,
            kf_pending_before: batchItems.length,
            projects: (S.projects || []).map(function(p) {
              return {
                gizmo_id: p.gizmoId,
                name: p.name,
                emoji: p.emoji,
                theme: p.theme,
                knowledge_file_count: (p.files || []).length
              };
            })
          };
          zip.addBytes("convoviz_export_meta.json", enc(JSON.stringify(meta, null, 2)));
          const blob = zip.buildBlob();
          const ts = new Date();
          const pad = function(n) { return String(n).padStart(2, "0"); };
          const name = "convoviz_knowledge_" + ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + "_" + pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds()) + "_n" + successes.length + ".zip";
          Net.download(blob, name);
          S.progress.kfExported = (S.progress.kfExported || []).concat(successes);
          S.stats.kfBatches = (S.stats.kfBatches || 0) + 1;
          S.stats.kfMs = (S.stats.kfMs || 0) + batchWall;
          S.stats.kfFiles = (S.stats.kfFiles || 0) + successes.length;
          const moved = updateKfPendingAfterBatch();
          saveDebounce(true);
          addLog("KF batch done: exported " + successes.length + " files in " + fmtMs(batchWall) + ". KF pending " + S.progress.kfPending.length + ".");
          if (moved.requeueCount === batchItems.length) {
            addLog("No KF progress detected; pausing to avoid infinite retries.");
            this.stopRequested = true;
            if (this.abort) this.abort.abort();
          }
        } else {
          const moved = updateKfPendingAfterBatch();
          saveDebounce(true);
          addLog("KF batch ended with 0 exports (" + fmtMs(batchWall) + "). Requeued " + moved.requeueCount + ", dead " + moved.deadCount + ".");
          if (UI) UI.setStatus("KF batch had 0 exports (see log).");
          if (moved.requeueCount && moved.requeueCount === batchItems.length) {
            addLog("No KF progress this batch; pausing to avoid infinite retries.");
            this.stopRequested = true;
            if (this.abort) this.abort.abort();
          }
        }
        if (UI) UI.renderAll();
      }
    };
    _exporter = Exporter;
    window.__cvz_Exporter = Exporter;
    window.__cvz_S = S;
    window.__cvz_Net = Net;
    S.logs = [];
    addLog(VER);
    addLog("UI ready. Exported " + Object.keys(S.progress.exported || {}).length + ", pending " + (S.progress.pending || []).length + ". Click Rescan then Start.");
    UI.renderAll();
  } catch (e) {
    console.error(e);
    alert("Convoviz bookmarklet error: " + (e && e.message || e));
  }
})();