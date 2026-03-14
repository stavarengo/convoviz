import { describe, it, expect } from "vitest";
import { extractFileRefs } from "../../src/scan/file-refs";

describe("extractFileRefs", () => {
  it("returns empty array for null/undefined input", () => {
    expect(extractFileRefs(null)).toEqual([]);
    expect(extractFileRefs(undefined)).toEqual([]);
  });

  it("returns empty array for conversation with no mapping", () => {
    expect(extractFileRefs({})).toEqual([]);
    expect(extractFileRefs({ mapping: {} })).toEqual([]);
  });

  it("returns empty array for nodes with no message", () => {
    const chatJson = {
      mapping: {
        "node-1": { id: "node-1" },
        "node-2": { id: "node-2", message: null },
      },
    };
    expect(extractFileRefs(chatJson)).toEqual([]);
  });

  it("extracts file refs from attachments with id", () => {
    const chatJson = {
      mapping: {
        "node-1": {
          message: {
            metadata: {
              attachments: [
                { id: "file-abc", name: "document.pdf" },
                { id: "file-def", name: "image.png" },
              ],
            },
            content: { parts: [] },
          },
        },
      },
    };
    const refs = extractFileRefs(chatJson);
    expect(refs).toEqual([
      { id: "file-abc", name: "document.pdf" },
      { id: "file-def", name: "image.png" },
    ]);
  });

  it("sets name to null when attachment has no name", () => {
    const chatJson = {
      mapping: {
        "node-1": {
          message: {
            metadata: {
              attachments: [{ id: "file-abc" }],
            },
            content: { parts: [] },
          },
        },
      },
    };
    const refs = extractFileRefs(chatJson);
    expect(refs).toEqual([{ id: "file-abc", name: null }]);
  });

  it("extracts file refs from asset_pointer parts, stripping sediment:// prefix", () => {
    const chatJson = {
      mapping: {
        "node-1": {
          message: {
            metadata: {},
            content: {
              parts: [
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "sediment://file-123",
                },
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "sediment://file-456",
                },
              ],
            },
          },
        },
      },
    };
    const refs = extractFileRefs(chatJson);
    expect(refs).toEqual([
      { id: "file-123", name: null },
      { id: "file-456", name: null },
    ]);
  });

  it("ignores parts that are not image_asset_pointer", () => {
    const chatJson = {
      mapping: {
        "node-1": {
          message: {
            metadata: {},
            content: {
              parts: [
                { content_type: "text", text: "hello" },
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "sediment://file-xyz",
                },
              ],
            },
          },
        },
      },
    };
    const refs = extractFileRefs(chatJson);
    expect(refs).toEqual([{ id: "file-xyz", name: null }]);
  });

  it("deduplicates by file ID across attachments and asset pointers", () => {
    const chatJson = {
      mapping: {
        "node-1": {
          message: {
            metadata: {
              attachments: [{ id: "file-abc", name: "doc.pdf" }],
            },
            content: {
              parts: [
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "sediment://file-abc",
                },
              ],
            },
          },
        },
        "node-2": {
          message: {
            metadata: {
              attachments: [{ id: "file-abc", name: "doc.pdf" }],
            },
            content: { parts: [] },
          },
        },
      },
    };
    const refs = extractFileRefs(chatJson);
    expect(refs).toEqual([{ id: "file-abc", name: "doc.pdf" }]);
  });

  it("deduplicates attachments across multiple nodes", () => {
    const chatJson = {
      mapping: {
        "node-1": {
          message: {
            metadata: {
              attachments: [{ id: "file-1", name: "a.txt" }],
            },
            content: { parts: [] },
          },
        },
        "node-2": {
          message: {
            metadata: {
              attachments: [
                { id: "file-1", name: "a.txt" },
                { id: "file-2", name: "b.txt" },
              ],
            },
            content: { parts: [] },
          },
        },
      },
    };
    const refs = extractFileRefs(chatJson);
    expect(refs).toEqual([
      { id: "file-1", name: "a.txt" },
      { id: "file-2", name: "b.txt" },
    ]);
  });

  it("handles mixed attachments and asset pointers across multiple nodes", () => {
    const chatJson = {
      mapping: {
        "node-1": {
          message: {
            metadata: {
              attachments: [{ id: "att-1", name: "file.pdf" }],
            },
            content: {
              parts: [
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "sediment://img-1",
                },
              ],
            },
          },
        },
        "node-2": {
          message: {
            metadata: {},
            content: {
              parts: [
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "sediment://img-2",
                },
              ],
            },
          },
        },
      },
    };
    const refs = extractFileRefs(chatJson);
    expect(refs).toEqual([
      { id: "att-1", name: "file.pdf" },
      { id: "img-1", name: null },
      { id: "img-2", name: null },
    ]);
  });

  it("skips attachments without id", () => {
    const chatJson = {
      mapping: {
        "node-1": {
          message: {
            metadata: {
              attachments: [
                { name: "no-id.txt" },
                { id: "valid-id", name: "has-id.txt" },
              ],
            },
            content: { parts: [] },
          },
        },
      },
    };
    const refs = extractFileRefs(chatJson);
    expect(refs).toEqual([{ id: "valid-id", name: "has-id.txt" }]);
  });

  it("skips asset_pointer parts without asset_pointer field", () => {
    const chatJson = {
      mapping: {
        "node-1": {
          message: {
            metadata: {},
            content: {
              parts: [
                { content_type: "image_asset_pointer" },
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "sediment://valid",
                },
              ],
            },
          },
        },
      },
    };
    const refs = extractFileRefs(chatJson);
    expect(refs).toEqual([{ id: "valid", name: null }]);
  });
});
