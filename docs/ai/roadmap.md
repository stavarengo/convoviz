# Roadmap for the JS Exporter

> Below ideas are for after the [[docs/ai/brainstorm/2026-03-15.001.event-driven-exporter-architecture.md]] is implemented.


## ~~Service Worker~~ → Web Worker (DONE)

**Status: Implemented in cvz-bookmarklet-6.0**

All export processing (queues, scanners, network, state persistence) now runs
in a dedicated **Web Worker** thread. The bookmarklet's main thread is purely a
UI control panel.

> **Why Web Worker instead of Service Worker?** Service Workers require the
> script to be served from the same origin via HTTPS. Since we run as a
> bookmarklet on chatgpt.com (a third-party site), we cannot register a Service
> Worker — the browser rejects blob: and data: URLs for SW registration. A
> dedicated Web Worker achieves all the same goals: background processing that
> survives main-thread JS/UI crashes, no UI blocking, and proper versioning for
> graceful upgrades.

### What was delivered

- **Background processing**: Queues, scanners, and network requests run in a
  worker thread. If ChatGPT's React UI crashes, export processing continues.
- **UI as control panel**: The floating panel sends commands (start/stop/rescan)
  to the worker via a typed `postMessage` protocol.
- **Version-aware upgrades**: Re-running the bookmarklet pings the existing
  worker. Same version → reuse. Different version → terminate old, spawn new.
- **Two-pass build**: `build.mjs` bundles the worker separately, then inlines it
  as a string constant in the main bundle (single bookmarklet file).
- **localStorage guard**: `store.ts` now safely degrades when localStorage is
  unavailable (Web Workers don't have it).

### Architecture

```
Main thread (UI)                  Worker thread (processing)
┌─────────────────┐              ┌──────────────────────────┐
│ panel.ts (DOM)  │◄─── state ───│ coordinator.ts           │
│ bridge.ts       │─── cmds ────►│ bootstrap.ts             │
│ downloads       │              │ queues + scanners + net   │
│ (showSavePicker)│              │ state/store (IDB)         │
└─────────────────┘              │ logger (IDB)              │
                                 └──────────────────────────┘
```

### Limitations

- **Page reload kills the worker**: Navigating away or refreshing terminates the
  worker. State is persisted in IDB, so re-running the bookmarklet resumes.
  (A SharedWorker could survive navigations within the origin, but has spotty
  Safari support. Can be explored as a future enhancement.)


## About where to store the files

**Status: Investigation planned** — see [docs/ai/storage-investigation.md](storage-investigation.md)

So as I talked to you now, just to give you some context of how this has been using, as I talk to you now, I have IndexedDB that is 800 megabytes big, and I have only exported 1337 messages. There is still 3086 messages, so I am expecting that the IndexedDB is going to be huge, and I think this is, I don't know how you're saving the files, but based on the size of this IndexedDB, I think you're saving the files there. So just so you know a bit of the context.



## ~~Logs for traceability~~ (DONE)

**Status: Fully implemented in PRD #008 (cvz-bookmarklet-5.0)**

Persistent structured logging is complete:
- **IDB-backed log store** (`cvz-log` database) with auto-incrementing keys
- **Session tracking** (random 8-char hex session ID per bookmarklet run)
- **Structured entries**: `{ id, timestamp, session, level, category, message, context? }`
- **Levels**: debug | info | warn | error
- **Categories**: sys, chat, file, kf, scan, net, ui
- **Retention**: 100k high mark / 80k low mark (oldest deleted first)
- **In-memory buffer** for fast UI display (session-scoped)
- **UI**: "Logs" panel shows session logs; "Download Logs" button exports all
  IDB entries as JSONL
- **API**: `__cvz_clearLogs()` convenience method
- **Context**: Every significant event includes structured context (conversationId,
  fileName, error details, backoff counts, etc.) for full traceability
