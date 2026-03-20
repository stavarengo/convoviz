# JS Exporter

How to build the JS Exporter bookmarklet from source:

```bash
cd js-exporter
npm install
npm run build
```

## Build Outputs

The build produces four files in `dist/`:

| File | Description |
|------|-------------|
| **`script.js`** | Readable IIFE for debugging (worker code embedded) |
| **`script.min.js`** | Minified production IIFE (worker code embedded) |
| **`bookmarklet.js`** | Same as `script.min.js` prefixed with `javascript:` — paste as a browser bookmark |
| **`worker.js`** | Standalone Web Worker bundle (build intermediate — embedded into the main scripts automatically) |

## Architecture

The exporter uses a **main thread + Web Worker** split:

- **Main thread** (`script.js` / `bookmarklet.js`): UI panel, DOM rendering, file downloads. Spawns the worker automatically at startup via Blob URL.
- **Web Worker** (`worker.js`): All export processing — network fetching, queue management, IndexedDB state persistence, and structured logging.

Communication between the two threads uses typed `postMessage` (see `src/worker/protocol.ts`).

Users only need `script.min.js` or `bookmarklet.js` — the worker code is embedded inside and loaded automatically at runtime. The standalone `worker.js` file in `dist/` is a build artifact; it is not loaded separately.

Re-running the bookmarklet pings the existing worker. If the version matches, it reuses it; otherwise it terminates the old worker and spawns a new one.

## Other Commands

- `npm run build:dev` — readable (non-minified) build for debugging
- `npm test` — run the Vitest suite
- `npm run typecheck` — TypeScript type checking

## After the export is ready:

```bash
convoviz --zip ./tmp/export/convoviz_export_20260314_153045_n10.zip --output ./tmp/output
```
