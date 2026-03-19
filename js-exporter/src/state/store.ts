import type { ExportState } from "../types";
import { safeJsonParse } from "../utils/format";
import { KEY, defaultState, mergeState } from "./defaults";
import { log } from "./logger";

export { migrateV2toV3 } from "./migrate";

const IDB_NAME = "cvz-export";
const IDB_STORE = "state";
const IDB_KEY = "state";

const openIdb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
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

let _idb: IDBDatabase | null = null;
let _useLocalStorage = false;

const idbGet = (db: IDBDatabase): Promise<ExportState | null> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as ExportState) || null);
    req.onerror = () => reject(req.error);
  });

const idbPut = (db: IDBDatabase, val: ExportState): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(val, IDB_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

const idbDelete = (db: IDBDatabase): Promise<void> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const req = store.delete(IDB_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

export const initIdb = async (): Promise<void> => {
  try {
    _idb = await openIdb();
  } catch (e) {
    // Only fall back to localStorage if it's actually available
    // (Web Workers don't have localStorage).
    const hasLocalStorage =
      typeof globalThis !== "undefined" &&
      typeof globalThis.localStorage !== "undefined";
    log("warn", "state", "IndexedDB unavailable" + (hasLocalStorage ? ", falling back to localStorage" : ""), {
      error: String((e as any)?.message || e),
    });
    _useLocalStorage = hasLocalStorage;
  }
};

export const isUsingLocalStorage = (): boolean => _useLocalStorage;

export const Store = {
  async load(): Promise<ExportState> {
    if (_useLocalStorage) {
      const raw = localStorage.getItem(KEY);
      return mergeState(raw ? safeJsonParse(raw, null) : null);
    }
    if (!_idb) return defaultState();
    try {
      const s = await idbGet(_idb);
      return mergeState(s);
    } catch (e) {
      log("warn", "state", "Failed to load from IndexedDB", {
        error: String((e as any)?.message || e),
      });
      return defaultState();
    }
  },

  async save(st: ExportState): Promise<void> {
    if (_useLocalStorage) {
      try {
        localStorage.setItem(KEY, JSON.stringify(st));
      } catch (e) {
        log("warn", "state", "Failed to save state to localStorage", {
          error: String((e as any)?.message || e),
        });
      }
      return;
    }
    if (!_idb) return;
    try {
      await idbPut(_idb, st);
    } catch (e) {
      log("warn", "state", "Failed to save state to IndexedDB", {
        error: String((e as any)?.message || e),
      });
    }
  },

  async reset(): Promise<void> {
    if (_useLocalStorage) {
      localStorage.removeItem(KEY);
      return;
    }
    if (!_idb) return;
    try {
      await idbDelete(_idb);
    } catch (e) {
      log("warn", "state", "Failed to reset IndexedDB state", {
        error: String((e as any)?.message || e),
      });
    }
  },

  async destroy(): Promise<void> {
    if (_useLocalStorage) {
      localStorage.removeItem(KEY);
      return;
    }
    if (!_idb) return;
    _idb.close();
    _idb = null;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(IDB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  },
};
