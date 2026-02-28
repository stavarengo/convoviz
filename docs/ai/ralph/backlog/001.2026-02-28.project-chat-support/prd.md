# PRD: Project & Knowledge File Export Support

**Project:** Convoviz
**Branch:**

## Introduction

The Convoviz bookmarklet (`js/script.js`, v2.0) exports ChatGPT conversations and media directly from the browser. It currently handles regular conversations and custom GPT conversations, but completely misses **ChatGPT Projects** — a feature where users organize conversations into project workspaces with dedicated knowledge files, instructions, and scoped memory.

ChatGPT's API serves project conversations through separate endpoints from regular conversations. The regular `/backend-api/conversations` endpoint returns only non-project chats. Project chats are accessible only via project-specific gizmo endpoints. This means users with project-organized conversations are silently missing a significant portion of their data.

This PRD adds project conversation scanning, project knowledge file downloading, and minimal UI updates to surface the new progress information.

**Important context:** This is a standalone JavaScript bookmarklet — a single file that runs in the browser console or as a `javascript:` bookmark. There is no build system, no test framework, and no Node.js runtime. All changes happen within `js/script.js`.

## Goals

- Export all project conversations alongside regular conversations with a single click
- Download project knowledge files (files attached to projects, not to individual messages)
- Include project metadata in export ZIPs so the Python side can associate conversations to their projects
- Maintain graceful degradation: project scan failures never block regular conversation export
- Follow existing patterns (batch/retry/dead-letter) for all new functionality

## User Stories

### US-001: Scan project list and project conversations
**Status:** pending
**Description:** As a user with conversations organized in ChatGPT Projects, I want the bookmarklet to automatically discover all my projects and their conversations so that nothing is missed during export.

**Acceptance Criteria:**
- [ ] New function `scanProjects(signal, onProject)` paginates through `GET /backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0` using cursor-based pagination (stop when `cursor` is `null`)
- [ ] For each project returned, the gizmo definition is extracted and stored in `S.projects` with shape: `{gizmoId, name, emoji, theme, instructions, memoryEnabled, memoryScope, files: [{fileId, name, type, size}], raw: {...}}`
- [ ] New function `scanProjectConversations(gizmoId, signal, onPage)` paginates through `GET /backend-api/gizmos/{gizmoId}/conversations?cursor=0` using cursor-based pagination
- [ ] Each project conversation item is normalized to `{id, title, update_time, gizmo_id}` — same shape as regular items plus `gizmo_id`
- [ ] Project conversations are added to the existing `S.progress.pending` queue via the same `onPage` callback used for regular conversations
- [ ] The existing `pendingSet` deduplication prevents any edge-case duplicates between regular and project endpoints
- [ ] `rescan()` orchestrates: regular scan → project list scan → per-project conversation scan (in that order)
- [ ] `scan.total` includes both regular and project conversation counts
- [ ] `scan.totalProjects` tracks the count of projects found
- [ ] `scan.snapshot` includes all conversation IDs from both sources (same `[[id, update_time], ...]` format)
- [ ] Status text updates during each phase: "Scanning conversations... offset 150" → "Scanning projects... (page 2)" → "Scanning project chats: App Checker (3/21)"
- [ ] If the sidebar endpoint fails (403, network error, etc.), a warning is logged and regular conversation export continues without project data — no hard failure
- [ ] If scanning a specific project's conversations fails, that project is skipped with a log entry and remaining projects continue scanning

### US-002: Export project conversations through existing pipeline
**Status:** pending
**Description:** As a user, I want project conversations to export exactly like regular conversations so that the output format is consistent and the Python side can process them without changes.

**Acceptance Criteria:**
- [ ] Project conversations in `pending` are fetched via `GET /backend-api/conversation/{id}` — same endpoint as regular conversations (no code change needed in `exportOneBatch`)
- [ ] Message-level attachments in project conversations are extracted by the existing `extractFileRefs()` function and downloaded via the existing attachment download logic
- [ ] When processing a pending item with `gizmo_id`, the status text shows project context: "Fetching: [App Checker] Chat Title" (project name looked up from `S.projects`)
- [ ] The `convoviz_export_meta.json` in each batch ZIP includes a `projects` array with lightweight project info: `{gizmo_id, name, emoji, theme, knowledge_file_count}` for all projects in `S.projects`
- [ ] `computeChanges()` works correctly with the combined conversation list (regular + project) — no changes needed to the function itself, just the input includes project conversation IDs

### US-003: Download and export project knowledge files
**Status:** pending
**Description:** As a user, I want project knowledge files (files attached to projects, like PDFs and docs used as project context) to be included in my export so I have a complete backup.

**Acceptance Criteria:**
- [ ] New state fields added to `defaultState()`: `progress.kfExported: []`, `progress.kfPending: []`, `progress.kfDead: []`, `progress.kfFailCounts: {}`
- [ ] New state fields: `stats.kfBatches: 0`, `stats.kfMs: 0`, `stats.kfFiles: 0`
- [ ] `mergeState()` explicitly merges `progress.kfFailCounts` (same pattern as existing `failCounts` merge)
- [ ] Each knowledge file pending item has shape: `{projectId, projectName, fileId, fileName, fileType, fileSize}`
- [ ] During `rescan()`, after scanning projects, `kfPending` is rebuilt from `S.projects` file lists — skipping files already in `kfExported` or `kfDead`
- [ ] New function `exportKnowledgeBatch(signal)` mirrors `exportOneBatch()` patterns:
  - Takes a slice of `kfPending` (size = `S.settings.batch`)
  - Uses concurrent workers (count = `S.settings.conc`)
  - For each file: `GET /backend-api/files/download/{fileId}?gizmo_id={projectId}&inline=false`
  - If response `status === "success"` → fetch blob from `download_url`, add to ZIP at `projects/{projectId}/files/{fileId}_{sanitizedName}`
  - If response `status === "error"` with `error_code === "file_not_found"` → dead-letter immediately, no retry
  - If HTTP error → normal retry (3 attempts then dead-letter)
  - Pauses between files using `S.settings.pause`
- [ ] For each project with files in the batch, `projects/{projectId}/project.json` is added to the ZIP containing the full `raw` gizmo definition
- [ ] `convoviz_export_meta.json` is added to each knowledge file ZIP with batch stats
- [ ] Knowledge file ZIPs use filename pattern: `convoviz_knowledge_YYYYMMDD_HHMMSS_nN.zip`
- [ ] `Exporter.start()` main loop becomes: scan → conversation batches → knowledge file batches → done
- [ ] If user stops mid-knowledge-download, `kfPending` persists and resumes on next Start (conversations checked first, then knowledge files)
- [ ] Knowledge file stats (`kfBatches`, `kfMs`, `kfFiles`) are updated after each batch

### US-004: State and version updates
**Status:** pending
**Description:** As a developer, I need the state schema to support the new project and knowledge file tracking fields, with backward compatibility for existing v1 state.

**Acceptance Criteria:**
- [ ] `defaultState()` version bumped: `v: 2`
- [ ] Version string bumped: `ver: "cvz-bookmarklet-3.0"`
- [ ] New top-level field `projects: []` in `defaultState()`
- [ ] New field `scan.totalProjects: 0` in `defaultState()`
- [ ] Conversation items in `pending` now include `gizmo_id` field (`null` for regular, `"g-p-..."` for project conversations)
- [ ] Loading old v1 state (without `projects`, `kfPending`, etc.) works correctly — `mergeState()` fills in defaults from `defaultState()` automatically
- [ ] Old pending items without `gizmo_id` continue to work (treated as regular conversations)

### US-005: UI updates for project support
**Status:** pending
**Description:** As a user, I want to see project and knowledge file progress in the bookmarklet UI so I know what's happening during export.

**Acceptance Criteria:**
- [ ] Stats panel shows "Projects: N" after the existing Total/Dead row (where N = `S.projects.length` or `S.scan.totalProjects`)
- [ ] Stats panel shows "KF: X/Y" (knowledge files exported / total) next to the Projects count
- [ ] A secondary progress bar (purple, `#8b5cf6`) appears below the main green progress bar during the knowledge file download phase, hidden otherwise
- [ ] The secondary bar element has id `cvz-kf-bar` and a text status span `cvz-kf-status`
- [ ] The secondary bar container (`cvz-kf-row`) is hidden (`display:none`) when no knowledge file phase is active
- [ ] `renderAll()` updates the new stats and secondary bar alongside existing UI elements
- [ ] The main (green) progress bar remains conversation-only: `(exported / total) * 100`
- [ ] The secondary (purple) progress bar shows: `(kfExported / (kfExported + kfPending)) * 100`
- [ ] Version string in the UI header shows "cvz-bookmarklet-3.0"

## Functional Requirements

- FR-1: The bookmarklet must scan all user-owned projects via the `/gizmos/snorlax/sidebar` endpoint with cursor-based pagination
- FR-2: For each discovered project, the bookmarklet must scan its conversations via the `/gizmos/{gizmoId}/conversations` endpoint with cursor-based pagination
- FR-3: Project conversations must be added to the same pending queue as regular conversations, with a `gizmo_id` field to identify their source project
- FR-4: Project definitions (gizmo metadata + knowledge file list) must be stored in `S.projects` for later use by knowledge file download and ZIP metadata
- FR-5: The `convoviz_export_meta.json` in each conversation batch ZIP must include a `projects` array with all project summaries
- FR-6: Knowledge files must be downloadable via `GET /backend-api/files/download/{fileId}?gizmo_id={projectId}&inline=false`
- FR-7: Knowledge file ZIPs must use the directory structure `projects/{gizmoId}/files/{fileId}_{sanitizedName}` and include `projects/{gizmoId}/project.json` with the full gizmo definition
- FR-8: Knowledge file export must use the same batch/retry/dead-letter patterns as conversation export (batch size, concurrency, pause, 3-retry dead-letter)
- FR-9: `file_not_found` errors on knowledge files must be dead-lettered immediately without retry
- FR-10: Sidebar scan failure must degrade gracefully — log a warning and continue with regular-only export
- FR-11: Per-project conversation scan failure must skip only that project — other projects and regular conversations are unaffected
- FR-12: The bookmarklet must remain fully self-contained — no external dependencies

## Non-Goals

- **UI overhaul with per-task progress**: Deferred to a separate PRD. This PRD only adds minimal stats and a secondary progress bar.
- **Custom GPT definition export**: Regular `/conversations` already returns custom GPT chats. Exporting custom GPT definitions (names, instructions, configs) is a different feature.
- **Stale export detection**: Re-exporting conversations that were updated since their last export is a feature addition, not part of this scope.
- **Shared/team projects**: Only `owned_only=true` projects are scanned. Team/shared project support would require different API patterns.
- **Project file editing/management**: We only download knowledge files — no upload, delete, or modify.
- **ZIP compression**: `ZipLite` stores files uncompressed (method 0/STORE). Adding deflate would increase code size for minimal benefit.

## Technical Considerations

- **Single file**: All changes happen in `js/script.js`. No module system, no imports, no build step.
- **Bookmarklet constraints**: Template literals with backticks work in console but may break in bookmark URLs. The script uses string concatenation for HTML, which must be preserved.
- **Cursor-based pagination**: The project sidebar and per-project conversation endpoints use cursor-based pagination (not offset-based like the regular conversations endpoint). The cursor is an opaque string; `null` signals the last page. No `total` field is available — termination is detected solely by `cursor === null`.
- **No test framework**: This is a browser bookmarklet. Acceptance criteria are verified by code inspection and manual testing on chatgpt.com. There are no automated tests.
- **State backward compatibility**: `mergeState()` spreads `{...defaultState(), ...savedState}` per section. New fields from `defaultState()` are applied automatically. No explicit migration needed except for adding `kfFailCounts` to the explicit merge list.
- **API endpoint discovery**: All endpoint URLs and response shapes were reverse-engineered from browser HAR captures, not from official documentation. They may change without notice.
- **File ID formats**: Knowledge files use `file_id` (format: `file-{Base62String}`) for the download API call. The sidebar response provides both `id` and `file_id`; use `file_id` for downloads.
- **Download URL auth**: Knowledge file download URLs are signed CDN URLs (estuary). They should be fetched with `credentials: "omit"` for cross-origin or `"same-origin"` for same-origin URLs — same pattern as existing attachment downloads.

## Success Metrics

- Users with project-organized conversations get all their data exported (regular + project conversations + knowledge files)
- Project scan of 21 projects completes within a reasonable number of API calls (~21 sidebar pages + ~21 per-project conversation calls)
- Knowledge file downloads follow the same reliable batch/retry pattern as conversation exports
- Sidebar failure gracefully degrades to regular-only export with a visible log warning
- No regression in existing regular conversation export functionality

## Open Questions

None — all design decisions were resolved during brainstorming (see `2026-02-28.plan.project-chat-support.md`).
