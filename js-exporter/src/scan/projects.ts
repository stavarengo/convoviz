import type { PendingItem, ProjectInfo, ProjectFile } from "../types";

interface ScanNet {
  fetchJson(url: string, opts?: { signal?: AbortSignal; auth?: boolean }): Promise<unknown>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export const scanProjects = async (
  net: ScanNet,
  signal: AbortSignal,
  onProject: ((proj: ProjectInfo) => void) | null,
  setStatus: (msg: string) => void,
): Promise<ProjectInfo[]> => {
  let cursor: string | null = null;
  let page = 1;
  const projects: ProjectInfo[] = [];
  while (true) {
    if (signal && signal.aborted)
      throw new DOMException("Aborted", "AbortError");
    let url =
      "/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0";
    if (cursor) url += "&cursor=" + encodeURIComponent(cursor);
    setStatus("Scanning projects\u2026 (page " + page + ")");
    const data = (await net.fetchJson(url, { signal, auth: true })) as any;
    const items = (data && data.items) || [];
    if (!items.length) break;
    for (let gi = 0; gi < items.length; gi++) {
      const g = items[gi];
      const inner = (g && g.gizmo) || {};
      const def = inner.gizmo || {};
      const gizmoId = def.id || null;
      if (!gizmoId) continue;
      const filesList: ProjectFile[] = [];
      const rawFiles = inner.files || [];
      for (let fi = 0; fi < rawFiles.length; fi++) {
        const f = rawFiles[fi];
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
      const proj: ProjectInfo = {
        gizmoId: gizmoId,
        name: disp.name || def.name || "",
        emoji: disp.emoji || disp.profile_emoji || "",
        theme: disp.theme || disp.accent_color || "",
        instructions: def.instructions || "",
        memoryEnabled: !!def.memory_enabled,
        memoryScope: def.memory_scope || "",
        files: filesList,
        raw: g,
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

export const scanProjectConversations = async (
  net: ScanNet,
  gizmoId: string,
  signal: AbortSignal,
  onPage: ((items: PendingItem[]) => void) | null,
  knownIds: Set<string> | null,
): Promise<PendingItem[]> => {
  let cursor: string | null = "0";
  const items: PendingItem[] = [];
  let consecutiveKnownPages = 0;
  while (true) {
    if (signal && signal.aborted)
      throw new DOMException("Aborted", "AbortError");
    const url =
      "/backend-api/gizmos/" +
      encodeURIComponent(gizmoId) +
      "/conversations?cursor=" +
      encodeURIComponent(cursor!);
    const data = (await net.fetchJson(url, { signal, auth: true })) as any;
    const got = (data && data.items) || [];
    if (!got.length) break;
    const pageItems: PendingItem[] = [];
    let pageNewCount = 0;
    for (const it of got) {
      const item: PendingItem = {
        id: it.id,
        title: it.title || "",
        update_time: it.update_time || it.updated_time || 0,
        gizmo_id: gizmoId,
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
