export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  timestamp: number;
  session: string;
  level: LogLevel;
  category: string;
  message: string;
  context?: Record<string, unknown>;
}

type LogEntryInput = Omit<LogEntry, "id">;

export interface LogStore {
  available: boolean;
  init(): Promise<void>;
  put(entry: LogEntryInput): Promise<void>;
  getAll(): Promise<LogEntry[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
  runRetention(highMark: number, lowMark: number): Promise<void>;
}

const DB_NAME = "cvz-log";
const STORE_NAME = "entries";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("session", "session", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createLogStore(): LogStore {
  let db: IDBDatabase | null = null;

  const store: LogStore = {
    available: false,

    async init(): Promise<void> {
      try {
        db = await openDb();
        store.available = true;
      } catch {
        db = null;
        store.available = false;
      }
    },

    async put(entry: LogEntryInput): Promise<void> {
      if (!db) return;
      return new Promise((resolve, reject) => {
        const tx = db!.transaction(STORE_NAME, "readwrite");
        const os = tx.objectStore(STORE_NAME);
        const req = os.add(entry);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    async getAll(): Promise<LogEntry[]> {
      if (!db) return [];
      return new Promise((resolve, reject) => {
        const tx = db!.transaction(STORE_NAME, "readonly");
        const os = tx.objectStore(STORE_NAME);
        const req = os.getAll();
        req.onsuccess = () => resolve(req.result as LogEntry[]);
        req.onerror = () => reject(req.error);
      });
    },

    async count(): Promise<number> {
      if (!db) return 0;
      return new Promise((resolve, reject) => {
        const tx = db!.transaction(STORE_NAME, "readonly");
        const os = tx.objectStore(STORE_NAME);
        const req = os.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async clear(): Promise<void> {
      if (!db) return;
      return new Promise((resolve, reject) => {
        const tx = db!.transaction(STORE_NAME, "readwrite");
        const os = tx.objectStore(STORE_NAME);
        const req = os.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    async runRetention(highMark: number, lowMark: number): Promise<void> {
      if (!db) return;
      const total = await store.count();
      if (total <= highMark) return;

      const deleteCount = total - lowMark;
      return new Promise((resolve, reject) => {
        const tx = db!.transaction(STORE_NAME, "readwrite");
        const os = tx.objectStore(STORE_NAME);
        const req = os.openCursor();
        let deleted = 0;
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || deleted >= deleteCount) {
            resolve();
            return;
          }
          cursor.delete();
          deleted++;
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      });
    },
  };

  return store;
}
