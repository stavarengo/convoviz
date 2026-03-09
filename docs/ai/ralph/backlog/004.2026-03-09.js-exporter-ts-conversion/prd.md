# PRD: Convert js/script.js to TypeScript App

**Project:** Convoviz
**Branch:** ralph/004.2026-03-09.js-exporter-ts-conversion

## Introduction

`js/script.js` is a 1680-line monolithic bookmarklet (`javascript:` IIFE) that exports ChatGPT conversations directly from the browser. It contains a custom ZIP builder, IndexedDB persistence, network layer with auth/retry/backoff, DOM-injected floating panel UI, conversation/project scanner, batch export pipeline, and task list tracker — all in a single file.

The goal is to convert this into a proper TypeScript project in `./js-exporter/` while preserving **identical runtime behavior**. The final output remains a single `javascript:` IIFE bookmarklet, built via esbuild.

This is a **strict 1:1 port** — no behavior changes, no refactoring of logic. The source of truth is `js/script.js` as it exists today.

## Goals

- Decompose the monolithic `js/script.js` into typed, modular TypeScript files under `js-exporter/src/`
- Preserve identical runtime behavior — same state shape, same API calls, same UI, same ZIP output
- Establish a Vitest test suite covering all extracted modules
- Produce a bundled IIFE bookmarklet via esbuild that replaces the hand-written one
- Enable future maintainability through type safety and module boundaries

## User Stories

### US-001: Project scaffolding
**Status:** pending
**Description:** As a developer, I want the TypeScript project skeleton set up so that subsequent stories can add modules incrementally.

**Acceptance Criteria:**
- [ ] Create `js-exporter/package.json` with:
  - `name`: `"convoviz-exporter"`
  - `private: true`
  - `scripts`: `build`, `build:dev`, `test`, `test:watch`, `typecheck` (as specified in the brainstorm's npm scripts section)
  - `devDependencies`: `typescript`, `esbuild`, `vitest`, `jsdom`, `fake-indexeddb`
- [ ] Create `js-exporter/tsconfig.json` targeting `es2020`, with `strict: true`, `moduleResolution: "bundler"`, `module: "ESNext"`, `outDir: "dist"`, `rootDir: "src"`, `noEmit: true` (esbuild handles emit)
- [ ] Create `js-exporter/vitest.config.ts` with default Node environment (jsdom will be set per-file where needed via `@vitest-environment jsdom` comment)
- [ ] Create the empty directory structure under `js-exporter/src/`: `utils/`, `zip/`, `state/`, `net/`, `ui/`, `scan/`, `export/`
- [ ] Create the empty directory structure under `js-exporter/tests/`: `utils/`, `zip/`, `state/`, `net/`, `ui/`, `scan/`, `export/`
- [ ] `cd js-exporter && npm install` succeeds
- [ ] `cd js-exporter && npm run typecheck` succeeds (with no source files yet, this should be a no-op pass)
- [ ] `cd js-exporter && npm test` succeeds (0 tests, 0 failures)
- [ ] Add `js-exporter/node_modules/` and `js-exporter/dist/` to the root `.gitignore`

### US-002: Shared type definitions
**Status:** pending
**Description:** As a developer, I want all shared interfaces and type aliases extracted into `types.ts` so that subsequent modules can import them.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/types.ts` with all interfaces extracted from the monolith's implicit shapes in `js/script.js`:
  - `ExportState` — the top-level `S` object shape (lines 184-236 of `js/script.js` define `defaultState()` which reveals the full shape)
  - `Settings` — `S.settings` sub-shape
  - `Progress` — `S.progress` sub-shape
  - `ScanState` — `S.scan` sub-shape
  - `RunState` — `S.run` sub-shape
  - `Stats` — `S.stats` sub-shape
  - `Changes` — return type of `computeChanges()` (line 1048)
  - `PendingItem`, `DeadItem` — items in `S.progress.pending` / `S.progress.dead`
  - `KfPendingItem`, `KfDeadItem` — items in `S.progress.kfPending` / `S.progress.kfDead`
  - `ProjectInfo` — items in `S.projects` array (see `scanProjects()` at line 961)
  - `FileRef` — return items of `extractFileRefs()` (line 877)
  - `Task`, `TaskStatus` — items in `TaskList._tasks` (line 534)
- [ ] All types are `export`ed
- [ ] `cd js-exporter && npm run typecheck` passes
- [ ] No runtime code — only type definitions and interfaces

### US-003: Utility modules
**Status:** pending
**Description:** As a developer, I want the pure utility functions ported to TypeScript with tests so that other modules can depend on them.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/utils/format.ts` exporting: `now`, `clamp`, `safeJsonParse`, `fmtMs`, `fmtTs` — ported from lines 5-34 of `js/script.js`. Behavior must be identical.
- [ ] Create `js-exporter/src/utils/sanitize.ts` exporting: `sanitizeName` — ported from lines 36-42. Behavior must be identical.
- [ ] Create `js-exporter/src/utils/binary.ts` exporting: `enc`, `u16`, `u32` — ported from lines 35, 66-67. Behavior must be identical.
- [ ] Create `js-exporter/tests/utils/format.test.ts` testing:
  - `fmtMs`: returns "-" for 0/negative/NaN/Infinity; formats seconds, minutes, hours correctly
  - `fmtTs`: returns "-" for falsy; formats valid timestamps via `toLocaleString`
  - `clamp`: clamps correctly at both bounds
  - `safeJsonParse`: returns parsed value for valid JSON, fallback for invalid
- [ ] Create `js-exporter/tests/utils/sanitize.test.ts` testing:
  - Strips control characters and forbidden filename chars
  - Collapses whitespace, trims, truncates at 180 chars
  - Returns "file" for empty/falsy input
- [ ] Create `js-exporter/tests/utils/binary.test.ts` testing:
  - `enc`: produces correct Uint8Array for ASCII and multi-byte strings
  - `u16`: correct little-endian 2-byte encoding
  - `u32`: correct little-endian 4-byte encoding
- [ ] `cd js-exporter && npm test` — all util tests pass
- [ ] `cd js-exporter && npm run typecheck` passes

### US-004: ZIP module
**Status:** pending
**Description:** As a developer, I want the CRC-32 and ZipLite classes ported to TypeScript with tests so that the export pipeline can build ZIP archives.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/zip/crc32.ts` exporting: `crcTable`, `crc32` — ported from lines 43-56 of `js/script.js`. Same CRC-32 polynomial (0xEDB88320), same output for identical inputs.
- [ ] Create `js-exporter/src/zip/zip-lite.ts` exporting: `ZipLite` class with methods `addBytes(name, u8)`, `addBlob(name, blob)`, `buildBlob()` and helper `dosTimeDate(date)` — ported from lines 57-183. Imports `enc`, `u16`, `u32` from `../utils/binary` and `crc32` from `./crc32`.
- [ ] Create `js-exporter/tests/zip/crc32.test.ts` testing:
  - Known input/output pairs (e.g., CRC-32 of empty buffer, CRC-32 of "hello")
  - Table has exactly 256 entries
- [ ] Create `js-exporter/tests/zip/zip-lite.test.ts` testing:
  - `addBytes` + `buildBlob` produces a valid ZIP (check local file header signature `0x04034b50`, central directory signature `0x02014b50`, end-of-central-directory signature `0x06054b50`)
  - CRC-32 checksums in the ZIP match `crc32()` output for the same data
  - Multiple entries produce correct offsets
  - `dosTimeDate` encodes date/time correctly for known dates
- [ ] `cd js-exporter && npm test` — all zip tests pass
- [ ] `cd js-exporter && npm run typecheck` passes

### US-005: State management module
**Status:** pending
**Description:** As a developer, I want state defaults, IndexedDB/localStorage persistence, and save debouncing ported to TypeScript with tests.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/state/defaults.ts` exporting: `KEY`, `VER`, `defaultState()`, `mergeState(s)` — ported from lines 3-4, 184-288 of `js/script.js`. `defaultState()` must produce the exact same shape. `mergeState()` must handle the same migration logic (version checking, field carry-over, nested merge for settings/progress/scan/run/stats).
- [ ] Create `js-exporter/src/state/store.ts` exporting: `initIdb()`, `Store` object with `load()`, `save(state)`, `reset()` — ported from lines 289-378. Uses IndexedDB with localStorage fallback.
- [ ] Create `js-exporter/src/state/debounce.ts` exporting: `createSaveDebounce(store, state)` factory — ported from lines 380-396. Returns a debounced save function that batches saves.
- [ ] Create `js-exporter/tests/state/defaults.test.ts` testing:
  - `defaultState()` returns correct shape with all expected nested fields
  - `mergeState()` preserves existing values for known fields, drops unknown fields
  - `mergeState()` handles version migration (old version → current version)
  - `mergeState()` handles null/undefined input gracefully
- [ ] Create `js-exporter/tests/state/store.test.ts` testing (using `fake-indexeddb`):
  - `initIdb()` opens IndexedDB successfully
  - `Store.save()` + `Store.load()` round-trips state correctly
  - `Store.reset()` clears saved state
  - Falls back to localStorage when IndexedDB is unavailable
- [ ] `cd js-exporter && npm test` — all state tests pass
- [ ] `cd js-exporter && npm run typecheck` passes

### US-006: Network layer module
**Status:** pending
**Description:** As a developer, I want the sleep utility and Net object ported to TypeScript with tests so that API calls can be made with retry/backoff.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/net/sleep.ts` exporting: `sleep(ms, signal?)` — ported from lines 412-428 of `js/script.js`. Returns a promise that resolves after `ms` milliseconds, rejects immediately if `signal` is already aborted, and rejects on abort during sleep.
- [ ] Create `js-exporter/src/net/net.ts` exporting: `createNet(deps)` factory that returns a `Net` object with methods `getToken(signal?)`, `_fetch(url, opts)`, `fetchJson(url, opts)`, `fetchBlob(url, opts)`, `download(blob, filename)` — ported from lines 430-531. Dependencies injected: state reference `S`, `addLog` callback, `UI.setStatus` callback.
  - `getToken` caches auth token, refreshes via `/api/auth/session`
  - `_fetch` handles retry with exponential backoff, 429/rate-limit detection, abort signal propagation
  - `fetchJson` / `fetchBlob` are thin wrappers over `_fetch`
  - `download` creates and clicks a temporary `<a>` element
- [ ] Create `js-exporter/tests/net/sleep.test.ts` testing:
  - Resolves after specified delay
  - Rejects with AbortError when signal is aborted
  - Rejects immediately if signal is already aborted
- [ ] Create `js-exporter/tests/net/net.test.ts` testing:
  - `getToken` fetches from `/api/auth/session` and caches the token
  - `_fetch` retries on 429 with backoff
  - `_fetch` respects abort signal
  - `fetchJson` parses response as JSON
  - `fetchBlob` returns response as Blob
- [ ] `cd js-exporter && npm test` — all net tests pass
- [ ] `cd js-exporter && npm run typecheck` passes

### US-007: Scan module
**Status:** pending
**Description:** As a developer, I want the conversation/project scanning and file-ref extraction ported to TypeScript with tests.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/scan/file-refs.ts` exporting: `extractFileRefs(chatJson)` — ported from lines 877-914 of `js/script.js`. Extracts file references from conversation JSON by walking `mapping` → `message` → `metadata.attachments` and `content.parts` with `asset_pointer`. Returns `FileRef[]`.
- [ ] Create `js-exporter/src/scan/changes.ts` exporting: `computeChanges(prevSnap, items, freshPending)` — ported from lines 1048-1080. Computes diff between scan snapshots (new chats, updated chats, removed chats, pending delta).
- [ ] Create `js-exporter/src/scan/conversations.ts` exporting: `scanConversations(net, state, signal, onPage, knownIds)` — ported from lines 915-960. Paginated API scanning of `/backend-api/conversations`.
- [ ] Create `js-exporter/src/scan/projects.ts` exporting: `scanProjects(net, signal, onProject)` and `scanProjectConversations(net, gizmoId, signal, onPage, knownIds)` — ported from lines 961-1046. Project scanning via snorlax sidebar API + per-project conversation scanning.
- [ ] Create `js-exporter/tests/scan/file-refs.test.ts` testing:
  - Extracts file refs from attachments with `download_url`
  - Extracts file refs from `asset_pointer` fields, stripping `sediment://` prefix
  - Handles conversations with no attachments (returns empty array)
  - Deduplicates by file ID (using `seen` set)
- [ ] Create `js-exporter/tests/scan/changes.test.ts` testing:
  - Detects new chats (present in items, absent from prevSnap)
  - Detects updated chats (present in both, different `update_time`)
  - Computes correct pending delta
- [ ] Create `js-exporter/tests/scan/conversations.test.ts` testing:
  - Paginates correctly using offset + limit
  - Stops when receiving empty page
  - Respects `knownIds` for early termination (consecutive known pages)
- [ ] Create `js-exporter/tests/scan/projects.test.ts` testing:
  - Paginates projects using cursor
  - Extracts project info (gizmoId, name, emoji, files)
  - Per-project conversation scanning paginates with cursor
- [ ] `cd js-exporter && npm test` — all scan tests pass
- [ ] `cd js-exporter && npm run typecheck` passes

### US-008: TaskList module
**Status:** pending
**Description:** As a developer, I want the in-memory task tracker ported to TypeScript with tests.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/ui/task-list.ts` exporting: `createTaskList()` factory returning a `TaskList` object with methods `add(task)`, `update(id, status, opts?)`, `getVisible()`, `render()` — ported from lines 534-626 of `js/script.js`.
  - `getVisible()` implements the windowing logic: last 30 done, first 10 queued, all active and failed
  - `render()` generates HTML into `#cvz-tasks` element
- [ ] Create `js-exporter/tests/ui/task-list.test.ts` testing:
  - `add` creates a task with correct initial status
  - `update` changes status and optional fields (error, fileCount)
  - `getVisible` windowing: returns at most 30 done (most recent), all active, all failed, at most 10 queued (first)
  - Order: failed first, then active, then queued, then done
  - `render` produces correct HTML with status-specific CSS classes and prefixes
- [ ] Tests that exercise `render()` must use jsdom environment (via `// @vitest-environment jsdom` comment at top of test file)
- [ ] `cd js-exporter && npm test` — all task-list tests pass
- [ ] `cd js-exporter && npm run typecheck` passes

### US-009: UI Panel module
**Status:** pending
**Description:** As a developer, I want the floating panel UI ported to TypeScript with tests.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/ui/panel.ts` exporting: `createUI(deps)` factory returning a `UI` object with methods `inject()`, `renderAll()`, `renderLogs()`, `renderProjects()`, `setStatus(msg)`, `setBar(pct)` — ported from lines 627-869 of `js/script.js`.
  - Dependencies injected: state reference `S`, `addLog` callback, Net reference, Exporter reference, TaskList reference, `saveDebounce` callback
  - `inject()` creates and appends the floating panel DOM (div with id `cvz-resume-ui`)
  - `renderAll()` updates stats display (exported/pending/dead counts, batch size, project filter, progress bar)
  - `renderLogs()` updates the log panel from `S.logs`
  - Event handlers: start/stop buttons, batch size input, export-state button, maximize toggle, single-project filter checkbox and dropdown
- [ ] Create `js-exporter/tests/ui/panel.test.ts` testing (jsdom environment):
  - `inject()` creates the panel with expected DOM structure (id `cvz-resume-ui`, key sub-elements `#cvz-status`, `#cvz-bar`, `#cvz-log`, `#cvz-tasks`, `#cvz-batch`, `#cvz-max`)
  - `setStatus(msg)` updates `#cvz-status` text content
  - `setBar(pct)` updates `#cvz-bar` width style
  - `renderLogs()` populates `#cvz-log` from `S.logs` array
  - `renderAll()` reflects correct counts from state
  - Does not inject duplicate panels (checks for existing `#cvz-resume-ui`)
- [ ] `cd js-exporter && npm test` — all panel tests pass
- [ ] `cd js-exporter && npm run typecheck` passes

### US-010: Exporter module
**Status:** pending
**Description:** As a developer, I want the core export pipeline (rescan, start, stop, batch export) ported to TypeScript with tests.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/export/exporter.ts` exporting: `createExporter(deps)` factory returning an `Exporter` object with methods `rescan()`, `start()`, `stop()`, `exportOneBatch()`, `exportKnowledgeBatch()` — ported from lines 1082 onward of `js/script.js`.
  - Dependencies injected: state reference `S`, Net, UI, TaskList, `addLog`, `saveDebounce`, scan functions, `extractFileRefs`
  - `rescan()` orchestrates conversation + project scanning with abort controller
  - `start()` enters the export loop, calling `exportOneBatch()` repeatedly
  - `stop()` aborts the current operation via abort controller
  - `exportOneBatch()` exports one batch of conversations: fetches detail JSON, extracts file refs, downloads files, builds ZIP, triggers download
  - `exportKnowledgeBatch()` exports project knowledge files with `?gizmo_id=` parameter
- [ ] Create `js-exporter/tests/export/exporter.test.ts` testing:
  - `rescan()` calls scan functions and updates state
  - `start()` / `stop()` manage the running state correctly
  - `exportOneBatch()` processes pending items, moves them to exported/dead as appropriate
  - `exportKnowledgeBatch()` processes kfPending items
  - Abort signal propagation stops in-progress operations
- [ ] `cd js-exporter && npm test` — all exporter tests pass
- [ ] `cd js-exporter && npm run typecheck` passes

### US-011: Entry point and wiring
**Status:** pending
**Description:** As a developer, I want `main.ts` to wire all modules together as the IIFE composition root, matching the monolith's initialization sequence.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/main.ts` that:
  1. Calls `assertOnChatGPT()` — checks `location.hostname` includes `chatgpt.com` (ported from line 408)
  2. Calls `initIdb()` to initialize IndexedDB
  3. Loads state via `Store.load()`, applies `mergeState()`
  4. Creates the `saveDebounce` function
  5. Creates `addLog` factory function that writes to `S.logs`, calls `saveDebounce(false)`, and calls `UI.renderLogs()`
  6. Creates Net, TaskList, UI, and Exporter instances, wiring dependencies
  7. Calls `UI.inject()` to mount the floating panel
  8. Wires event handlers (start/stop/rescan buttons)
  9. Exposes `window.__cvz_state`, `window.__cvz_stop`, `window.__cvz_reset` globals
  10. Handles interrupted-run recovery (if `S.run.running` was true on load)
- [ ] The entire `main.ts` body is wrapped in an async IIFE with try/catch (matching the monolith's structure)
- [ ] `cd js-exporter && npm run typecheck` passes
- [ ] All existing tests continue to pass

### US-012: Build verification
**Status:** pending
**Description:** As a developer, I want to verify the esbuild bundle produces a valid IIFE bookmarklet that can replace the hand-written one.

**Acceptance Criteria:**
- [ ] `cd js-exporter && npm run build` succeeds — produces `dist/script.min.js` (minified IIFE) and `dist/bookmarklet.js` (prefixed with `javascript:`)
- [ ] `cd js-exporter && npm run build:dev` succeeds — produces `dist/script.js` (readable IIFE)
- [ ] `dist/bookmarklet.js` starts with `javascript:`
- [ ] `dist/script.min.js` is a syntactically valid JavaScript file (parseable without errors)
- [ ] The bundled output is a single IIFE — no module system artifacts, no `require`/`import` statements in output
- [ ] Bundle size is reasonable (the original `script.min.js` is the baseline — the TS version should be within 20% of that size)
- [ ] `cd js-exporter && npm test` — all tests still pass after build
- [ ] `cd js-exporter && npm run typecheck` passes

## Functional Requirements

- FR-1: All TypeScript source lives under `js-exporter/src/`, all tests under `js-exporter/tests/`
- FR-2: Every function and class ported from `js/script.js` must produce identical behavior for identical inputs
- FR-3: The `ExportState` type must exactly match the shape produced by `defaultState()` in the monolith (lines 184-236)
- FR-4: `mergeState()` must handle all the same version migration and field carry-over logic as the original
- FR-5: The CRC-32 implementation must use the same polynomial (0xEDB88320) and produce the same checksums
- FR-6: ZipLite must produce byte-identical ZIP structures for the same inputs (same header layout, same offsets)
- FR-7: `extractFileRefs()` must return the same file references for the same conversation JSON
- FR-8: The UI panel must inject the same DOM structure with the same element IDs (`cvz-resume-ui`, `cvz-status`, `cvz-bar`, `cvz-log`, `cvz-tasks`, `cvz-batch`, `cvz-max`, etc.)
- FR-9: `window.__cvz_state`, `window.__cvz_stop`, `window.__cvz_reset` must be exposed exactly as in the monolith
- FR-10: The build pipeline must produce a single-file IIFE bookmarklet via esbuild
- FR-11: Modules receive dependencies via injection (factory functions or context objects) — no global singletons
- FR-12: `addLog` is a factory function created in `main.ts` that closes over `S`, `saveDebounce`, and `UI`, passed to modules via their context

## Non-Goals

- No behavior changes — this is a strict 1:1 port
- No refactoring of logic patterns (e.g., don't convert callback patterns to async/await unless the original uses it)
- No browser extension build
- No new features
- The Python side of convoviz is untouched
- Deletion of `js/` directory — this requires manual user approval and is outside the scope of this PRD
- No changes to the existing Playwright tests in `js/tests/`

## Technical Considerations

- **Source of truth:** `js/script.js` as it currently exists (1680 lines). Every function ported must match its behavior exactly.
- **Bundler:** esbuild with `--bundle --format=iife --target=es2020`. No Webpack, no Rollup.
- **Testing:** Vitest with jsdom environment for DOM tests, default Node environment for pure logic. `fake-indexeddb` for store tests.
- **Package manager:** npm (not yarn, not pnpm, not bun).
- **Style consistency:** The monolith uses a mix of arrow functions and `function(){}` syntax. In the TS version, prefer arrow functions for consistency, but match the original's semantic behavior (especially `this` binding in object methods).
- **Cross-cutting `addLog`:** The most-used function in the monolith. In TS, it's a factory function in `main.ts` that closes over `S`, `saveDebounce`, and `UI`. Passed to modules that need it.
- **Shared mutable state:** `main.ts` creates `S` and `UI`, passes them to modules via dependency injection. No global singletons.
- **Constants:** `KEY` ("__cvz_export_state_v1__") and `VER` ("cvz-bookmarklet-4.5") live in `state/defaults.ts`.
- **The `dist/` directory and `node_modules/` should be gitignored.**

## Success Metrics

- All Vitest tests pass (`cd js-exporter && npm test`)
- TypeScript compiles without errors (`cd js-exporter && npm run typecheck`)
- esbuild produces a valid IIFE bookmarklet (`cd js-exporter && npm run build`)
- Bundle size within 20% of the original `js/script.min.js`
- Every module has corresponding test coverage

## Open Questions

None — the brainstorm document fully specifies the design, module boundaries, and migration order.
