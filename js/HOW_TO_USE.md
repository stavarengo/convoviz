# ChatGPT Direct Export

Export your ChatGPT conversations and assets directly from your browser — no waiting for OpenAI emails. The script packages everything into a single `.zip` file, handles resume/pause, and persists state across page reloads. No external dependencies needed.

## Usage (Console)
1.  **Open ChatGPT**: Log in at [chatgpt.com](https://chatgpt.com).
2.  **Open Console**: Press `F12` (or `Cmd + Opt + I`) and click the **Console** tab.
3.  **Run Script**: Copy/paste the entire content of [`script.js`](script.js) into the console and hit **Enter**.
4.  The export UI appears. If you had a previous export session, your progress is automatically restored.
5.  Click **Start** to begin (or resume) exporting.

---

## Bookmarklet Method
For frequent use, save a bookmark with the name "Convoviz Export" and the URL set to the content of `script.js` (it already starts with `javascript:`). Click the bookmark on any ChatGPT page and the export UI appears — no extra setup needed.

---

## Resume & Batch
Export state persists via IndexedDB across page reloads and browser restarts. When you reopen the script, it picks up where it left off. To change the batch size, stop the export first, adjust the number, then start again.

---

## Importing into Convoviz

### Option A: Merge with Official Export (Recommended)
Keep the `convoviz_export.zip` in your `Downloads` and run `convoviz` on your official ZIP. You'll be prompted to merge the recent data automatically.

### Option B: Direct Input
Point `convoviz` directly to the exported ZIP:
```bash
convoviz --input ~/Downloads/convoviz_export.zip
```

---

## Notes
*   **Rate Limits**: The script handles HTTP 429 responses automatically with exponential backoff and will stop retrying after sustained rate limiting (~12 minutes). You do not need to throttle manually.
*   **Experimental**: Relies on internal ChatGPT APIs; if it breaks, [open an issue](https://github.com/mohamed-chs/convoviz/issues).
