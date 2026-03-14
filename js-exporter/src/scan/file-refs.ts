import type { FileRef } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const extractFileRefs = (chatJson: any): FileRef[] => {
  const out: FileRef[] = [];
  const seen = new Set<string>();
  const mapping = chatJson && chatJson.mapping ? chatJson.mapping : {};
  for (const k in mapping) {
    const node = mapping[k];
    const msg = node && node.message;
    if (!msg) continue;
    const atts = msg.metadata && msg.metadata.attachments;
    if (Array.isArray(atts)) {
      for (const a of atts) {
        if (a && a.id && !seen.has(a.id)) {
          seen.add(a.id);
          out.push({
            id: a.id,
            name: a.name || null,
          });
        }
      }
    }
    const parts = msg.content && msg.content.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (
          p &&
          p.content_type === "image_asset_pointer" &&
          p.asset_pointer
        ) {
          const id = String(p.asset_pointer).replace("sediment://", "");
          if (id && !seen.has(id)) {
            seen.add(id);
            out.push({
              id: id,
              name: null,
            });
          }
        }
      }
    }
  }
  return out;
};
