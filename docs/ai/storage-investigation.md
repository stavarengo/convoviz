# Storage Investigation: IndexedDB Size for Large Exports

## Context

The user reports that after exporting **1,337 messages** (with 3,086 remaining), the `cvz-export-blobs` IndexedDB is already **~800 MB**. Extrapolating linearly, the full export could reach **~2.6 GB**.

## Current Storage Architecture

All export data is stored in a single IndexedDB database (`cvz-export-blobs`, version 2):

| Object Store | Key | Value | Purpose |
|---|---|---|---|
| `conv` | conversationId | JSON string | Full conversation JSON from ChatGPT API |
| `files` | path string | Blob | Attachment/file binary data |
| `file-meta` | key (keyPath) | FileMeta object | Metadata for type-based folder placement |

### Why is it so large?

1. **Conversation JSON is verbose**: A single ChatGPT conversation JSON includes all message nodes, metadata, plugin data, and content parts. A conversation with ~50 messages can easily be 100KB–500KB as raw JSON.
2. **Attachment files**: Images, PDFs, code files, and other attachments are stored as Blobs. A few high-res images can add 10–50MB each.
3. **Knowledge base files**: Project knowledge files (PDFs, docs) can be substantial.

### Estimated breakdown for 1,337 messages at 800MB

- **Conversations**: ~1,337 entries × ~200KB avg = ~260MB
- **Attachments + Knowledge**: ~540MB

This is consistent with the reported size.

## Browser Storage Limits

| Browser | IDB Quota | Notes |
|---|---|---|
| Chrome | Up to 80% of total disk space (per origin) | Evictable unless persistent storage is granted |
| Firefox | Up to 50% of free disk space (per origin, 2GB min) | Prompts user when >50MB |
| Safari | ~1GB default; user prompt above threshold | Aggressive eviction after 7 days without visit |

**Key risk**: On Chrome, `chatgpt.com`'s total IDB usage (including ChatGPT's own storage) shares the same quota. Our data competes with ChatGPT's data for the same origin quota.

### Persistent Storage API

`navigator.storage.persist()` can request that the browser not evict the data, but:
- On chatgpt.com, this would persist ALL origin data (not just ours)
- The user likely already has persistent storage from ChatGPT itself
- We can't guarantee it on all browsers

## Options for Improvement

### Option A: Stream-to-disk during export (recommended first step)

Instead of accumulating all data in IDB and then generating a ZIP at the end, stream each conversation/file **directly to disk** via the File System Access API as it's downloaded.

**Pros**: Near-zero IDB footprint for completed items; handles arbitrarily large exports.
**Cons**: Requires the user to grant file system access upfront (Chrome-only); more complex coordination.

**Implementation sketch**:
1. At export start, open a directory handle via `showDirectoryPicker()`
2. As each conversation is fetched, write it directly to `conversations/conv-{id}.json`
3. As each file is fetched, write it directly to `files/{path}`
4. Keep only state/progress in IDB (a few KB)
5. At the end, optionally ZIP the directory

### Option B: Chunked ZIP streaming

Instead of storing all data then zipping, use the existing `StreamingZip` to write a ZIP incrementally:
1. Open a file handle at export start
2. As items are downloaded, add them to the streaming ZIP immediately
3. Finalize the ZIP when export completes

**Pros**: Single output file; minimal IDB usage.
**Cons**: Can't resume if interrupted (partial ZIP is invalid); random-access reads harder.

### Option C: OPFS (Origin Private File System)

Use the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) for intermediate storage instead of IDB:

**Pros**: Better performance for large files; no serialization overhead; designed for large data.
**Cons**: API is newer (Chrome 86+, Firefox 111+, Safari 15.2+); still counts toward origin quota; more complex API.

### Option D: Hybrid (keep IDB for state, OPFS for blobs)

- State, progress, logs → IDB (small, structured)
- Conversation JSONs, files → OPFS (large, binary)

This is the cleanest separation of concerns and avoids the IDB performance cliff for large binary data.

## Recommendation

**Phase 1 (quick win)**: Implement Option A (stream-to-disk) as an opt-in mode. Users doing large exports click "Export to folder" which opens a directory picker and streams data directly to disk. IDB is used only for state tracking.

**Phase 2 (longer term)**: Migrate blob storage from IDB to OPFS (Option D). This improves performance and avoids the IDB size issue even without user interaction.

## NOT implementing yet

Per the roadmap, this document is a plan only. No storage migration is being implemented in this cycle. The current IDB approach works for moderate-sized exports, and the existing streaming ZIP download (via `showSaveFilePicker`) already avoids accumulating the final output in memory.
