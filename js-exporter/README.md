# JS Exporter

How to build the JS Exporter bookmarklet from source:

```bash
cd js-exporter
npm install
npm run build
```

This produces:
- **`dist/script.min.js`** — minified IIFE (same as what `js/script.min.js` was)
- **`dist/bookmarklet.js`** — same thing prefixed with `javascript:`, ready to paste as a browser bookmark

Other useful commands:
- `npm run build:dev` — readable (non-minified) build for debugging
- `npm test` — run the Vitest suite
- `npm run typecheck` — TypeScript type checking


## After the export is ready:

```bash
convoviz --zip ./tmp/export/convoviz_export_20260314_153045_n10.zip --output ./tmp/output
```
