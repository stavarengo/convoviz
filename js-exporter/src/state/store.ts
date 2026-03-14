import type { ExportState } from "../types";
import { safeJsonParse } from "../utils/format";
import { KEY, defaultState, mergeState } from "./defaults";

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
    console.warn(
      "convoviz: IndexedDB unavailable, falling back to localStorage",
      e,
    );
    _useLocalStorage = true;
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
      console.warn("convoviz: failed to load from IndexedDB", e);
      return defaultState();
    }
  },

  async save(st: ExportState): Promise<void> {
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

  async reset(): Promise<void> {
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
  },
};
