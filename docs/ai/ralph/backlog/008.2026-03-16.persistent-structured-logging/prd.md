# PRD: Persistent Structured Logging for JS Exporter

**Project:** Convoviz
**Branch:**

## Introduction

The JS exporter runs for hours (sometimes overnight) and has no way to reconstruct what happened after the fact. Current logging is a 200-line rolling buffer of plain text strings in `ExportState.logs[]`, cleared on every startup. ~12 `console.error`/`console.warn` calls are invisible to the user (they go to the browser console, which is closed during long runs). Uncaught errors and unhandled promise rejections vanish silently.

This feature replaces the ephemeral `addLog(msg: string)` system with a unified structured log that supports real-time monitoring (UI textarea, info+ level) and post-mortem analysis (persistent IDB storage, JSONL export with full debug detail).

The user's stated goal: "full traceability... be able to detect when [the API] returns errors... details about the recoverability... understand what happened... put it all together as one journey."

## Goals

- Replace `addLog(msg: string)` with `log(level, category, message, context?)` across the entire codebase
- Persist all log entries (including debug) to a dedicated IDB database (`cvz-log`)
- Capture all `console.error`/`console.warn` calls and uncaught errors into the structured log
- Enable JSONL export of the full log history for offline analysis
- Display info+ entries in the existing UI textarea with level/category prefixes
- Remove `logs: string[]` from `ExportState` — logs are no longer part of export state

## User Stories

### US-001: LogStore — IDB Persistence Layer
**Status:** pending
**Description:** As a developer, I need a dedicated IDB store for log entries so that logs persist across page reloads and can be exported.

**Acceptance Criteria:**
- [ ] `LogEntry` interface defined: `{ id: number, timestamp: number, session: string, level: "debug" | "info" | "warn" | "error", category: string, message: string, context?: Record<string, unknown> }`
- [ ] Dedicated IDB database `cvz-log` with object store `entries` (keyPath: `id`, autoIncrement: true), and index on `session`
- [ ] Operations: `put(entry)` writes a single entry, `getAll()` returns all entries ordered by id, `count()` returns total entry count, `clear()` deletes all entries
- [ ] Retention cleanup function: if count > 100,000 delete oldest entries to bring count to 80,000. Uses `id` cursor (monotonically increasing) — no time-based queries needed
- [ ] Graceful degradation: if IDB is unavailable, `put()` becomes a no-op (no crash, no fallback to localStorage). A boolean `available` flag is exposed so callers know if persistence is active
- [ ] Unit tests using `fake-indexeddb` (matches existing test patterns in the codebase): write, read, count, clear, retention cleanup, IDB-unavailable fallback
- [ ] Typecheck passes (`npm run typecheck`)

### US-002: Core `log()` Function
**Status:** pending
**Description:** As a developer, I need a `log()` function that writes to both an in-memory array and IDB so that logs are available for real-time display and persistent analysis.

**Acceptance Criteria:**
- [ ] `log(level, category, message, context?)` function is synchronous from the caller's perspective
- [ ] Each call pushes a `LogEntry` to an in-memory array (current session, powers the UI textarea). No cap on in-memory array size — it holds the current session only
- [ ] Each call triggers an async IDB write via the LogStore from US-001. IDB write failures do not affect the in-memory array or the caller
- [ ] Session ID: 8-character random hex string, generated once per page load. Shared across all log entries in a session (multiple Start/Stop cycles within one page load share the same session)
- [ ] A `getSessionLogs()` function returns the in-memory array for the current session
- [ ] A `getLogCount()` async function returns the total number of persisted entries (for the "Download Logs" button label)
- [ ] Retention cleanup (from US-001) runs once on initialization
- [ ] Unit tests: entries pushed to in-memory array with correct schema, IDB write called, session ID consistency, IDB failure does not throw
- [ ] Typecheck passes

### US-003: Migrate All `addLog` Callsites to `log()`
**Status:** pending
**Description:** As a developer, I need to replace every `addLog(msg: string)` call with the structured `log()` function so that all log entries have level, category, and context.

**Acceptance Criteria:**
- [ ] All 6 dependency interfaces updated: `UIDeps`, `BootstrapDeps`, `CoordinatorDeps`, `NetDeps`, `ConversationScannerDeps`, `ReconcileDeps` — replace `addLog: (msg: string) => void` with `log: (level: LogLevel, category: string, message: string, context?: Record<string, unknown>) => void`
- [ ] All ~27 `addLog(...)` callsites migrated with appropriate level, category, and structured context. Follow the mapping from the brainstorm doc (e.g., `addLog("Start.")` → `log("info", "sys", "Start")`, rate limit → `log("warn", "net", "Rate limited", { status: 429, retryAfter, backoffCount })`, etc.)
- [ ] Categories used consistently: `sys`, `scan`, `chat`, `file`, `kf`, `net`, `ui`, `state`
- [ ] `createAddLog` factory function in `main.ts` removed
- [ ] `logs: string[]` removed from the `ExportState` interface and from the default state
- [ ] State merge logic (`reconcile.ts` or equivalent) handles loaded state gracefully — existing state files with the `logs` field are unaffected (extra fields ignored on load)
- [ ] The `log()` function is wired in `main.ts` and passed through the dependency tree (replacing `addLog` in the IIFE bootstrap)
- [ ] All existing tests that mock `addLog` updated to mock `log` with the new signature
- [ ] Typecheck passes
- [ ] All tests pass

### US-004: Capture Console Errors and Uncaught Exceptions
**Status:** pending
**Description:** As a user, I want all errors (including `console.error`, `console.warn`, and uncaught exceptions) captured in the structured log so that no diagnostic information is lost during overnight runs.

**Acceptance Criteria:**
- [ ] All ~12 `console.error`/`console.warn` calls across the codebase replaced with `log("error", ...)` or `log("warn", ...)` with appropriate category and context. No monkey-patching of `console`
- [ ] Global `window.addEventListener("error", ...)` handler captures uncaught errors: `log("error", "sys", "Uncaught error: " + e.message, { filename, lineno, colno })`
- [ ] Global `window.addEventListener("unhandledrejection", ...)` handler captures unhandled promise rejections: `log("error", "sys", "Unhandled promise rejection", { reason: String(e.reason) })`
- [ ] Startup log entry emitted on session start: `log("info", "sys", "Session started", { version: VER, sessionId, storageBackend: "idb" | "localStorage", userAgent })`
- [ ] Global error handlers registered early in the bootstrap sequence (before any async work)
- [ ] Tests verify global error handlers call `log()` with correct level/category
- [ ] Typecheck passes

### US-005: UI — Formatted Textarea and JSONL Export
**Status:** pending
**Description:** As a user, I want to see structured log entries in the panel's textarea and download the full log history as JSONL so that I can monitor runs in real-time and analyze them offline.

**Acceptance Criteria:**
- [ ] Textarea renders from the in-memory log array (not from `S.logs`). Format: `[HH:MM:SS] [LEVEL/category] message` (e.g., `[14:32:01] [WARN/net] Rate limited (429), retry in 30s`). The `context` object is NOT shown in the textarea
- [ ] Textarea filters to `info`, `warn`, and `error` entries only — `debug` entries are excluded from the display
- [ ] Auto-scroll to bottom on new entries (existing behavior preserved)
- [ ] "Download Logs" button added next to the existing "Export state" button. Label shows entry count: `Logs (1,234)` — count retrieved from LogStore (IDB) and updated periodically or on render
- [ ] Clicking "Download Logs" reads all entries from `cvz-log` IDB, serializes each as a JSON line (one JSON object per line), creates a Blob, triggers browser download with filename `cvz-logs-{YYYY-MM-DD-HHmmss}.jsonl`
- [ ] JSONL entries include all fields: `id`, `timestamp`, `session`, `level`, `category`, `message`, `context`
- [ ] `__cvz_clearLogs()` debug alias exposed on `window` — calls `logStore.clear()` and logs confirmation to console
- [ ] "Reset" button behavior unchanged — it does NOT clear logs (logs are diagnostic data you'd want even after resetting export state)
- [ ] Tests: textarea formatting, level filtering (debug excluded), JSONL serialization format (one JSON object per line, all fields present)
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Define `LogEntry` interface with fields: `id` (auto-increment PK), `timestamp` (Unix ms), `session` (8-char hex), `level` (debug/info/warn/error), `category` (string), `message` (string), `context` (optional Record)
- FR-2: Create dedicated IDB database `cvz-log` with object store `entries` (keyPath: `id`, autoIncrement: true) and index on `session`
- FR-3: Implement `log(level, category, message, context?)` that synchronously pushes to an in-memory array and asynchronously writes to IDB
- FR-4: Generate session ID (8-char random hex) once per page load; shared across all entries in that session
- FR-5: Run retention cleanup on startup: if entries > 100,000, delete oldest to bring count to 80,000
- FR-6: Replace `addLog: (msg: string) => void` with `log(level, category, message, context?)` in all 6 dependency interfaces and all ~27 callsites
- FR-7: Remove `logs: string[]` from `ExportState` interface; handle gracefully on load (ignore extra field in existing state files)
- FR-8: Replace all ~12 `console.error`/`console.warn` calls with structured `log()` calls
- FR-9: Register global `window.error` and `window.unhandledrejection` handlers early in bootstrap
- FR-10: Emit startup log entry with version, session ID, storage backend, and user agent
- FR-11: Format textarea as `[HH:MM:SS] [LEVEL/category] message`, filtered to info+ level
- FR-12: Add "Download Logs" button with entry count label; exports all entries as JSONL (filename: `cvz-logs-{YYYY-MM-DD-HHmmss}.jsonl`)
- FR-13: Expose `window.__cvz_clearLogs()` debug alias

## Non-Goals

- No log upload/import — download only
- No in-app log viewer with search/filter — the textarea is for real-time monitoring; analysis happens offline with the JSONL export
- No log shipping to external services — this is a browser bookmarklet, not a server
- No per-run log separation — sessions and lifecycle events provide enough structure to identify runs
- No color coding in the textarea — it's a plain `<textarea>`, not rich text
- No interactive filtering (level dropdown, category checkboxes) — YAGNI
- No monkey-patching of `console.error`/`console.warn` — direct replacement only
- No micro-batching of IDB writes — individual `put()` per entry is sufficient at expected throughput (1-10 entries/second)
- No localStorage fallback for log persistence — IDB-only with graceful degradation to in-memory

## Technical Considerations

- **IDB separation**: `cvz-log` is a separate database from `cvz-export`, `cvz-discovery`, and `cvz-export-blobs`. Different retention policies, no risk of log growth interfering with export operations, independent versioning
- **Write strategy**: Individual IDB `put()` per entry. At 1-10 entries/second during active export, individual writes are fine. Micro-batching can be added as an internal optimization later without changing the `log()` interface
- **Storage budget**: ~100,000 entries at ~300 bytes/entry average ≈ 30MB — negligible compared to 800MB+ export blobs
- **IDB fallback mode**: If IDB is unavailable (localStorage fallback mode for export state), logs are in-memory only. Current session's logs are still viewable and exportable, but won't survive page reloads
- **Migration is mechanical**: TypeScript types enforce correctness at every callsite. Renaming `addLog` to `log` with a different signature will produce compile errors at every callsite that needs updating
- **Existing test patterns**: `fake-indexeddb` is already used for IDB tests; the same patterns apply to the new LogStore
- **No `renderLogs` callback needed**: The textarea can poll the in-memory array on a requestAnimationFrame or be driven by the same save-debounce cycle. The current `renderLogs()` call inside `createAddLog` is replaced by the UI reading from the in-memory array

## Success Metrics

- All log entries (including debug) persisted to IDB and exportable as JSONL
- Zero `console.error`/`console.warn` calls remaining in the codebase — all routed through structured `log()`
- Uncaught errors and unhandled promise rejections captured in the log
- User can download JSONL after an overnight run and filter by `conversationId`, `session`, `category`, or `level` to reconstruct the full journey
- No regression in export performance — `log()` calls are synchronous from the caller's perspective

## Open Questions

None — the brainstorm document resolved all design decisions.
