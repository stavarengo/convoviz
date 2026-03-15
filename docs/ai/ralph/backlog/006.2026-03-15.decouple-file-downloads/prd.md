# PRD: Decouple File Downloads from Chat Export

**Project:** Convoviz JS Exporter
**Branch:**

## Introduction

The JS exporter currently downloads all file attachments inline during conversation export. In `exporter.ts`, each conversation worker downloads ALL file attachments before marking the conversation as done. With ~4,000 chats containing multiple file attachments (some large), a single large file blocks one of the 3 available worker slots, preventing new conversations from being fetched.

This feature replaces the batch-based export model with three independent, concurrent queues (Chat, Attachment, Knowledge File). Each queue has its own configurable concurrency. File downloads are decoupled into a separate queue that runs concurrently with conversation fetching, so a large file never blocks conversation export progress.

## Goals

- File downloads never block conversation export progress
- Three concurrent, independent queues: conversations, attachments, knowledge files
- Generic queue abstraction reusable for future queue types
- Per-queue progress visibility in the UI
- "Download what's ready" at any moment without stopping queues
- Minimal changes to existing IDB blob storage model
- Clean removal of batch-based export code

## User Stories

### US-001: Generic Queue Abstraction

**Status:** pending
**Description:** As a developer, I need a reusable generic queue abstraction so that all three export queues share consistent behavior for concurrency, retry, dead-letter, and lifecycle management.

**Acceptance Criteria:**
- [ ] Create `Queue<T extends QueueItem>` class in `js-exporter/src/export/queue.ts`
- [ ] Implement the `QueueItem`, `QueueConfig`, `QueueCallbacks`, `QueueStats`, and `Queue` interfaces (see Technical Considerations for full definitions)
- [ ] Workers are long-lived async loops that pull one item at a time from pending
- [ ] Workers park using a Promise-based wake mechanism when pending is empty — no polling
- [ ] `enqueue(items)` adds items to pending and wakes any parked workers immediately
- [ ] `start(signal)` returns a Promise that resolves when `stop()` is called or the queue drains (pending=0, active=0)
- [ ] `onDrained` callback fires when the queue empties
- [ ] Retry/dead-letter per item: fail count < `maxRetries` → requeue to pending; fail count >= `maxRetries` → move to dead list and fire `onItemDead`
- [ ] `setConcurrency(n)` while running: increase spawns new worker loops, decrease lets excess workers finish their current item then exit
- [ ] AbortError from the worker function exits the worker loop without counting as a failure
- [ ] Configurable `pauseMs` delay between items per worker
- [ ] `stats` property returns `{ pending, active, done, dead }` counts, updated in real-time
- [ ] `onStatsChanged` callback fires on every stats change
- [ ] `isRunning` property reflects whether the queue is active
- [ ] Unit tests covering: basic enqueue→process→done flow, concurrency limit respected, retry requeue, dead-letter after maxRetries, enqueue while running (parked workers wake), stop while running (workers finish current item), setConcurrency increase/decrease while running, pauseMs delay, AbortSignal cancellation, empty queue start (workers park then wake on first enqueue)
- [ ] Typecheck passes

### US-002: Chat Queue Worker

**Status:** pending
**Description:** As the exporter, I need a chat queue worker function that fetches conversation JSON, extracts file references, pushes them to the attachment queue, and stores the conversation to IDB — without downloading any files inline.

**Acceptance Criteria:**
- [ ] Create worker function in `js-exporter/src/export/chat-worker.ts`
- [ ] Worker accepts a `PendingItem` (existing type: `{ id, title, update_time, gizmo_id }`) and an `AbortSignal`
- [ ] Fetch conversation JSON: `net.fetchJson("/backend-api/conversation/" + item.id)`
- [ ] Extract file refs using the existing `extractFileRefs()` function from `scan/file-refs.ts`
- [ ] Convert extracted file refs into `AttachmentItem[]` and push to the attachment queue via `attachmentQueue.enqueue()`
- [ ] Store conversation JSON: `exportBlobStore.putConv(item.id, json)`
- [ ] Record export in state: `S.progress.exported[item.id] = item.update_time`
- [ ] Worker receives attachment queue reference via dependency injection (closure parameter at construction time)
- [ ] Unit tests with mocked `Net`, `ExportBlobStore`, and attachment queue: success path (JSON fetched + file refs extracted + pushed to attachment queue + stored to IDB), conversation with no file refs (no enqueue call), network error propagation
- [ ] Typecheck passes

### US-003: Attachment Queue Worker

**Status:** pending
**Description:** As the exporter, I need an attachment queue worker that downloads file blobs and stores them to IDB, with dedup to skip already-downloaded files.

**Acceptance Criteria:**
- [ ] Create worker function and `AttachmentItem` type in `js-exporter/src/export/attachment-worker.ts`
- [ ] `AttachmentItem` extends `QueueItem`: `{ id: string, name: string | null, conversationId: string, conversationTitle: string }`
- [ ] Worker performs IDB dedup check first — if the file key already exists in the blob store, skip (return as no-op success)
- [ ] Fetch file metadata: `net.fetchJson("/backend-api/files/download/" + item.id)`
- [ ] If no `download_url` in the metadata response: throw a descriptive error (triggers retry/dead-letter via the queue)
- [ ] Download blob: `net.fetchBlob(meta.download_url, { credentials based on whether URL origin matches })`
- [ ] Compute filename: `{fileId}_{sanitizedName}` or `{fileId}.{ext}` (same naming convention as the current code in `exporter.ts`)
- [ ] Store blob: `exportBlobStore.putFile(filename, blob)`
- [ ] Unit tests: success path (metadata fetched + blob downloaded + stored), dedup skip (file already in IDB), missing download_url error, network error propagation
- [ ] Typecheck passes

### US-004: Knowledge File Queue Worker

**Status:** pending
**Description:** As the exporter, I need a knowledge file queue worker that downloads project knowledge files and stores them to IDB, adapted from the existing `exportKnowledgeBatch` logic.

**Acceptance Criteria:**
- [ ] Create worker function and `KnowledgeFileItem` type in `js-exporter/src/export/knowledge-worker.ts`
- [ ] `KnowledgeFileItem` extends `QueueItem`: `{ id: string, projectId: string, projectName: string, fileId: string, fileName: string, fileType: string, fileSize: number }` (note: `id` uses `fileId` as the queue item identifier)
- [ ] Fetch metadata: `net.fetchJson("/backend-api/files/download/{fileId}?gizmo_id={projectId}&inline=false")`
- [ ] If `file_not_found` in response → throw a special error that the queue should treat as immediate dead-letter (set fail count to `maxRetries` to bypass retries)
- [ ] Download blob from `download_url`
- [ ] Store to IDB at path: `kf/{sanitizedProjectName}/{sanitizedFileName}`
- [ ] Store `project.json` per project (idempotent write — same data each time the project is encountered)
- [ ] Unit tests: success path (metadata + blob + stored), `file_not_found` immediate dead-letter, network error retry, project.json idempotent write
- [ ] Typecheck passes

### US-005: State Model Update & v2 → v3 Migration

**Status:** pending
**Description:** As a developer, I need the `ExportState` type system updated for the queue-based model and a migration function to transform persisted v2 state into v3.

**Acceptance Criteria:**
- [ ] Update `Progress` type in `types.ts` — add new attachment fields:
  - `filePending: AttachmentItem[]`
  - `fileDead: Array<AttachmentItem & { lastError: string }>`
  - `fileFailCounts: Record<string, number>`
  - `fileDoneCount: number`
- [ ] Rename KF fields in `Progress` type:
  - `kfExported` → `knowledgeFilesExported`
  - `kfPending` → `knowledgeFilesPending`
  - `kfDead` → `knowledgeFilesDead`
  - `kfFailCounts` → `knowledgeFilesFailCounts`
- [ ] Update `Settings` type: remove `batch` and `conc`, add `chatConcurrency: number` (default 3), `fileConcurrency: number` (default 3), `knowledgeFileConcurrency: number` (default 3)
- [ ] Update `Stats` type: remove `batches`, `batchMs`, `chats`, `kfBatches`, `kfMs`, `kfFiles`; add `chatsExported`, `chatsMs`, `filesDownloaded`, `filesMs`, `knowledgeFilesDownloaded`, `knowledgeFilesMs`
- [ ] Remove `lastPhase` from `RunState` (no longer needed — all queues run concurrently, there's no phase sequence)
- [ ] Update `defaults.ts` with v3 default state matching all new types
- [ ] Implement migration function in `state/store.ts`: when loading state with `v === 2`, apply these transformations:
  1. Add new `Progress` fields with empty defaults (`filePending: []`, `fileDead: []`, `fileFailCounts: {}`, `fileDoneCount: 0`)
  2. Rename KF fields: `kfExported` → `knowledgeFilesExported`, `kfPending` → `knowledgeFilesPending`, etc.
  3. Map settings: `chatConcurrency = conc || 3`, `fileConcurrency = 3`, `knowledgeFileConcurrency = 3`, delete `batch` and `conc`
  4. Map stats: `chats` → `chatsExported`, `batchMs` → `chatsMs`, `kfFiles` → `knowledgeFilesDownloaded`, `kfMs` → `knowledgeFilesMs`, add `filesDownloaded = 0`, `filesMs = 0`, delete `batches`, `kfBatches`
  5. Set `v = 3`
- [ ] Update all existing code that references old field names (search for `kfExported`, `kfPending`, `kfDead`, `kfFailCounts`, `S.settings.batch`, `S.settings.conc`, `S.stats.batches`, `S.stats.chats`, etc.) to use new names
- [ ] Unit tests: v2 state input → v3 state output with all field renames verified, new defaults applied, settings mapped, stats mapped
- [ ] Typecheck passes

### US-006: Queue Wiring, Exporter Refactor & Old Code Removal

**Status:** pending
**Description:** As the exporter, I need the three queues wired together in the main exporter module, replacing the batch-based export loop with queue-based concurrent execution, with the old batch code removed entirely.

**Acceptance Criteria:**
- [ ] Create and configure three `Queue` instances in the exporter: `chatQueue`, `attachmentQueue`, `knowledgeFileQueue`
- [ ] Chat queue worker receives attachment queue reference via dependency injection (closure)
- [ ] All three queues share the same `Net` instance (same rate limiting/backoff)
- [ ] **Start behavior**:
  - If no pending items and no scan data → trigger rescan first
  - If backoff carryover → wait
  - Start all three queues concurrently
  - Chat queue initialized from `S.progress.pending`
  - KF queue initialized from `S.progress.knowledgeFilesPending`
  - Attachment queue starts empty — receives items dynamically from chat queue workers
- [ ] **Stop behavior**: single shared `AbortSignal` stops all three queues; workers finish their current item then exit; all queue state persisted to IDB
- [ ] **Completion detection**: coordinator tracks drain state:
  - Chat drained + Attachment drained + Knowledge drained → status "All done", fire `onExportComplete`
  - Chat drained only → status "Chats done. Files still downloading..."
  - Handle attachment queue drain/refill cycle: attachment queue may drain and refill multiple times as chat workers push new items; only the final drain (when chat queue is also drained) signals true attachment completion
- [ ] Queue callbacks (`onItemDone`, `onItemDead`, `onStatsChanged`) update `ExportState` fields and call `saveDebounce()`
- [ ] Rescan requires all queues to be stopped first (same as current behavior)
- [ ] **Delete** `exportOneBatch()` method entirely
- [ ] **Delete** `exportKnowledgeBatch()` method entirely
- [ ] **Delete** all batch-related logic: batch size selection, batch boundary retry evaluation, batch counting in stats
- [ ] **Delete** the sequential export loop in `start()` (`while pending → exportOneBatch; while kfPending → exportKnowledgeBatch`) — replace with concurrent queue starts
- [ ] Update `main.ts` to instantiate queues and pass them to exporter
- [ ] Update `reconcile.ts` if it references old field names or batch logic
- [ ] Integration tests: full start→process→stop cycle, chat→attachment push flow, completion detection with all three queues, stop-while-running, resume after page reload
- [ ] Typecheck passes

### US-007: UI Updates for Queue-Based Export

**Status:** pending
**Description:** As a user, I want to see per-queue progress and control per-queue concurrency so I can monitor and tune the export process.

**Acceptance Criteria:**
- [ ] **Stats area** — replace single progress bar with 3 rows:
  ```
  Chats:      350/4000  [========·····]  Dead: 2
  Files:     1200/2000  [===========··]  Dead: 5
  Knowledge:   45/57    [=============]  Dead: 0
                                  Accumulated: 2.4 GB
  ```
  Each row shows a thin progress bar for that queue's completion percentage
- [ ] **Controls area** — replace "Batch" input with three per-queue concurrency inputs:
  ```
  Workers: Chats [3]  Files [3]  Knowledge [3]
  ```
- [ ] Remove old "Batch" size input entirely
- [ ] **Download button**: always enabled when `accumulatedSize > 0`, even while queues are running; remove `btn.disabled = !!S.run.isRunning` guard; show accumulated size in label: `"Download (2.4 GB)"`
- [ ] **Task list**: add new task type `"file"` for attachment downloads, alongside existing `"conversation"` and `"knowledge"` types
- [ ] Log remains shared across all queues with entries in chronological order (no changes needed)
- [ ] Concurrency inputs call `setConcurrency()` on the respective queue in real-time when the user changes the value
- [ ] UI tests: per-queue stats rendering with correct counts, download button enabled while running, concurrency input wiring
- [ ] Typecheck passes
- [ ] Verify in browser using playwright

## Functional Requirements

- FR-1: Implement a generic `Queue<T>` class with configurable concurrency, retry/dead-letter, pause, abort support, and stats tracking
- FR-2: Chat queue worker fetches conversation JSON, extracts file refs via `extractFileRefs()`, pushes `AttachmentItem`s to attachment queue, stores JSON to IDB — no inline file downloading
- FR-3: Attachment queue worker dedup-checks IDB, fetches file metadata, downloads blob, stores to IDB
- FR-4: Knowledge file queue worker fetches metadata, downloads blob, stores to IDB with `kf/` prefix; dead-letters immediately on `file_not_found`
- FR-5: All three queues run concurrently from start, sharing the same `Net` instance and rate-limiting
- FR-6: Chat queue dynamically pushes `AttachmentItem`s to attachment queue via dependency injection (push model)
- FR-7: Single Stop button stops all three queues via shared `AbortSignal`
- FR-8: Completion detection: all three queues drained → export complete, accounting for attachment queue refill cycles
- FR-9: State schema migrated from v2 → v3 with field renames, new defaults, and batch→concurrency settings conversion
- FR-10: Download button enabled at all times when IDB has data; ZIP generation runs concurrently with active queues
- FR-11: Per-queue concurrency adjustable via UI while queues are running via `setConcurrency()`
- FR-12: Old batch-based `exportOneBatch()` and `exportKnowledgeBatch()` code deleted entirely

## Non-Goals

- Event-driven architecture with domain events
- Unified discovery layer with resumable scanners
- Smart deduplication at scan/discovery level
- Knowledge files unified into the attachment download flow
- Service class abstractions
- Conversation state tracking (new vs. needs-update vs. up-to-date)
- Per-queue pause settings (single shared `pause` value for all queues)
- Individual queue start/stop (all-or-nothing only)
- Download history tracking ("what was included in each download")
- Per-queue log filtering
- Download progress bar during ZIP generation

## Technical Considerations

### Queue Interface

The full interface contract for the generic queue abstraction:

```typescript
interface QueueItem {
  id: string;
}

interface QueueConfig<T extends QueueItem> {
  name: string;
  concurrency: number;
  maxRetries: number;
  pauseMs: number;
  worker: (item: T, signal: AbortSignal) => Promise<void>;
}

interface QueueCallbacks<T extends QueueItem> {
  onItemDone?: (item: T) => void;
  onItemFailed?: (item: T, error: string, attempt: number) => void;
  onItemDead?: (item: T, error: string) => void;
  onDrained?: () => void;
  onStatsChanged?: () => void;
}

interface QueueStats {
  pending: number;
  active: number;
  done: number;
  dead: number;
}

interface Queue<T extends QueueItem> {
  readonly name: string;
  readonly stats: QueueStats;
  readonly isRunning: boolean;
  enqueue(items: T[]): void;
  start(signal: AbortSignal): Promise<void>;
  stop(): void;
  setConcurrency(n: number): void;
}
```

### Worker Wake Mechanism

Workers park using a Promise-based wake when the pending list is empty. `enqueue()` resolves the promise to wake parked workers. No polling.

```typescript
// Conceptual implementation
let _wake: (() => void) | null = null;

enqueue(items: T[]) {
  this.pending.push(...items);
  if (_wake) { _wake(); _wake = null; }
}

async waitForItems(signal: AbortSignal): Promise<void> {
  if (this.pending.length) return;
  return new Promise((resolve, reject) => {
    _wake = resolve;
    signal.addEventListener('abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true }
    );
  });
}
```

### Queue→Queue Push Model

The chat queue worker receives an attachment queue reference at construction time (closure). After extracting file refs from a conversation, it calls `attachmentQueue.enqueue(attachmentItems)`. This is the only inter-queue coupling.

```
┌─────────────┐     enqueue()     ┌──────────────────┐
│  Chat Queue  │ ──────────────→  │  Attachment Queue │
└─────────────┘                   └──────────────────┘
       ↑                                    ↑
  populated by Scan              populated by Chat Queue
```

### Existing Code to Reuse

| Existing Code | Purpose | Changes Needed |
|---------------|---------|----------------|
| `extractFileRefs()` in `scan/file-refs.ts` | Extracts file refs from conversation JSON | None — use as-is |
| `ExportBlobStore` in `state/export-blobs.ts` | IDB blob storage (`conv` + `files` stores) | None — same stores, same API |
| `Net` in `net/net.ts` | HTTP client with 429 backoff | None — shared instance |
| `saveDebounce()` in `state/debounce.ts` | Debounced state persistence | None — same mechanism |
| `generateFinalZip()` in `export/generate-final-zip.ts` | ZIP from IDB cursors | None — already iterates all IDB content |

### New File Locations

| New File | Purpose |
|----------|---------|
| `src/export/queue.ts` | Generic `Queue<T>` abstraction |
| `src/export/chat-worker.ts` | Chat queue worker function |
| `src/export/attachment-worker.ts` | Attachment queue worker + `AttachmentItem` type |
| `src/export/knowledge-worker.ts` | KF queue worker + `KnowledgeFileItem` type |

### Rate Limiting

All queues share the same `Net` instance. HTTP 429 backoff applies globally: when any queue triggers a 429, all requests from all queues back off via the shared exponential backoff in `net.ts`. With 3 queues × 3 workers = 9 potential concurrent requests at peak. The existing backoff mechanism is the protection against over-requesting.

### IDB Blob Stores

Unchanged. Same `conv` and `files` object stores in `cvz-export-blobs` database. Conversation attachments and knowledge files both write to the `files` store with different key prefixes: plain keys for attachments, `kf/` prefix for knowledge files.

### State Version Migration

`v: 2` → `v: 3`. See US-005 for the complete field-by-field migration specification.

## Success Metrics

- Chat export throughput is not degraded by file download delays
- Large files download concurrently without blocking conversation fetching
- Users can download partial results at any point during export
- Per-queue progress bars provide clear visibility into each queue's status
- State migration from v2 to v3 is seamless — no data loss, no manual intervention
- All existing tests continue to pass (adapted for new types/interfaces where needed)

## Open Questions

None — the brainstorm document covers all implementation details comprehensively.
