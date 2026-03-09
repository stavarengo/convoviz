export type TaskStatus = "queued" | "active" | "done" | "failed";

export interface Task {
  id: string;
  type: string;
  label: string;
  projectName: string | null;
  status: TaskStatus;
  detail: string | null;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface FileRef {
  id: string;
  name: string | null;
}

export interface ProjectFile {
  fileId: string;
  name: string;
  type: string;
  size: number;
}

export interface ProjectInfo {
  gizmoId: string;
  name: string;
  emoji: string;
  theme: string;
  instructions: string;
  memoryEnabled: boolean;
  memoryScope: string;
  files: ProjectFile[];
  raw: unknown;
}

export interface PendingItem {
  id: string;
  title: string;
  update_time: number;
  gizmo_id: string | null;
}

export interface DeadItem extends PendingItem {
  lastError: string;
}

export interface KfPendingItem {
  projectId: string;
  projectName: string;
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface KfDeadItem extends KfPendingItem {
  lastError: string;
}

export interface Settings {
  batch: number;
  conc: number;
  pause: number;
  filterGizmoId: string | null;
}

export interface Progress {
  exported: Record<string, number>;
  pending: PendingItem[];
  dead: DeadItem[];
  failCounts: Record<string, number>;
  kfExported: KfPendingItem[];
  kfPending: KfPendingItem[];
  kfDead: KfDeadItem[];
  kfFailCounts: Record<string, number>;
}

export interface ScanState {
  at: number;
  total: number;
  totalProjects: number;
  snapshot: [string, number][];
}

export interface RunState {
  isRunning: boolean;
  startedAt: number;
  stoppedAt: number;
  lastError: string;
  backoffUntil: number;
  backoffCount: number;
  lastPhase: string;
}

export interface Stats {
  batches: number;
  batchMs: number;
  chats: number;
  kfBatches: number;
  kfMs: number;
  kfFiles: number;
}

export interface Changes {
  at: number;
  newChats: number;
  removedChats: number;
  updatedChats: number;
  newPending: number;
  pendingDelta: number;
}

export interface ExportState {
  v: number;
  ver: string;
  projects: ProjectInfo[];
  settings: Settings;
  progress: Progress;
  scan: ScanState;
  stats: Stats;
  run: RunState;
  changes: Changes;
  logs: string[];
}
