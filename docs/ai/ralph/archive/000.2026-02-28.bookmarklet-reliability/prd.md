# PRD: Bookmarklet Reliability & Correctness Overhaul

**Project:** Convoviz
**Branch:**

## Introduction

The Convoviz ChatGPT Direct Export bookmarklet (`js/script.gpt.temp.js`) enables users to export their ChatGPT conversations and media directly from the browser. It features resume/pause, batched exports, persistence, dead-letter queues, change detection, and a built-in ZIP implementation (no JSZip dependency needed).

However, the script has several reliability and correctness bugs that need fixing before it can replace the original `js/script.js`. This PRD covers six code fixes, a file replacement, and a documentation update.

**Important context:** This is a standalone JavaScript bookmarklet — a single file that runs in the browser console or as a `javascript:` bookmark. There is no build system, no test framework, and no Node.js runtime. All changes happen within `js/script.gpt.temp.js` (which ultimately replaces `js/script.js`).

## Goals

- Eliminate the localStorage size ceiling that causes silent state loss for users with thousands of conversations
- Fix a scan pagination bug that makes scanning 10x slower when batch size is small
- Prevent infinite retry loops on persistent rate limiting (HTTP 429)
- Eliminate redundant auth token refresh requests from concurrent workers
- Remove duplicated fetch logic that is a maintenance liability
- Clean up dead code
- Replace the original `script.js` with the fixed bookmarklet and update documentation

## User Stories

### US-001: Replace localStorage with IndexedDB storage
**Status:** done
**Description:** As a user with thousands of ChatGPT conversations, I want export state to be stored in IndexedDB so that my resume progress is never silently lost due to localStorage size limits.

**Acceptance Criteria:**
- [ ] A thin IndexedDB wrapper replaces the current `Store` object. It uses a single object store with one key (`"state"`) holding the full state object as a single blob.
- [ ] `Store.load()` is async (`await Store.load()`). The boot sequence (state load → UI inject → render) is wrapped in an async init function.
- [ ] `Store.save()` is async internally but remains fire-and-forget via the existing debounce mechanism. Callers do not need to await it.
- [ ] `Store.reset()` is async and deletes the IndexedDB entry.
- [ ] If IndexedDB is unavailable (e.g., some private browsing modes), the script falls back to localStorage and displays a visible warning in the UI (e.g., appended to the version line: "⚠ localStorage fallback — large exports may lose state").
- [ ] No migration from existing localStorage data — this is intentionally a fresh start. The old localStorage key (`__cvz_export_state_v1__`) is not read or cleaned up.
- [ ] The IndexedDB database name and object store name use the `cvz-` prefix to avoid collisions (e.g., database `"cvz-export"`, store `"state"`).
- [ ] The version string is bumped to `cvz-bookmarklet-2.0` to reflect the storage breaking change.

### US-002: Fix scan pagination and remove dead code
**Status:** done
**Description:** As a user, I want conversation scanning to always use an efficient fixed page size regardless of my batch setting, and I want no dead code in the script.

**Acceptance Criteria:**
- [ ] `scanConversations` uses a hardcoded `pageSize = 50` for API pagination, not `S.settings.batch`. This means scanning 3500 conversations always takes ~70 API calls, regardless of the export batch size setting.
- [ ] `S.settings.batch` only affects `exportOneBatch` (line 801 area) — no other code reads it for pagination.
- [ ] The dead code on line 3 (`const R = window.__CVZ_RESUME__ = window.__CVZ_RESUME__ || {};`) is removed entirely.

### US-003: Unify fetch layer with circuit breaker and token dedup
**Status:** done
**Description:** As a developer maintaining this script, I want a single fetch implementation so that retry logic, backoff, and auth handling cannot drift between `fetchJson` and `fetchBlob`. As a user, I want the script to stop retrying after sustained rate limiting instead of looping forever, and I want concurrent workers to not trigger redundant auth refreshes.

**Acceptance Criteria:**
- [ ] A shared private method `_fetch(url, opts)` in the `Net` object handles all common logic:
  - Auth header injection (when `opts.auth !== false`)
  - 401 token refresh with 1 retry
  - 429 exponential backoff with jitter (existing formula: `min(120000, 10000 * 1.6^count)` with `* (0.85 + random * 0.3)`)
  - 5xx retry (up to 3 attempts with linear backoff)
  - Abort signal checking
- [ ] `_fetch` returns the raw `Response` object on success. `fetchJson` calls `_fetch` then `resp.json()`. `fetchBlob` calls `_fetch` then `resp.blob()`.
- [ ] The default `credentials` value differs by method: `fetchJson` defaults to `"same-origin"`, `fetchBlob` defaults to `"omit"`. This matches the current behavior.
- [ ] **Circuit breaker:** After 10 consecutive 429 responses with no successful request in between, `_fetch` throws an error: `"Rate limit exceeded after 10 retries — try again later"`. The consecutive counter resets to 0 on any successful (2xx) response. At the current backoff formula, 10 retries is approximately 12 minutes of waiting.
- [ ] **Token dedup:** `Net.getToken(signal)` is guarded by a pending promise. If a token refresh is already in flight, subsequent callers await the same promise instead of firing a new `/api/auth/session` request. The guard clears in the `.finally()` block so that future calls after the first completes will make a fresh request.
- [ ] The old `fetchJson` and `fetchBlob` methods (each ~55 lines of duplicated retry logic) are replaced by thin wrappers (~5 lines each) that call `_fetch` and parse the response.

### US-004: Replace script.js and update documentation
**Status:** done
**Description:** As a user, I want the fixed bookmarklet to be the primary script and the documentation to accurately describe the new workflow (no JSZip needed, resume/pause, batch settings).

**Acceptance Criteria:**
- [ ] The contents of the fixed `js/script.gpt.temp.js` are moved to `js/script.js`, replacing the original.
- [ ] `js/script.gpt.temp.js` is deleted.
- [ ] `js/HOW_TO_USE.md` is updated to reflect the new workflow:
  - The "Load JSZip" step is removed (the script has a built-in `ZipLite` class — no external dependency needed).
  - The console usage section describes: open console → paste script → UI appears with resume state from last run.
  - The bookmarklet section describes: click bookmark → UI appears. No JSZip loading needed.
  - A "Resume & Batch" section explains: state persists via IndexedDB across page reloads and browser restarts. Click Start to resume from where you left off. Change batch size by stopping first, adjusting the number, then starting again.
  - The "Importing into Convoviz" section stays the same (Option A and B remain valid).
  - The "Notes" section is updated: rate limit note stays, but mention the script handles 429s automatically with backoff. The experimental/API note stays.

## Functional Requirements

- FR-1: The IndexedDB wrapper must provide `load()`, `save(state)`, and `reset()` methods, all returning Promises.
- FR-2: The debounced save mechanism must work with async `Store.save()` — fire the async write but do not await it in the debounce callback.
- FR-3: `scanConversations` must always paginate with `limit=50` in the API URL, hardcoded.
- FR-4: `Net._fetch()` must be the single source of truth for HTTP retry/backoff/auth logic.
- FR-5: The 429 circuit breaker counter must be a property on the `Net` object (not in persisted state `S.run.backoffCount`), since it tracks per-session consecutive failures.
- FR-6: `Net.getToken()` must deduplicate concurrent calls via a shared promise stored on `Net._tokenPromise`.
- FR-7: The bookmarklet must start with `javascript:` and be wrapped in `(() => { ... })()` to work as a bookmark URL.
- FR-8: The script must be fully self-contained — no external dependencies (no JSZip, no CDN loads).

## Non-Goals

- **Stale export detection**: Re-exporting conversations that were updated since their last export is a feature addition, not part of this reliability fix.
- **UI redesign**: The current UI is functional. Bookmarklet size constraints make elaborate UI impractical.
- **ZIP compression**: `ZipLite` stores files uncompressed (method 0/STORE). Adding deflate would increase code size for minimal benefit since most media files are already compressed.
- **localStorage migration**: No automatic migration from existing localStorage state. Users get a fresh start.
- **Exposing concurrency/pause settings in UI**: `conc` and `pause` exist in state but don't need UI controls for this scope.

## Technical Considerations

- **Single file**: All changes happen in one JavaScript file. There's no module system, no imports, no build step.
- **Bookmarklet constraints**: The script must work when pasted into a browser console or saved as a `javascript:` bookmark URL. Template literals with backticks work in console but may break in bookmark URLs — the current script uses string concatenation for HTML, which should be preserved.
- **IndexedDB async nature**: The biggest structural change is making `Store.load()` async. The current code does `let S = Store.load()` synchronously at the top level. This must become `let S = await Store.load()` inside an async init function. All code that references `S` after loading (UI inject, render, interrupted-run detection, auto-rescan timer) must be inside this async init.
- **No test framework**: This is a browser bookmarklet. Acceptance criteria are verified by code inspection and manual testing on chatgpt.com. There are no automated tests.
- **`S.run.backoffCount` vs circuit breaker counter**: The existing `S.run.backoffCount` is persisted to disk and used for backoff delay calculation. The new circuit breaker counter (max 10 consecutive 429s) should be a separate in-memory counter on `Net`, not persisted — it's a session-level safety valve, not cross-session state.

## Success Metrics

- Users with 3500+ conversations can run the full export without localStorage failures
- Scan of 3500 conversations completes in ~70 API calls (not 700+)
- Script stops retrying after ~12 minutes of sustained rate limiting instead of looping forever
- No redundant `/api/auth/session` calls when multiple workers refresh tokens simultaneously
- Single source of truth for retry/backoff logic — no duplicated fetch code

## Open Questions

None — all design decisions were resolved during brainstorming.
