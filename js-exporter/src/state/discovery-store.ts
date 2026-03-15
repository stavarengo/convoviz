import type { ProjectFile } from "../types";

export interface ConversationRecord {
  id: string;
  title: string;
  updateTime: number;
  gizmoId: string | null;
  status: "new" | "exported" | "needs-update";
  exportedAt: number | null;
}

export interface ProjectRecord {
  gizmoId: string;
  name: string;
  emoji: string;
  theme: string;
  instructions: string;
  files: ProjectFile[];
  discoveredAt: number;
}

export interface ScannerState {
  scannerId: string;
  offset: number;
  limit: number;
  total: number | null;
  lastRunAt: number;
  status: "active" | "complete" | "interrupted";
}

export interface DiscoveryStore {
  init(): Promise<void>;
  putConversation(record: ConversationRecord): Promise<void>;
  getConversation(id: string): Promise<ConversationRecord | null>;
  getAllConversations(): Promise<ConversationRecord[]>;
  putProject(record: ProjectRecord): Promise<void>;
  getProject(gizmoId: string): Promise<ProjectRecord | null>;
  getAllProjects(): Promise<ProjectRecord[]>;
  putScannerState(state: ScannerState): Promise<void>;
  getScannerState(id: string): Promise<ScannerState | null>;
  deleteScannerState(id: string): Promise<void>;
  clear(): Promise<void>;
  seedFromExportState(exported: Record<string, number>): Promise<void>;
}

const DB_NAME = "cvz-discovery";
const DB_VERSION = 1;
const CONVERSATIONS_STORE = "conversations";
const PROJECTS_STORE = "projects";
const SCANNERS_STORE = "scanners";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        db.createObjectStore(CONVERSATIONS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: "gizmoId" });
      }
      if (!db.objectStoreNames.contains(SCANNERS_STORE)) {
        db.createObjectStore(SCANNERS_STORE, { keyPath: "scannerId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut<T>(db: IDBDatabase, storeName: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(
  db: IDBDatabase,
  storeName: string,
  key: string,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(
  db: IDBDatabase,
  storeName: string,
  key: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbClear(db: IDBDatabase, storeName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function createDiscoveryStore(): DiscoveryStore {
  let db: IDBDatabase | null = null;

  return {
    async init(): Promise<void> {
      db = await openDb();
    },

    async putConversation(record: ConversationRecord): Promise<void> {
      if (!db) return;
      await idbPut(db, CONVERSATIONS_STORE, record);
    },

    async getConversation(id: string): Promise<ConversationRecord | null> {
      if (!db) return null;
      return idbGet<ConversationRecord>(db, CONVERSATIONS_STORE, id);
    },

    async getAllConversations(): Promise<ConversationRecord[]> {
      if (!db) return [];
      return idbGetAll<ConversationRecord>(db, CONVERSATIONS_STORE);
    },

    async putProject(record: ProjectRecord): Promise<void> {
      if (!db) return;
      await idbPut(db, PROJECTS_STORE, record);
    },

    async getProject(gizmoId: string): Promise<ProjectRecord | null> {
      if (!db) return null;
      return idbGet<ProjectRecord>(db, PROJECTS_STORE, gizmoId);
    },

    async getAllProjects(): Promise<ProjectRecord[]> {
      if (!db) return [];
      return idbGetAll<ProjectRecord>(db, PROJECTS_STORE);
    },

    async putScannerState(state: ScannerState): Promise<void> {
      if (!db) return;
      await idbPut(db, SCANNERS_STORE, state);
    },

    async getScannerState(id: string): Promise<ScannerState | null> {
      if (!db) return null;
      return idbGet<ScannerState>(db, SCANNERS_STORE, id);
    },

    async deleteScannerState(id: string): Promise<void> {
      if (!db) return;
      await idbDelete(db, SCANNERS_STORE, id);
    },

    async clear(): Promise<void> {
      if (!db) return;
      await idbClear(db, CONVERSATIONS_STORE);
      await idbClear(db, PROJECTS_STORE);
      await idbClear(db, SCANNERS_STORE);
    },

    async seedFromExportState(
      exported: Record<string, number>,
    ): Promise<void> {
      if (!db) return;
      for (const [id, timestamp] of Object.entries(exported)) {
        const existing = await this.getConversation(id);
        if (existing) continue;
        await this.putConversation({
          id,
          title: "",
          updateTime: 0,
          gizmoId: null,
          status: "exported",
          exportedAt: timestamp,
        });
      }
    },
  };
}
