// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

describe("registerGlobalErrorHandlers", () => {
  let logMock: Mock;

  beforeEach(() => {
    vi.resetModules();
    logMock = vi.fn();
  });

  it("registers window error handler that calls log with correct level/category", async () => {
    const { registerGlobalErrorHandlers } = await import(
      "../../src/state/global-error-handlers"
    );
    registerGlobalErrorHandlers(logMock);

    const errorEvent = new ErrorEvent("error", {
      message: "Test error",
      filename: "test.js",
      lineno: 42,
      colno: 7,
    });
    window.dispatchEvent(errorEvent);

    expect(logMock).toHaveBeenCalledWith(
      "error",
      "sys",
      "Uncaught error: Test error",
      expect.objectContaining({
        filename: "test.js",
        lineno: 42,
        colno: 7,
      }),
    );
  });

  it("registers unhandledrejection handler that calls log with correct level/category", async () => {
    const { registerGlobalErrorHandlers } = await import(
      "../../src/state/global-error-handlers"
    );
    registerGlobalErrorHandlers(logMock);

    const event = new Event("unhandledrejection") as any;
    event.reason = new Error("promise failed");
    window.dispatchEvent(event);

    expect(logMock).toHaveBeenCalledWith(
      "error",
      "sys",
      "Unhandled promise rejection",
      { reason: "Error: promise failed" },
    );
  });

  it("handles unhandledrejection with string reason", async () => {
    const { registerGlobalErrorHandlers } = await import(
      "../../src/state/global-error-handlers"
    );
    registerGlobalErrorHandlers(logMock);

    const event = new Event("unhandledrejection") as any;
    event.reason = "string rejection";
    window.dispatchEvent(event);

    expect(logMock).toHaveBeenCalledWith(
      "error",
      "sys",
      "Unhandled promise rejection",
      { reason: "string rejection" },
    );
  });

  it("handles unhandledrejection with undefined reason", async () => {
    const { registerGlobalErrorHandlers } = await import(
      "../../src/state/global-error-handlers"
    );
    registerGlobalErrorHandlers(logMock);

    const event = new Event("unhandledrejection") as any;
    event.reason = undefined;
    window.dispatchEvent(event);

    expect(logMock).toHaveBeenCalledWith(
      "error",
      "sys",
      "Unhandled promise rejection",
      { reason: "undefined" },
    );
  });
});
