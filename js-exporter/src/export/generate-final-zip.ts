import { StreamingZip } from "../zip/streaming-zip";
import { enc } from "../utils/binary";

/* eslint-disable @typescript-eslint/no-explicit-any */

const BATCH_SIZE = 100;

export interface FinalZipBlobStore {
  iterateConvs(cb: (key: string, value: string) => void): Promise<void>;
  iterateFiles(cb: (key: string, value: Blob) => void): Promise<void>;
}

export interface GenerateFinalZipOpts {
  exportBlobStore: FinalZipBlobStore;
  getWritableStream: () => Promise<WritableStream<Uint8Array>>;
}

export async function generateFinalZip(
  opts: GenerateFinalZipOpts,
): Promise<void> {
  const { exportBlobStore, getWritableStream } = opts;

  const writable = await getWritableStream();
  const zip = new StreamingZip(writable);

  // Collect conversations via cursor
  const convBatch: string[] = [];
  let batchIndex = 1;

  await exportBlobStore.iterateConvs((_key, value) => {
    convBatch.push(value);
  });

  // Write conversation batches (100 per file)
  for (let i = 0; i < convBatch.length; i += BATCH_SIZE) {
    const slice = convBatch.slice(i, i + BATCH_SIZE);
    const parsed = slice.map((s) => JSON.parse(s));
    const jsonStr = JSON.stringify(parsed);
    const padded = String(batchIndex).padStart(3, "0");
    await zip.addEntry(`conversations-${padded}.json`, enc(jsonStr));
    batchIndex++;
  }

  // Write files from the files store (IDB key = zip path)
  const fileEntries: Array<{ key: string; value: Blob }> = [];
  await exportBlobStore.iterateFiles((key, value) => {
    fileEntries.push({ key, value });
  });

  for (const entry of fileEntries) {
    await zip.addEntry(entry.key, entry.value);
  }

  await zip.finalize();
}

export interface DownloadFinalZipOpts {
  exportBlobStore: FinalZipBlobStore;
  setStatus: (msg: string) => void;
}

/**
 * Opens a save-file picker via the File System Access API and streams the
 * final ZIP directly to disk. Falls back to an error message when the API
 * is unavailable or the user cancels the picker.
 */
export async function downloadFinalZip(
  opts: DownloadFinalZipOpts,
): Promise<void> {
  const { exportBlobStore, setStatus } = opts;
  const w = globalThis as any;

  if (typeof w.showSaveFilePicker !== "function") {
    setStatus(
      "Download requires a Chromium-based browser (Chrome, Edge, Opera). " +
        "Firefox and Safari do not support the File System Access API.",
    );
    return;
  }

  let fileHandle: any;
  try {
    fileHandle = await w.showSaveFilePicker({
      suggestedName: "chatgpt-export.zip",
      types: [
        {
          description: "ZIP Archive",
          accept: { "application/zip": [".zip"] },
        },
      ],
    });
  } catch (e: any) {
    if (e && e.name === "AbortError") {
      setStatus("Download cancelled.");
      return;
    }
    setStatus("Failed to open save dialog: " + ((e && e.message) || e));
    return;
  }

  try {
    const writable = await fileHandle.createWritable();
    await generateFinalZip({
      exportBlobStore,
      getWritableStream: async () => writable,
    });
    setStatus("Download complete.");
  } catch (e: any) {
    setStatus("ZIP generation failed: " + ((e && e.message) || e));
  }
}
