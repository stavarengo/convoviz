# PRD: IDB-Based Export Accumulation & Single Final Zip

**Project:** Convoviz (js-exporter)
**Branch:** ralph/005.2026-03-14.idb-export-accumulation

## Introduction

The js-exporter bookmarklet currently downloads a separate ZIP file per batch (default 50 conversations each). A large export (500+ conversations) produces 10+ ZIP files that the user must manually merge before importing into convoviz. This is error-prone and creates a poor user experience.

This feature replaces per-batch ZIP downloads with IndexedDB-based accumulation. Conversations, knowledge files, and their assets are stored in IDB as they're exported. Once the export completes (or on user demand), a single ZIP file is generated via the File System Access API (FSAA) and streamed directly to disk — producing a file compatible with convoviz's loader without any post-processing.

## Goals

- Eliminate multi-ZIP merging: users get a single file ready for convoviz import
- Accumulate exported data in IDB so it survives page reloads and allows resume
- Stream the final ZIP directly to disk via FSAA to avoid memory pressure on large exports
- Support both conversation and knowledge file (KF) accumulation in a single ZIP
- Provide a "Download" button showing accumulated size, usable mid-export or after completion
- Maintain compatibility with convoviz's split-file loader (`conversations-NNN.json` pattern)

## User Stories

### US-001: IDB Export Database & Helper Module

**Status:** done
**Description:** As a developer, I need a separate IDB database (`cvz-export-blobs`) with `conv` and `files` object stores, plus a helper module exposing cursor-based iteration, so that export data can be accumulated without affecting the existing state database.

**Acceptance Criteria:**
- [ ] New IDB database `cvz-export-blobs` with two object stores: `conv` (keyed by conversation ID, value is JSON string) and `files` (keyed by zip-relative path, value is `Blob`)
- [ ] Helper module exports: `putConv(id, json)`, `putFile(path, blob)`, `getAllConvKeys()`, `iterateConvs(cb)`, `iterateFiles(cb)`, `totalSize()`, `clear()`
- [ ] `iterate*` methods use IDB cursors (not `getAll()`) to avoid loading everything into memory
- [ ] `totalSize()` sums blob sizes across both stores for UI display
- [ ] `clear()` deletes all data from both stores
- [ ] All methods use short-lived transactions (no long-held locks)
- [ ] Helper is initialized during app startup in `main.ts` alongside existing IDB init
- [ ] Typecheck/lint passes
- [ ] Unit tests for put/get/iterate/clear operations

### US-002: Modify Conversation Export to Accumulate in IDB

**Status:** done
**Description:** As a user, I want my exported conversations to accumulate in IDB instead of downloading a ZIP per batch, so that I get a single file at the end.

**Acceptance Criteria:**
- [ ] `exportOneBatch()` no longer creates a `ZipLite` instance or calls `net.download()`
- [ ] After fetching each conversation's JSON, it calls `IDB.putConv(id, jsonString)`
- [ ] After fetching each asset blob, it calls `IDB.putFile(zipPath, blob)` where `zipPath` is the zip-relative path (e.g., `file-abc123.png`)
- [ ] `S.progress.exported` is still updated as before (map of `{convId: update_time}`)
- [ ] After each batch completes, `IDB.totalSize()` is called and the UI is updated with the accumulated size
- [ ] Dead-letter queue, fail counts, and requeue logic remain unchanged
- [ ] Typecheck/lint passes
- [ ] Existing state persistence (debounce saves) still works correctly

### US-003: Modify Knowledge File Export to Accumulate in IDB

**Status:** done
**Description:** As a user, I want knowledge files to also accumulate in IDB alongside conversations, so that the final ZIP contains everything.

**Acceptance Criteria:**
- [ ] `exportKnowledgeBatch()` no longer creates a `ZipLite` instance or calls `net.download()`
- [ ] KF project metadata is stored via `IDB.putFile('kf/<projectName>/project.json', blob)`
- [ ] KF binary files are stored via `IDB.putFile('kf/<projectName>/<filename>', blob)`
- [ ] `S.progress.kfExported` is still updated as before
- [ ] KF dead-letter queue, fail counts, and requeue logic remain unchanged
- [ ] After each KF batch, accumulated size in UI is updated
- [ ] Typecheck/lint passes

### US-004: Streaming ZIP Writer

**Status:** done
**Description:** As a developer, I need a streaming ZIP writer that writes entries directly to a `WritableStream`, so that final ZIP generation doesn't require holding the entire archive in memory.

**Acceptance Criteria:**
- [ ] New `StreamingZip` class with API: `constructor(writable: WritableStream)`, `addEntry(path, data: Uint8Array | Blob)`, `finalize()`
- [ ] Uses STORE method (no compression), same as existing `ZipLite`
- [ ] For `Blob` data, reads in chunks via `blob.stream().getReader()` to avoid materializing the entire blob in memory
- [ ] Tracks each entry's offset, CRC-32, and size for the central directory
- [ ] `finalize()` writes the central directory and end-of-central-directory record
- [ ] Central directory entries are the only thing accumulated in memory (~100 bytes per entry)
- [ ] Typecheck/lint passes
- [ ] Unit tests verifying the output is a valid ZIP (can be extracted by a standard unzip tool or the existing `ZipLite` tests)

### US-005: Final ZIP Generation via FSAA

**Status:** done
**Description:** As a user, I want to generate a single ZIP file from all accumulated IDB data, streamed directly to disk via the File System Access API, so that large exports don't run out of memory.

**Acceptance Criteria:**
- [ ] `generateFinalZip()` function calls `showSaveFilePicker()` with suggested name `chatgpt-export.zip`
- [ ] Opens a `FileSystemWritableStream` from the picked file handle
- [ ] Iterates the `conv` store via cursor, batching conversations into groups of 100, serializing each batch as `conversations-NNN.json` (1-indexed, 3-digit zero-padded) and writing to the stream via `StreamingZip`
- [ ] Iterates the `files` store via cursor, writing each entry to the stream with its IDB key as the zip path
- [ ] Calls `StreamingZip.finalize()` and closes the writable stream
- [ ] If `showSaveFilePicker` is not available (Firefox/Safari) or the user cancels the picker, shows an error message in the status line explaining that a Chromium-based browser is required
- [ ] The generated ZIP matches the structure: `conversations-NNN.json` files at root, asset files at root, KF files under `kf/<projectName>/`
- [ ] Typecheck/lint passes
- [ ] Integration test: generate a ZIP from test IDB data and verify it can be loaded by convoviz's `loaders.py` (or at minimum, verify the internal structure matches expectations)

### US-006: Download Button & Accumulated Size Display

**Status:** done
**Description:** As a user, I want to see how much data has been accumulated and have a button to download the final ZIP at any time, so that I can monitor progress and trigger the download when ready.

**Acceptance Criteria:**
- [ ] New "Download" button in the UI panel, visible only when `IDB.totalSize() > 0`
- [ ] Button label shows accumulated size: `Download (12.3 MB)`
- [ ] Clicking the button triggers `generateFinalZip()`
- [ ] Button is disabled during active export batch processing (prevents concurrent IDB reads during zip generation)
- [ ] `generateFinalZip()` is automatically triggered when the full export completes (all pending conversations and KF items exported)
- [ ] Size display updates after each batch completes
- [ ] Typecheck/lint passes

### US-007: Status Line — Accumulated Counter

**Status:** done
**Description:** As a user, I want to see an "Accumulated" size counter in the status display, so that I can track how much data has been stored in IDB.

**Acceptance Criteria:**
- [ ] The stats box in the UI panel shows an "Accumulated: X MB" counter
- [ ] Counter reflects `IDB.totalSize()` and updates after each batch
- [ ] Format: human-readable size (e.g., `42.7 MB`, `1.2 GB`)
- [ ] Counter is visible alongside existing stats (Exported, Pending, Dead, etc.)
- [ ] Typecheck/lint passes

### US-008: Reset Clears Export IDB

**Status:** done
**Description:** As a user, I want the Reset action to also clear accumulated export data from IDB, so that I can start fresh.

**Acceptance Criteria:**
- [ ] The existing "Reset" action additionally calls `IDB.clear()` on the `cvz-export-blobs` database
- [ ] The confirmation dialog mentions that accumulated export data will be lost
- [ ] After reset, the "Download" button is hidden (size is 0)
- [ ] The "Accumulated" counter resets to 0
- [ ] Typecheck/lint passes

### US-009: Page Reload Persistence & Resume

**Status:** done
**Description:** As a user, I want accumulated export data to persist across page reloads, so that I can resume or download after a browser restart.

**Acceptance Criteria:**
- [ ] On page load, if `cvz-export-blobs` contains data, the "Download" button is shown with the correct accumulated size
- [ ] The existing `S.progress.exported` map (stored in `cvz-state` / `cvz-export`) correctly tracks which conversations are already in IDB, so re-scanning doesn't re-export them
- [ ] If an export was interrupted (page reload mid-batch), the partially-exported batch's conversations that made it into IDB are reflected in the UI
- [ ] No data corruption when IDB writes are interrupted mid-transaction
- [ ] Typecheck/lint passes

### US-010: Version Bump & Migration

**Status:** done
**Description:** As a developer, I need to bump the bookmarklet version and ensure clean migration from the old per-batch ZIP system.

**Acceptance Criteria:**
- [ ] Version string bumped from `cvz-bookmarklet-4.5` to `cvz-bookmarklet-5.0` in `defaults.ts`
- [ ] On first load of the new version, the `cvz-export-blobs` database simply starts empty (no migration of old data needed)
- [ ] `S.progress.exported` continues to work as-is (existing map of `{convId: update_time}`)
- [ ] Old `ZipLite` class can be removed if no longer used anywhere, or kept if still needed for other purposes
- [ ] Typecheck/lint passes

## Functional Requirements

- FR-1: Create a new IDB database `cvz-export-blobs` with two object stores: `conv` (string key → JSON string) and `files` (string key → Blob)
- FR-2: Provide a helper module with cursor-based iteration methods for memory-safe access to stored data
- FR-3: Modify `exportOneBatch()` to write conversations and assets to IDB instead of building a per-batch ZIP
- FR-4: Modify `exportKnowledgeBatch()` to write KF files to IDB under `kf/<projectName>/` paths
- FR-5: Implement a `StreamingZip` class that writes ZIP entries to a `WritableStream` using STORE method (no compression)
- FR-6: Implement `generateFinalZip()` using `showSaveFilePicker()` to stream the ZIP directly to disk
- FR-7: Build `conversations-NNN.json` split files (100 conversations per file, 1-indexed, 3-digit zero-padded) during ZIP generation by iterating the `conv` store
- FR-8: Show a "Download (X MB)" button when IDB has accumulated data; auto-trigger on export completion
- FR-9: Display "Accumulated: X MB" in the stats section, updated after each batch
- FR-10: Reset action clears both the state IDB and the export blobs IDB
- FR-11: Accumulated data persists across page reloads; UI reflects stored data on load
- FR-12: Bump version to `cvz-bookmarklet-5.0`

## Non-Goals

- **No DEFLATE compression** — STORE is sufficient (JSON has low compression ratio; images are already compressed)
- **No in-memory Blob fallback** — this version requires FSAA (Chromium-only). A Blob fallback for Firefox/Safari may be added in a follow-up PRD
- **No background service worker** — bookmarklet runs in page context
- **No cloud upload** — local file only
- **No incremental ZIP updates** (appending to existing ZIP) — always regenerate from IDB
- **No backward compatibility with old multi-ZIP workflow** — clean break

## Technical Considerations

- **Separate IDB database**: The export blobs database (`cvz-export-blobs`) must be separate from the existing state database (`cvz-export`) to keep state operations fast and allow independent clearing
- **Cursor-based iteration**: All IDB reads during ZIP generation must use cursors, not `getAll()`, to avoid loading hundreds of megabytes into memory
- **FSAA browser support**: `showSaveFilePicker()` is available in Chromium-based browsers (Chrome, Edge, Opera) but NOT in Firefox or Safari. The UI should clearly communicate this requirement
- **CRC-32 computation**: The `StreamingZip` needs CRC-32 for each entry. For large blobs read in chunks, CRC must be computed incrementally
- **Transaction lifetime**: IDB transactions auto-close after the event loop tick. The helper module must open fresh transactions for each operation — don't try to keep a transaction alive across async boundaries
- **Zip path as IDB key**: Asset files use their zip-relative path as the IDB key (`file-abc123.png`, `kf/MyProject/doc.pdf`). This means the IDB key IS the final ZIP entry path — no mapping needed at ZIP generation time
- **convoviz compatibility**: The generated ZIP must match the structure expected by `convoviz/io/loaders.py` — specifically `_find_conversation_files()` matches `conversations-NNN.json` via `_SPLIT_FILE_RE`, and asset files are siblings at the root level for `assets.py` resolution
- **Existing `ZipLite`**: May be removable after this change since both conversation and KF exports will use IDB accumulation. Evaluate during implementation

## Success Metrics

- Users export any number of conversations and receive exactly one ZIP file
- A 500-conversation export with assets uses minimal RAM during ZIP generation (only central directory entries in memory, ~100 bytes per entry)
- The generated ZIP loads successfully in convoviz without any manual post-processing
- Export data survives page reloads — users can close the tab and download later

## Open Questions

- **FSAA-only vs. fallback**: This PRD scopes to FSAA-only (Chromium). If a user cancels the save picker or uses Firefox, they cannot download. Should a follow-up PRD for Blob fallback be prioritized immediately, or is Chromium-only acceptable for the initial release?
- **IDB quota handling**: If the browser hits IDB storage quota mid-export, the brainstorm suggests pausing and allowing partial download. Should the "Download" button remain functional even if the export errored out due to quota?
- **`convoviz_export_meta.json`**: The current export includes a metadata JSON in each batch ZIP. Should this be included in the final single ZIP as well? If so, what should it contain (aggregated stats across all batches)?
