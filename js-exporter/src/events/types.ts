import type { ProjectFile } from "../types";

export interface EventMap {
  "conversation-needs-export": { id: string };
  "conversation-needs-update": { id: string };
  "conversation-up-to-date": { id: string };
  "conversation-exported": { id: string };
  "conversation-files-discovered": {
    conversationId: string;
    conversationTitle: string;
    files: Array<{ id: string; name: string | null }>;
  };
  "project-discovered": {
    gizmoId: string;
    name: string;
    files: ProjectFile[];
  };
  "knowledge-file-discovered": {
    fileId: string;
    projectId: string;
    projectName: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  };
  "scanner-progress": { scannerId: string; offset: number; total: number };
  "scanner-complete": { scannerId: string; itemCount: number };
}
