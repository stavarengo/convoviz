import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEventBus } from "../../src/events/bus";
import type { EventMap } from "../../src/events/types";

describe("EventBus", () => {
  let bus: ReturnType<typeof createEventBus>;

  beforeEach(() => {
    bus = createEventBus();
  });

  describe("on + emit", () => {
    it("delivers payload to a registered listener", () => {
      const listener = vi.fn();
      bus.on("conversation-needs-export", listener);
      bus.emit("conversation-needs-export", { id: "abc" });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ id: "abc" });
    });

    it("delivers to multiple listeners on the same event in registration order", () => {
      const order: string[] = [];
      bus.on("conversation-needs-export", () => order.push("first"));
      bus.on("conversation-needs-export", () => order.push("second"));
      bus.on("conversation-needs-export", () => order.push("third"));

      bus.emit("conversation-needs-export", { id: "x" });

      expect(order).toEqual(["first", "second", "third"]);
    });

    it("does not deliver events to listeners on different event types", () => {
      const exportListener = vi.fn();
      const updateListener = vi.fn();
      bus.on("conversation-needs-export", exportListener);
      bus.on("conversation-needs-update", updateListener);

      bus.emit("conversation-needs-export", { id: "a" });

      expect(exportListener).toHaveBeenCalledOnce();
      expect(updateListener).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribe via returned function", () => {
    it("removes the listener so it no longer receives events", () => {
      const listener = vi.fn();
      const unsub = bus.on("conversation-needs-export", listener);

      bus.emit("conversation-needs-export", { id: "1" });
      expect(listener).toHaveBeenCalledOnce();

      unsub();
      bus.emit("conversation-needs-export", { id: "2" });
      expect(listener).toHaveBeenCalledOnce(); // still 1
    });
  });

  describe("off()", () => {
    it("removes a specific listener by reference", () => {
      const listener = vi.fn();
      bus.on("conversation-needs-export", listener);

      bus.emit("conversation-needs-export", { id: "1" });
      expect(listener).toHaveBeenCalledOnce();

      bus.off("conversation-needs-export", listener);
      bus.emit("conversation-needs-export", { id: "2" });
      expect(listener).toHaveBeenCalledOnce();
    });

    it("does not affect other listeners on the same event", () => {
      const kept = vi.fn();
      const removed = vi.fn();
      bus.on("conversation-needs-export", kept);
      bus.on("conversation-needs-export", removed);

      bus.off("conversation-needs-export", removed);
      bus.emit("conversation-needs-export", { id: "x" });

      expect(kept).toHaveBeenCalledOnce();
      expect(removed).not.toHaveBeenCalled();
    });
  });

  describe("listener error isolation", () => {
    it("continues calling remaining listeners when one throws", () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const first = vi.fn();
      const thrower = vi.fn(() => {
        throw new Error("boom");
      });
      const third = vi.fn();

      bus.on("conversation-needs-export", first);
      bus.on("conversation-needs-export", thrower);
      bus.on("conversation-needs-export", third);

      bus.emit("conversation-needs-export", { id: "a" });

      expect(first).toHaveBeenCalledOnce();
      expect(thrower).toHaveBeenCalledOnce();
      expect(third).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledOnce();

      consoleError.mockRestore();
    });
  });

  describe("clear()", () => {
    it("removes all listeners across all events", () => {
      const exportListener = vi.fn();
      const progressListener = vi.fn();
      bus.on("conversation-needs-export", exportListener);
      bus.on("scanner-progress", progressListener);

      bus.clear();

      bus.emit("conversation-needs-export", { id: "a" });
      bus.emit("scanner-progress", {
        scannerId: "s1",
        offset: 0,
        total: 10,
      });

      expect(exportListener).not.toHaveBeenCalled();
      expect(progressListener).not.toHaveBeenCalled();
    });
  });

  describe("emit with no listeners", () => {
    it("does not throw when emitting an event with no listeners", () => {
      expect(() => {
        bus.emit("conversation-needs-export", { id: "a" });
      }).not.toThrow();
    });
  });

  describe("typed payloads", () => {
    it("carries the correct payload shape for conversation-files-discovered", () => {
      const listener = vi.fn();
      bus.on("conversation-files-discovered", listener);

      const payload: EventMap["conversation-files-discovered"] = {
        conversationId: "conv-1",
        conversationTitle: "Test Chat",
        files: [
          { id: "f1", name: "image.png" },
          { id: "f2", name: null },
        ],
      };
      bus.emit("conversation-files-discovered", payload);

      expect(listener).toHaveBeenCalledWith(payload);
    });

    it("carries the correct payload shape for project-discovered", () => {
      const listener = vi.fn();
      bus.on("project-discovered", listener);

      const payload: EventMap["project-discovered"] = {
        gizmoId: "g1",
        name: "My GPT",
        files: [
          { fileId: "kf1", name: "doc.pdf", type: "pdf", size: 1024 },
        ],
      };
      bus.emit("project-discovered", payload);

      expect(listener).toHaveBeenCalledWith(payload);
    });

    it("carries the correct payload shape for knowledge-file-discovered", () => {
      const listener = vi.fn();
      bus.on("knowledge-file-discovered", listener);

      const payload: EventMap["knowledge-file-discovered"] = {
        fileId: "kf1",
        projectId: "proj1",
        projectName: "My GPT",
        fileName: "data.csv",
        fileType: "csv",
        fileSize: 2048,
      };
      bus.emit("knowledge-file-discovered", payload);

      expect(listener).toHaveBeenCalledWith(payload);
    });

    it("carries the correct payload shape for scanner-complete", () => {
      const listener = vi.fn();
      bus.on("scanner-complete", listener);

      bus.emit("scanner-complete", { scannerId: "s1", itemCount: 42 });

      expect(listener).toHaveBeenCalledWith({
        scannerId: "s1",
        itemCount: 42,
      });
    });
  });
});
