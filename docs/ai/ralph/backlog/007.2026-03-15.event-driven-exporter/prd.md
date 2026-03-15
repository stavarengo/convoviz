# PRD: Event-Driven Exporter Architecture

**Project:** Convoviz JS Exporter
**Branch:**

## Introduction

The JS exporter currently performs scanning and queue orchestration in a monolithic `exporter.ts` module. Scanning logic (conversation and project scanning, dedup, incremental merge) lives inline in the `rescan()` method (~200 lines). Queue creation and wiring happens inline in `start()` (~300 lines). Workers directly reference other queues to push items (chat worker calls `attachmentQueue.enqueue()` via closure injection).

This feature rewrites the exporter as a fully event-driven, decoupled system. Scanners, workers, and queues become independent components connected via an in-memory event bus. Discovery results are persisted to IDB before events are emitted, making the system crash-resilient and resumable. Smart deduplication happens at both the scanner level (emit targeted events based on DB checks) and the worker level (validate before processing). No component knows about queues directly — all wiring happens at bootstrap time.

**Prerequisite:** Plan 1 ("Decouple File Downloads") is complete. The generic `Queue<T>` abstraction, worker functions, and IDB blob storage from Plan 1 are reused as-is.

## Goals

- Fully event-driven architecture: scanners, workers, and queues communicate via domain events, not direct references
- In-memory pub/sub event bus with typed events and minimal DTO payloads
- Reusable, resumable conversation scanner with persistent pagination state in IDB
- Smart deduplication at scanner level (check DB, emit specific events) AND worker level (validate before processing)
- IDB-backed discovery records: conversations and projects persisted before events are emitted
- Bootstrap-time wiring: event-to-queue registration during app initialization; no component references queues directly
- Separate attachment and knowledge file download queues for parallel throughput
- Unified file storage model with type flag for ZIP folder placement
- Clean removal of monolithic scan/export logic from `exporter.ts`

## User Stories

### US-001: In-Memory Event Bus with Domain Event Types

**Status:** pending
**Description:** As a developer, I need a typed, in-memory pub/sub event bus and a complete set of domain event types so that all components can communicate through events without direct coupling.

**Acceptance Criteria:**
- [ ] Create `EventBus` class in `js-exporter/src/events/bus.ts`
- [ ] `on<K>(event, listener)` — register a listener; returns an unsubscribe function
- [ ] `emit<K>(event, payload)` — synchronously invoke all listeners for that event type
- [ ] `off<K>(event, listener)` — remove a specific listener
- [ ] `clear()` — remove all listeners (used during teardown)
- [ ] Listeners execute synchronously in registration order
- [ ] If a listener throws, log the error via `console.error` and continue calling remaining listeners (never break the chain)
- [ ] Define all domain event types and payload DTOs in `js-exporter/src/events/types.ts`:
  - `conversation-needs-export` — `{ id: string }`
  - `conversation-needs-update` — `{ id: string }`
  - `conversation-up-to-date` — `{ id: string }` (informational only, no queue listens)
  - `conversation-exported` — `{ id: string }`
  - `conversation-files-discovered` — `{ conversationId: string, conversationTitle: string, files: Array<{ id: string, name: string | null }> }`
  - `project-discovered` — `{ gizmoId: string, name: string, files: ProjectFile[] }`
  - `knowledge-file-discovered` — `{ fileId: string, projectId: string, projectName: string, fileName: string, fileType: string, fileSize: number }`
  - `scanner-progress` — `{ scannerId: string, offset: number, total: number }`
  - `scanner-complete` — `{ scannerId: string, itemCount: number }`
- [ ] `EventBus` is fully typed via an `EventMap` interface: `bus.on('conversation-needs-export', (payload: { id: string }) => ...)` — TypeScript enforces payload shape at call sites
- [ ] Unit tests: register + emit + receive, multiple listeners on same event, unsubscribe via returned function, `off()` removal, listener error isolation (one listener throws, others still called), `clear()`, emit with no listeners (no error)
- [ ] Typecheck passes

### US-002: IDB Discovery Store

**Status:** pending
**Description:** As a developer, I need IDB object stores for conversation records, project records, and scanner pagination state so that discovery results persist across page reloads and scanners can resume from where they stopped.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/state/discovery-store.ts`
- [ ] New IDB database `cvz-discovery` (separate from `cvz-export` and `cvz-export-blobs`) with three object stores:
  - `conversations` — key: `id`. Schema: `{ id: string, title: string, updateTime: number, gizmoId: string | null, status: 'new' | 'exported' | 'needs-update', exportedAt: number | null }`
  - `projects` — key: `gizmoId`. Schema: `{ gizmoId: string, name: string, emoji: string, theme: string, instructions: string, files: ProjectFile[], discoveredAt: number }`
  - `scanners` — key: `scannerId`. Schema: `{ scannerId: string, offset: number, limit: number, total: number | null, lastRunAt: number, status: 'active' | 'complete' | 'interrupted' }`
- [ ] Expose async API:
  - `putConversation(record)`, `getConversation(id)`, `getAllConversations()`
  - `putProject(record)`, `getProject(gizmoId)`, `getAllProjects()`
  - `putScannerState(state)`, `getScannerState(id)`, `deleteScannerState(id)`
  - `clear()` — wipe all stores (used during reset)
- [ ] Migration/seeding: on first use, seed the `conversations` store from `ExportState.progress.exported` entries — each key becomes a conversation record with status `'exported'` and `exportedAt` set to the stored timestamp. This is a one-time operation; once seeded, the discovery store is the source of truth for conversation status.
- [ ] Unit tests: CRUD for each store, seeding from existing ExportState, clear
- [ ] Typecheck passes

### US-003: Resumable Conversation Scanner

**Status:** pending
**Description:** As the exporter, I need a resumable conversation scanner that paginates the ChatGPT API, persists its progress to IDB, checks the discovery store for duplicates, and emits domain events — so that scanning survives page reloads and only signals work that actually needs doing.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/scan/scanner.ts` with `createConversationScanner(deps)` factory
- [ ] Deps: `net`, `discoveryStore`, `eventBus`, `scannerId` (unique string per instance), `gizmoId` (null for general scan, string for project-specific scan)
- [ ] Single reusable component — general and project-specific scans use the same code, parameterized by `gizmoId`:
  - General: `GET /backend-api/conversations?offset={offset}&limit={limit}`
  - Project-specific: `GET /backend-api/conversations?offset={offset}&limit={limit}&gizmo_id={gizmoId}`
- [ ] On `start(signal: AbortSignal)`:
  1. Load persisted scanner state from discovery store (resume if available)
  2. Paginate API, processing each page:
     - For each conversation: check discovery store:
       - **Not found** → insert record with status `'new'` → emit `conversation-needs-export`
       - **Found, `updateTime` differs** → update record, set status `'needs-update'` → emit `conversation-needs-update`
       - **Found, `updateTime` matches** → emit `conversation-up-to-date` (informational)
     - Persist scanner pagination state after each page
     - Emit `scanner-progress` after each page
  3. On completion: emit `scanner-complete`, delete scanner state from discovery store
  4. On abort (AbortSignal): scanner state remains in discovery store for next-run resumption
- [ ] Scanner MUST NOT blindly trust saved pagination state — API uses offset/limit (not cursors), so duplicates across pages will occur. The DB check handles this gracefully (no duplicate events for already-processed items).
- [ ] Multiple scanner instances can run concurrently (one general + one per discovered project)
- [ ] Unit tests: full pagination flow (multiple pages), resume from saved state, dedup (existing record emits correct event type), abort preserves state for resumption, project-specific parameterization
- [ ] Typecheck passes

### US-004: Project Scanner and Knowledge File Discovery

**Status:** pending
**Description:** As the exporter, I need a project scanner that discovers projects and emits events, triggering both project-specific conversation scanning and knowledge file discovery for each project found.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/scan/project-scanner.ts` with `createProjectScanner(deps)` factory
- [ ] Deps: `net`, `discoveryStore`, `eventBus`
- [ ] On `start(signal: AbortSignal)`:
  1. Paginate the project/gizmo sidebar API
  2. For each project discovered: persist to discovery store → emit `project-discovered` (payload includes the project's `files` array from the API response)
  3. Emit `scanner-complete` when done
- [ ] Event listeners (registered at bootstrap, not inside the scanner) react to `project-discovered`:
  1. **Conversation scanner listener**: creates and starts a new `ConversationScanner` instance filtered to that project's `gizmoId`
  2. **Knowledge file listener**: for each file in the project's metadata, check blob store for existing download → emit `knowledge-file-discovered` for files that need downloading
- [ ] Knowledge file dedup: before emitting `knowledge-file-discovered`, check if the file is already downloaded (existing blob store check) or already dead-lettered — skip if so
- [ ] Unit tests: project discovery flow, `project-discovered` triggers conversation scanner creation, knowledge file discovery with dedup (already-downloaded files skipped), abort
- [ ] Typecheck passes

### US-005: Bootstrap Wiring and Queue Listener Registration

**Status:** pending
**Description:** As a developer, I need all event-to-queue wiring to happen at bootstrap time so that no component references queues directly — scanners emit events, bootstrap-registered listeners route work into queues.

**Acceptance Criteria:**
- [ ] Create `js-exporter/src/bootstrap.ts` — the single place where all wiring happens
- [ ] `bootstrap(deps)` function creates and returns: `eventBus`, `chatQueue`, `attachmentQueue`, `knowledgeQueue`, `conversationScanner`, `projectScanner`, and a `coordinator` interface
- [ ] Register these event listeners during bootstrap:
  - `conversation-needs-export` → look up conversation record in discovery store → enqueue into chat queue
  - `conversation-needs-update` → same as above (re-fetch the updated conversation)
  - `conversation-exported` → update discovery store record to status `'exported'`
  - `conversation-files-discovered` → convert file refs to `AttachmentItem[]` → enqueue into attachment queue (also add task list entries here)
  - `project-discovered` → spawn a new `ConversationScanner(gizmoId)` and start it; run knowledge file discovery for the project's files
  - `knowledge-file-discovered` → convert to `KnowledgeFileItem` → enqueue into knowledge file queue (also add task list entry)
- [ ] Modify chat worker: instead of calling `attachmentQueue.enqueue()` directly, emit `conversation-exported` event and `conversation-files-discovered` event via the event bus (event bus reference injected via deps)
- [ ] Attachment queue worker: unchanged (already self-contained)
- [ ] Knowledge file queue worker: unchanged (already self-contained)
- [ ] No component (scanner, worker, queue) imports or references any other queue — verified by checking import graph
- [ ] Queue callbacks (`onItemDone`, `onItemDead`, `onStatsChanged`) still update `ExportState` fields and call `saveDebounce()` (same as current behavior, just registered in bootstrap instead of inline)
- [ ] Unit tests: emitting each event results in the correct queue receiving an item; end-to-end chain: scanner emits discovery → event → chat queue → worker emits files-discovered → event → attachment queue
- [ ] Typecheck passes

### US-006: Worker-Level Dedup

**Status:** pending
**Description:** As the exporter, I need workers to validate against the discovery store before processing as a safety net against duplicate work — even when the scanner already emitted the correct event.

**Acceptance Criteria:**
- [ ] Chat worker: before fetching conversation JSON, check discovery store — if record status is `'exported'` and `updateTime` hasn't changed since the record was last exported, skip (return as no-op success, count as "done")
- [ ] Attachment worker: already performs IDB blob store dedup check — verify this works correctly in the event-driven flow (no changes expected)
- [ ] Knowledge file worker: already checks blob store — verify this works correctly (no changes expected)
- [ ] When a worker skips due to dedup, the queue counts it as "done" (not "failed") — the item is processed successfully, just with no work needed
- [ ] Unit tests: chat worker skip on already-exported conversation, verify attachment worker existing dedup still works, verify knowledge worker existing dedup still works
- [ ] Typecheck passes

### US-007: Coordinator Refactor and Old Code Removal

**Status:** pending
**Description:** As the exporter, I need the coordinator rewritten as a thin lifecycle orchestrator that delegates all scanning to standalone scanners and all queue management to bootstrap-created queues, with all monolithic logic removed.

**Acceptance Criteria:**
- [ ] Rewrite `exporter.ts` — the exporter becomes a thin coordinator that:
  - Receives all components from `bootstrap()` (event bus, queues, scanners, discovery store)
  - `rescan()`: starts the general conversation scanner + project scanner via their `start()` methods; waits for both to complete; scanner-spawned project scanners are tracked automatically
  - `start()`: starts all queues, then triggers scanners; tracks completion via queue drain callbacks + scanner-complete events
  - `stop()`: aborts all scanners and stops all queues via shared `AbortSignal`; calls `eventBus.clear()` for clean teardown
- [ ] **Delete** the entire inline scan logic from current `rescan()` — the `onPage` callback, incremental merge, project iteration loop, snapshot management, knowledge file pending computation (all ~200 lines)
- [ ] **Delete** the inline queue creation and wiring from current `start()` — the `createQueue()` calls, callback definitions, `_attachmentQueueProxy`, coordinator promise, drain tracking (all ~300 lines)
- [ ] Completion detection: coordinator listens for `scanner-complete` events (all scanners finished) + queue `onDrained` callbacks (all queues empty) — same logic as current `checkCompletion()` but driven by events
- [ ] Update `main.ts` to call `bootstrap()` and pass the returned components to the coordinator
- [ ] All existing UI behavior preserved: per-queue progress bars, start/stop buttons, download button, task list, log entries
- [ ] `ExportState` continues to be updated via queue callbacks and `saveDebounce()` — the coordinator does not bypass the existing state management
- [ ] Integration tests: full start → scan → discover → export → download cycle; stop-while-running; resume after page reload (scanners resume from IDB state, queues resume from ExportState pending lists); rescan while stopped
- [ ] Typecheck passes

### US-008: Unified File Storage Model

**Status:** pending
**Description:** As a developer, I need file storage entries to carry a type flag so that ZIP generation determines folder placement from stored metadata rather than relying on key prefix conventions.

**Acceptance Criteria:**
- [ ] Add a file metadata object store (or index) in the `cvz-export-blobs` database: for each file stored, record `{ key: string, type: 'attachment' | 'knowledge-file', conversationId?: string, projectName?: string }`
- [ ] Attachment worker: when storing a file blob, also write a metadata entry with `type: 'attachment'` and `conversationId`
- [ ] Knowledge file worker: when storing a file blob, also write a metadata entry with `type: 'knowledge-file'` and `projectName`
- [ ] `generateFinalZip()` reads the metadata entries to determine ZIP folder placement:
  - `type: 'attachment'` → root level in ZIP (current behavior)
  - `type: 'knowledge-file'` → `kf/{projectName}/` folder in ZIP (current behavior)
- [ ] Backward compatibility: if a file key has no metadata entry (data from before this change), fall back to the current key prefix convention (`kf/` prefix → knowledge file, otherwise → attachment)
- [ ] Unit tests: store file with type metadata, generate ZIP with correct folder placement from metadata, backward compat fallback for files without metadata
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Implement an in-memory, typed pub/sub event bus with `on`, `emit`, `off`, `clear`; listener errors are isolated (logged, never break the chain)
- FR-2: Define domain events: `conversation-needs-export`, `conversation-needs-update`, `conversation-up-to-date`, `conversation-exported`, `conversation-files-discovered`, `project-discovered`, `knowledge-file-discovered`, `scanner-progress`, `scanner-complete`
- FR-3: Create IDB discovery store (`cvz-discovery`) with `conversations`, `projects`, and `scanners` object stores
- FR-4: Conversation scanner is a single reusable component parameterized by `gizmoId`; general and project-specific scans use the same code
- FR-5: Scanners persist pagination state to IDB after each page; on restart, resume from saved offset
- FR-6: Scanner-level dedup: check discovery store before emitting events — new records emit `conversation-needs-export`, changed `updateTime` emits `conversation-needs-update`, unchanged emits `conversation-up-to-date`
- FR-7: Worker-level dedup: workers check discovery store or blob store before processing; skip duplicates as no-op success
- FR-8: All discovery results (conversations, projects) persisted to IDB BEFORE events are emitted (crash resilience)
- FR-9: Event-to-queue wiring happens exclusively at bootstrap time in `bootstrap.ts`; no component imports or references queues directly
- FR-10: Chat worker emits `conversation-files-discovered` and `conversation-exported` events instead of calling `attachmentQueue.enqueue()` directly
- FR-11: Attachment and knowledge file download queues remain separate for parallel throughput
- FR-12: File storage entries carry a `type` flag (`'attachment'` | `'knowledge-file'`) for ZIP folder placement
- FR-13: Existing UI behavior (per-queue progress, start/stop, download button, task list) is preserved
- FR-14: Existing `Queue<T>` abstraction from Plan 1 is reused as-is

## Non-Goals

- Dependency injection framework or service locator pattern
- Distributed event bus or cross-tab communication
- Event persistence, replay, or event sourcing
- Queue priority or ordering guarantees between queues
- Individual queue start/stop from the UI (all-or-nothing only)
- Per-queue log filtering or event trace visualization
- Download history tracking
- Changes to the existing queue abstraction (`Queue<T>`)
- Service worker or web worker architecture

## Technical Considerations

### Event Bus Contract

```typescript
interface EventMap {
  'conversation-needs-export': { id: string };
  'conversation-needs-update': { id: string };
  'conversation-up-to-date': { id: string };
  'conversation-exported': { id: string };
  'conversation-files-discovered': {
    conversationId: string;
    conversationTitle: string;
    files: Array<{ id: string; name: string | null }>;
  };
  'project-discovered': {
    gizmoId: string;
    name: string;
    files: ProjectFile[];
  };
  'knowledge-file-discovered': {
    fileId: string;
    projectId: string;
    projectName: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  };
  'scanner-progress': { scannerId: string; offset: number; total: number };
  'scanner-complete': { scannerId: string; itemCount: number };
}

interface EventBus {
  on<K extends keyof EventMap>(
    event: K,
    listener: (payload: EventMap[K]) => void,
  ): () => void;
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
  off<K extends keyof EventMap>(
    event: K,
    listener: (payload: EventMap[K]) => void,
  ): void;
  clear(): void;
}
```

### Scanner Resumption Logic

```
On start(signal):
  state = discoveryStore.getScannerState(scannerId)
  if state exists and status === 'interrupted':
    offset = state.offset           // Resume from saved position
  else:
    offset = 0                      // Fresh start

  while not done and not aborted:
    page = fetchPage(offset, limit, gizmoId)
    for item in page:
      existing = discoveryStore.getConversation(item.id)
      if not existing:
        discoveryStore.putConversation({ ...item, status: 'new' })
        eventBus.emit('conversation-needs-export', { id: item.id })
      elif existing.updateTime !== item.updateTime:
        discoveryStore.putConversation({ ...existing, status: 'needs-update' })
        eventBus.emit('conversation-needs-update', { id: item.id })
      else:
        eventBus.emit('conversation-up-to-date', { id: item.id })

    offset += limit
    discoveryStore.putScannerState({ scannerId, offset, status: 'active' })
    eventBus.emit('scanner-progress', { scannerId, offset, total })

  if completed (not aborted):
    discoveryStore.deleteScannerState(scannerId)
    eventBus.emit('scanner-complete', { scannerId, itemCount })
  // If aborted: scanner state stays in IDB with status 'interrupted'
```

### Bootstrap Wiring Diagram

```
bootstrap(deps)
  ├── Create eventBus
  ├── Create discoveryStore (init IDB)
  ├── Create queues (reuse Queue<T> from Plan 1)
  │   ├── chatQueue
  │   ├── attachmentQueue
  │   └── knowledgeQueue
  ├── Register event listeners:
  │   ├── conversation-needs-export  → lookup discovery store → chatQueue.enqueue()
  │   ├── conversation-needs-update  → lookup discovery store → chatQueue.enqueue()
  │   ├── conversation-exported      → discoveryStore.update(status: 'exported')
  │   ├── conversation-files-discovered → attachmentQueue.enqueue() + taskList entries
  │   ├── project-discovered  → spawn ConversationScanner(gizmoId) + KF discovery
  │   └── knowledge-file-discovered  → knowledgeQueue.enqueue() + taskList entry
  ├── Create scanners
  │   ├── generalScanner = createConversationScanner(gizmoId: null)
  │   └── projectScanner = createProjectScanner()
  └── Return { eventBus, chatQueue, attachmentQueue, knowledgeQueue,
               generalScanner, projectScanner, coordinator }
```

### Migration from Current Architecture

| Current (Plan 1) | Target (Plan 2) |
|---|---|
| Scan logic inline in `exporter.rescan()` | Standalone `ConversationScanner` + `ProjectScanner` |
| Queue creation inline in `exporter.start()` | Queue creation in `bootstrap()` |
| Chat worker calls `attachmentQueue.enqueue()` via closure | Chat worker emits events via event bus |
| `_attachmentQueueProxy` wraps queue for task list | Event listener handles task list entries |
| Monolithic exporter owns scanning + queuing + coordination | Thin coordinator owns lifecycle only |
| No discovery persistence (only `ExportState` snapshot) | IDB discovery store with per-record persistence |
| Dedup via in-memory `ExportState` checks during scan | Dedup via discovery store at scanner + worker levels |
| Scanner progress lost on page reload | Scanner pagination state persisted in IDB |

### Existing Code to Reuse

| Code | Purpose | Changes |
|---|---|---|
| `Queue<T>` in `export/queue.ts` | Generic queue abstraction | None |
| `createAttachmentWorker` | File download worker | None |
| `createKnowledgeWorker` | KF download worker | None |
| `createChatWorker` | Conversation export worker | Emit events instead of direct queue push |
| `ExportBlobStore` | Blob storage | Add metadata store for type flag |
| `Net` in `net/net.ts` | HTTP client with 429 backoff | None |
| `generateFinalZip` | ZIP from IDB cursors | Read type flag from metadata |
| `saveDebounce` | Debounced state persistence | None |

### New File Locations

| File | Purpose |
|---|---|
| `src/events/bus.ts` | Event bus implementation |
| `src/events/types.ts` | Domain event types and payload DTOs |
| `src/state/discovery-store.ts` | IDB discovery store (conversations, projects, scanners) |
| `src/scan/scanner.ts` | Reusable conversation scanner (replaces inline scan logic) |
| `src/scan/project-scanner.ts` | Project scanner (replaces inline project scan logic) |
| `src/bootstrap.ts` | Bootstrap wiring (event-to-queue registration) |

## Success Metrics

- Scanners resume from page reload without re-scanning already-processed pages
- No duplicate work: conversations already exported are not re-fetched (scanner dedup + worker dedup)
- Chat worker never directly references attachment queue (verified by import graph: no import of queue module in chat-worker.ts)
- All event-to-queue wiring lives in `bootstrap.ts` (single source of truth for component dependencies)
- Discovery store contains persistent records of all discovered conversations and projects
- All existing tests pass (adapted for new architecture where needed)
- All existing UI behavior preserved (per-queue progress, start/stop, download, task list, logs)
- `exporter.ts` is reduced to a thin coordinator (~100 lines vs current ~900 lines)

## Open Questions

- Should `scanner-progress` events drive a dedicated "Scanning..." progress bar in the UI, or continue using the existing `ui.setStatus()` approach? The event-driven model enables richer scan progress, but UI changes may be out of scope for this PRD.
