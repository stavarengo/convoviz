import type { EventBus } from "../events/bus";
import type { EventMap } from "../events/types";
import type { DiscoveryStore } from "../state/discovery-store";
import type { ProjectFile } from "../types";
import { sanitizeName } from "../utils/sanitize";

interface ProjectScannerNet {
  fetchJson(
    url: string,
    opts?: { signal?: AbortSignal; auth?: boolean },
  ): Promise<unknown>;
}

export interface ProjectScannerDeps {
  net: ProjectScannerNet;
  discoveryStore: DiscoveryStore;
  eventBus: EventBus;
}

export interface ProjectScanner {
  start(signal: AbortSignal): Promise<void>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function createProjectScanner(deps: ProjectScannerDeps): ProjectScanner {
  const { net, discoveryStore, eventBus } = deps;

  return {
    async start(signal: AbortSignal): Promise<void> {
      let cursor: string | null = null;
      let itemCount = 0;

      while (true) {
        if (signal.aborted) break;

        let url =
          "/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0";
        if (cursor) url += "&cursor=" + encodeURIComponent(cursor);

        let data: any;
        try {
          data = await net.fetchJson(url, { signal, auth: true });
        } catch (err) {
          if (
            err instanceof DOMException &&
            err.name === "AbortError"
          ) {
            break;
          }
          throw err;
        }

        const items = (data && data.items) || [];
        if (!items.length) break;

        for (const g of items) {
          const inner = (g && g.gizmo) || {};
          const def = inner.gizmo || {};
          const gizmoId = def.id || null;
          if (!gizmoId) continue;

          const filesList: ProjectFile[] = [];
          const rawFiles = inner.files || [];
          for (const f of rawFiles) {
            if (f && (f.file_id || f.id)) {
              filesList.push({
                fileId: f.file_id || f.id,
                name: f.name || "",
                type: f.type || "",
                size: f.size || 0,
              });
            }
          }

          const disp = def.display || {};
          const name = disp.name || def.name || "";
          const emoji = disp.emoji || disp.profile_emoji || "";
          const theme = disp.theme || disp.accent_color || "";
          const instructions = def.instructions || "";

          await discoveryStore.putProject({
            gizmoId,
            name,
            emoji,
            theme,
            instructions,
            files: filesList,
            discoveredAt: Date.now(),
          });

          eventBus.emit("project-discovered", {
            gizmoId,
            name,
            files: filesList,
          });

          itemCount++;
        }

        cursor = (data && data.cursor) || null;
        if (!cursor) break;
      }

      if (!signal.aborted) {
        eventBus.emit("scanner-complete", {
          scannerId: "project-scanner",
          itemCount,
        });
      }
    },
  };
}

export interface DiscoverKnowledgeFilesDeps {
  project: EventMap["project-discovered"];
  eventBus: EventBus;
  exportBlobStore: {
    hasFilePrefix(prefix: string): Promise<boolean>;
  };
  deadFileIds: Set<string>;
}

export async function discoverKnowledgeFiles(
  deps: DiscoverKnowledgeFilesDeps,
): Promise<void> {
  const { project, eventBus, exportBlobStore, deadFileIds } = deps;

  for (const file of project.files) {
    if (deadFileIds.has(file.fileId)) continue;

    const safeProjName = sanitizeName(project.name);
    const safeFname = sanitizeName(file.name);
    const prefix = "kf/" + safeProjName + "/" + safeFname;

    const exists = await exportBlobStore.hasFilePrefix(prefix);
    if (exists) continue;

    eventBus.emit("knowledge-file-discovered", {
      fileId: file.fileId,
      projectId: project.gizmoId,
      projectName: project.name,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
  }
}
