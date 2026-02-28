# PRD: Task-Based UI Overhaul

**Project:** Convoviz Bookmarklet
**Branch:**

## Introduction

The Convoviz bookmarklet (`js/script.js`, currently v3.0, ~1400 lines) exports regular conversations, custom GPT conversations, project conversations, and project knowledge files from ChatGPT. It runs multiple concurrent workers (3 by default) doing different things simultaneously, but the UI shows only a single status text line and two progress bars — making it impossible to see what's actually happening.

This overhaul replaces the verbose stats panel and single-line status with a **scrollable task list** where each conversation/knowledge-file export is a visible line item with its own status. The result: users see at a glance what's in progress, what completed, and what failed — without needing to read through the log.

## Goals

- Replace the single status line with a per-operation task list that shows what each concurrent worker is doing
- Compact the stats panel from 12 lines to 2 rows (only user-facing numbers: Exported, Pending, Dead, Projects, KF)
- Merge controls (Batch, Rescan, Start, Stop) into a single row to save vertical space
- Keep the panel at roughly the same height (~450-480px) — the task list fills the space freed by removing verbose stats
- Bump version to `cvz-bookmarklet-4.0`

## User Stories

### US-001: Rebuild panel layout with compact stats and controls
**Status:** pending
**Description:** As a user, I want the bookmarklet panel to show only the numbers that matter (Exported, Pending, Dead, Projects, KF) in a compact layout, so the panel isn't cluttered with developer metrics I don't need.

**Acceptance Criteria:**
- [ ] Stats panel replaced with 2 compact rows:
  - Row 1: `Exported: N · Pending: N · Dead: N` with an inline thin progress bar (same green `#10a37f`)
  - Row 2: `Projects: N · KF: N/N`
- [ ] Removed stats: Avg/chat, Avg/batch, ETA, Last stop, Last error, Delta since last scan, Delta pending
- [ ] Batch input, Rescan, Start, and Stop are all in one controls row (was two separate rows)
- [ ] The standalone status text line (`#cvz-status`) is replaced by a small fallback status area that only shows when there's no active task (for non-task messages like "Building ZIP...", "Scanning...")
- [ ] The main green progress bar is no longer a separate full-width bar — it's the inline bar in the stats row
- [ ] The KF purple progress bar is removed — KF progress is shown as `KF: 5/12` text in stats row 2
- [ ] Log textarea shrunk from `height:160px` to `height:80px`
- [ ] A new empty `<div id="cvz-tasks">` container is present between the controls row and the log area, styled: `height:180px; overflow-y:auto; border-radius:10px; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.08); padding:6px 8px; font-size:11px;`
- [ ] `renderAll()` updated to only populate the compact stat spans (no longer references removed elements like `#cvz-avgChat`, `#cvz-avgBatch`, `#cvz-eta`, `#cvz-lastStop`, `#cvz-lastErr`, `#cvz-delta`, `#cvz-pdelta`)
- [ ] The overall panel width stays at 380px and height stays roughly the same (~450-480px)
- [ ] Version constant changed from `cvz-bookmarklet-3.0` to `cvz-bookmarklet-4.0`
- [ ] All existing functionality still works: Start, Stop, Rescan, batch size change, Reset, Export state, close button
- [ ] Verify in browser using playwright

### US-002: Task list data model and rendering
**Status:** pending
**Description:** As a user, I want to see a scrollable list of individual export operations in the panel, each with its own status icon, so I can see at a glance what's happening, what completed, and what failed.

**Acceptance Criteria:**
- [ ] A `TaskList` object (or equivalent) is added to the bookmarklet with these methods:
  - `add(task)` — adds a task `{id, type, label, projectName, status, detail, error}`
  - `update(id, changes)` — updates fields on an existing task (e.g., `{status: "done"}` or `{detail: "downloading 2/5 files"}`)
  - `getVisible()` — returns the "sliding window" of tasks to render (see below)
- [ ] Task data model fields: `id` (string, e.g. `"conv-{uuid}"` or `"kf-{fileId}"`), `type` (`"conversation"` | `"knowledge"` | `"scan"`), `label` (display name), `projectName` (string or null), `status` (`"queued"` | `"active"` | `"done"` | `"failed"`), `detail` (sub-status string or null), `error` (error message or null), `startedAt` (timestamp), `completedAt` (timestamp)
- [ ] Tasks are **in-memory only** (not persisted to IndexedDB). They are transient UI state for the current session.
- [ ] Sliding window logic in `getVisible()`: returns all failed tasks + all active tasks + last ~30 completed tasks + next ~10 queued tasks. This keeps the visible list manageable regardless of total count.
- [ ] Tasks render inside `#cvz-tasks` as a list of `<div>` elements, one per task:
  - `queued`: `·` prefix, dimmed gray text (`opacity:0.5`)
  - `active`: spinning `⟳` prefix (CSS animation), green-tinted text (`color:#10a37f`)
  - `done`: `✓` prefix, muted text (`opacity:0.6`)
  - `failed`: `✗` prefix, red text (`color:#ef4444`), error shown in parentheses after label
- [ ] Active tasks with a non-null `detail` show a sub-line: indented with `↳` prefix (e.g., `  ↳ downloading 2/5 files`)
- [ ] Project context: tasks with `projectName` show `[ProjectName]` prefix before the label
- [ ] A CSS `@keyframes cvz-spin` animation is injected via a `<style>` element for the active task spinner (rotate the `⟳` character 360deg over 1s, linear, infinite)
- [ ] Auto-scroll: the `#cvz-tasks` container scrolls to the bottom when new tasks are added or updated, **unless** the user has manually scrolled up (detected by comparing `scrollTop + clientHeight` to `scrollHeight`). Auto-scroll resumes when the user scrolls back to the bottom.
- [ ] Rendering is efficient: only re-renders when `add()` or `update()` is called, not on every `renderAll()` tick. The task list maintains its own dirty flag.
- [ ] `UI.renderAll()` calls `TaskList.render()` if dirty
- [ ] Verify in browser using playwright

### US-003: Wire task list to export pipeline
**Status:** pending
**Description:** As a user, I want each conversation and knowledge file export to appear as a live task in the task list, so I can track individual operations instead of reading a single status line.

**Acceptance Criteria:**
- [ ] In `exportOneBatch` worker loop:
  - When a worker picks up a conversation: calls `TaskList.add({id: "conv-" + item.id, type: "conversation", label: item.title || item.id, projectName: projName, status: "active"})` and also adds the next few queued items as `status: "queued"` tasks
  - When fetching conversation detail: updates task with `detail: "fetching conversation"`
  - When downloading files: updates task with `detail: "downloading N/M files"`
  - When done: updates task with `{status: "done", detail: null}`
  - When failed: updates task with `{status: "failed", error: errorMessage}`
- [ ] In `exportKnowledgeBatch` worker loop:
  - Same pattern but with `id: "kf-" + item.fileId`, `type: "knowledge"`, `label: item.fileName`
  - `projectName` set to `item.projectName`
- [ ] During scan phase: a single task `{id: "scan", type: "scan", label: "Scanning conversations and projects...", status: "active"}` appears. Updated to `done` when scan finishes, or `failed` if scan errors.
- [ ] `UI.setStatus(msg)` is kept as a fallback and still works — it updates the small fallback status area (from US-001). It is used for non-task status messages like "Building ZIP...", "Backoff carryover", "Waiting for scan..."
- [ ] The per-conversation `UI.setStatus("Fetching: ...")` calls in `exportOneBatch` are replaced with `TaskList.update()` calls (setStatus is no longer called for per-item operations)
- [ ] The per-file `UI.setStatus("KF: Downloading ...")` calls in `exportKnowledgeBatch` are replaced with `TaskList.update()` calls
- [ ] Log messages (`addLog`) are NOT changed — they continue to log batch summaries, per-item results, and errors to the log textarea as before
- [ ] When `Exporter.stop()` is called or the export finishes, active tasks are not forcibly updated — they keep their last status (the user can see what was in progress when stopped)
- [ ] Verify in browser using playwright

## Functional Requirements

- FR-1: The stats panel shows exactly 2 rows: Row 1 has Exported count, Pending count, Dead count, and an inline progress bar. Row 2 has Projects count and KF exported/total count.
- FR-2: The stats panel no longer displays: Avg/chat, Avg/batch, ETA, Last stop, Last error, Delta since last scan, Delta pending.
- FR-3: Batch input, Rescan button, Start button, and Stop button are all in a single horizontal row.
- FR-4: The task list container is a scrollable div (180px height) between the controls row and the log area.
- FR-5: Each task in the list shows a status icon (`·`, `⟳`, `✓`, `✗`), optional `[ProjectName]` prefix, and the task label.
- FR-6: Active tasks show a spinning `⟳` via CSS animation and can display a sub-status detail line (e.g., "downloading 2/5 files").
- FR-7: Failed tasks show their error message in parentheses after the label (e.g., `✗ Chat Title (HTTP 429)`).
- FR-8: The task list uses a sliding window: all failed + all active + last ~30 completed + next ~10 queued. Not all pending conversations are shown.
- FR-9: The task list auto-scrolls to the bottom on updates, but stops auto-scrolling when the user scrolls up manually. Auto-scroll resumes when the user scrolls to the bottom.
- FR-10: Tasks are in-memory only — not persisted to IndexedDB. They reset when the bookmarklet is re-injected.
- FR-11: The log textarea height is 80px (reduced from 160px). It still shows batch summaries, errors, and scan results.
- FR-12: The version string is `cvz-bookmarklet-4.0`.
- FR-13: The bookmarklet panel remains 380px wide with height roughly 450-480px.
- FR-14: `exportOneBatch` creates/updates tasks for each conversation it processes instead of calling `UI.setStatus()` for per-item operations.
- FR-15: `exportKnowledgeBatch` creates/updates tasks for each knowledge file it processes instead of calling `UI.setStatus()` for per-item operations.
- FR-16: The scan phase shows a single "Scanning..." task (not one per conversation).
- FR-17: `UI.setStatus()` remains as a fallback for non-task status messages (e.g., "Building ZIP...", "Backoff carryover").

## Non-Goals (Out of Scope)

- No drag-and-drop task reordering — queue order is determined by the export pipeline
- No task filtering or search — the sliding window is the only view
- No persistent task history — tasks are transient UI state
- No collapsible project groups — the `[ProjectName]` prefix is sufficient
- No changes to `Exporter`, `exportOneBatch()`, or `exportKnowledgeBatch()` core logic (batch processing, retry, dead-letter) — only the UI calls within them change
- No changes to IndexedDB state schema or storage layer
- No dark/light theme toggle

## Design Considerations

### New Panel Layout (ASCII mockup)

```
+--------------------------------------+
| Convoviz Direct Export           [x] |  <- header
| cvz-bookmarklet-4.0 . IndexedDB     |  <- version
|                                      |
| Exported: 45 . Pending: 203 . [===] |  <- compact stats row 1
| Dead: 2 . Projects: 21 . KF: 5/12   |  <- compact stats row 2
|                                      |
| Batch [50]  [Rescan] [Start] [Stop]  |  <- single controls row
|                                      |
| +------------ Tasks ---------------+ |
| | done  [App Checker] Chat Title   | |  <- scrollable task list
| | done  Another Chat (3 files)     | |
| | >spin [Mac Laptop] DNS Mask...   | |  <- active (spinning icon)
| |   -> downloading 2/5 files       | |  <- sub-status detail
| | >spin Meeting Notes Review       | |
| | .     Queued Chat Title          | |  <- queued (dimmed)
| | X     Failed Chat (HTTP 429)     | |  <- failed (red)
| +----------------------------------+ |
|                                      |
| +------------ Log -----------------+ |
| | [12:34:56] Batch done: 50...     | |  <- compact log (80px)
| +----------------------------------+ |
|                                      |
| [Reset]                [Export state] |  <- footer
+--------------------------------------+
```

### Key CSS

The only animation needed is a spinner for active tasks:

```css
@keyframes cvz-spin { to { transform: rotate(360deg); } }
.cvz-task-active .cvz-spin {
  display: inline-block;
  animation: cvz-spin 1s linear infinite;
}
```

### Auto-scroll Detection

```js
// Before appending/updating:
const el = document.getElementById("cvz-tasks");
const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10;
// ... render ...
if (wasAtBottom) el.scrollTop = el.scrollHeight;
```

## Technical Considerations

- **Bookmarklet constraints**: Single file, no modules, no build tools. All HTML is string concatenation (no template literals). CSS injected via `<style>` element.
- **Integration is UI-only**: The task list is a rendering layer. The export pipeline logic (`Exporter`, batch processing, retry, dead-letter) does not change. Only the `UI.setStatus()` call sites within `exportOneBatch` and `exportKnowledgeBatch` are replaced with `TaskList.add/update` calls.
- **Concurrency**: Multiple workers call `TaskList.add/update` concurrently. Since JavaScript is single-threaded (no actual parallelism in `Promise.all` worker pattern), this is safe without locking.
- **Performance**: The task list should not re-render on every `renderAll()` timer tick (every 1 second). It should only re-render when `add()` or `update()` is called (dirty flag pattern). The `renderAll()` tick still updates the compact stats.
- **Sliding window sizing**: The ~30 completed / ~10 queued limits are soft caps, not hard requirements. The goal is keeping the DOM manageable (< 50 task elements).

## Success Metrics

- Users can see all 3 concurrent workers' current operations at a glance (instead of only the last `setStatus` call)
- Failed operations are immediately visible with their error messages (instead of requiring log scrollback)
- Panel height stays within ~450-480px (no significant growth despite adding the task list)
- No regression in export functionality (batch processing, retries, ZIP downloads all work identically)

## Open Questions

None — the brainstorm document fully specifies the design.
