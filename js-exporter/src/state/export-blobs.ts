const DB_NAME = "cvz-export-blobs";
const CONV_STORE = "conv";
const FILES_STORE = "files";
const FILE_META_STORE = "file-meta";

export interface FileMeta {
  key: string;
  type: "attachment" | "knowledge-file";
  conversationId?: string;
  projectName?: string;
}

let _db: IDBDatabase | null = null;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CONV_STORE)) {
        db.createObjectStore(CONV_STORE);
      }
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE);
      }
      if (!db.objectStoreNames.contains(FILE_META_STORE)) {
        db.createObjectStore(FILE_META_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const initExportBlobsIdb = async (): Promise<void> => {
  try {
    _db = await openDb();
  } catch (e) {
    console.warn("convoviz: failed to open export-blobs IDB", e);
  }
};

const idbPut = (
  storeName: string,
  key: string,
  value: string | Blob,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!_db) {
      resolve();
      return;
    }
    const tx = _db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

const idbCursorIterate = <T>(
  storeName: string,
  cb: (key: string, value: T) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!_db) {
      resolve();
      return;
    }
    const tx = _db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      cb(cursor.key as string, cursor.value as T);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

const idbGetAllKeys = (storeName: string): Promise<string[]> =>
  new Promise((resolve, reject) => {
    if (!_db) {
      resolve([]);
      return;
    }
    const tx = _db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });

const idbClear = (storeName: string): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!_db) {
      resolve();
      return;
    }
    const tx = _db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

export const ExportBlobStore = {
  async putConv(id: string, json: string): Promise<void> {
    await idbPut(CONV_STORE, id, json);
  },

  async putFile(path: string, blob: Blob): Promise<void> {
    await idbPut(FILES_STORE, path, blob);
  },

  async getAllConvKeys(): Promise<string[]> {
    return idbGetAllKeys(CONV_STORE);
  },

  async iterateConvs(
    cb: (key: string, value: string) => void,
  ): Promise<void> {
    await idbCursorIterate<string>(CONV_STORE, cb);
  },

  async iterateFiles(
    cb: (key: string, value: Blob) => void,
  ): Promise<void> {
    await idbCursorIterate<Blob>(FILES_STORE, cb);
  },

  async totalSize(): Promise<number> {
    let size = 0;
    await idbCursorIterate<string>(CONV_STORE, (_key, value) => {
      size += new Blob([value]).size;
    });
    await idbCursorIterate<Blob>(FILES_STORE, (_key, value) => {
      // Blob.size if available, otherwise wrap in Blob to measure
      const s = value instanceof Blob ? value.size : new Blob([value]).size;
      size += s;
    });
    return size;
  },

  async hasFilePrefix(prefix: string): Promise<boolean> {
    if (!_db) return false;
    return new Promise((resolve, reject) => {
      const tx = _db!.transaction(FILES_STORE, "readonly");
      const store = tx.objectStore(FILES_STORE);
      const req = store.openKeyCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(false);
          return;
        }
        if ((cursor.key as string).startsWith(prefix)) {
          resolve(true);
          return;
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async putFileMeta(meta: FileMeta): Promise<void> {
    if (!_db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = _db!.transaction(FILE_META_STORE, "readwrite");
      const store = tx.objectStore(FILE_META_STORE);
      const req = store.put(meta);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async getFileMeta(key: string): Promise<FileMeta | null> {
    if (!_db) return null;
    return new Promise((resolve, reject) => {
      const tx = _db!.transaction(FILE_META_STORE, "readonly");
      const store = tx.objectStore(FILE_META_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  },

  async iterateFileMeta(
    cb: (meta: FileMeta) => void,
  ): Promise<void> {
    await idbCursorIterate<FileMeta>(FILE_META_STORE, (_key, value) => {
      cb(value);
    });
  },

  async clear(): Promise<void> {
    await idbClear(CONV_STORE);
    await idbClear(FILES_STORE);
    await idbClear(FILE_META_STORE);
  },
};
