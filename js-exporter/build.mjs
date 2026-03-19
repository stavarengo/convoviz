/**
 * Two-pass build script for the Convoviz JS Exporter.
 *
 * Pass 1: Bundle the Web Worker (worker-entry.ts) as a standalone IIFE.
 * Pass 2: Bundle the main thread (main.ts) with the worker code inlined
 *         as the __WORKER_CODE__ string constant.
 *
 * Usage:
 *   node build.mjs            # production (minified)
 *   node build.mjs --dev      # development (unminified)
 */

import * as esbuild from "esbuild";
import { readFileSync, writeFileSync } from "fs";

const isDev = process.argv.includes("--dev");
const minify = !isDev;

/* ------------------------------------------------------------------ */
/*  Pass 1 — Worker bundle                                             */
/* ------------------------------------------------------------------ */

await esbuild.build({
  entryPoints: ["src/worker/worker-entry.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify,
  outfile: "dist/worker.js",
});

const workerCode = readFileSync("dist/worker.js", "utf-8");

/* ------------------------------------------------------------------ */
/*  Pass 2 — Main bundle (with worker inlined)                         */
/* ------------------------------------------------------------------ */

const outfile = isDev ? "dist/script.js" : "dist/script.min.js";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify,
  outfile,
  define: {
    __WORKER_CODE__: JSON.stringify(workerCode),
  },
});

/* ------------------------------------------------------------------ */
/*  Post-processing                                                    */
/* ------------------------------------------------------------------ */

if (!isDev) {
  const script = readFileSync("dist/script.min.js", "utf-8");
  writeFileSync("dist/bookmarklet.js", "javascript:" + script);
}

const label = isDev ? "dev" : "production";
const mainSize = readFileSync(outfile, "utf-8").length;
const workerSize = workerCode.length;
console.log(
  `[${label}] worker: ${(workerSize / 1024).toFixed(1)}KB, ` +
    `main: ${(mainSize / 1024).toFixed(1)}KB (includes worker inline)`,
);
