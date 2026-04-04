import { describe, expect, it, vi } from "vitest";

import { createSafeStdIoWrite, isIgnorableStdIoWriteError } from "./safeStdio";

function toText(chunk: string | Uint8Array): string {
  return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
}

describe("isIgnorableStdIoWriteError", () => {
  it("matches broken pipe style stream errors", () => {
    const epipeError = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
    const destroyedError = Object.assign(new Error("stream destroyed"), {
      code: "ERR_STREAM_DESTROYED",
    });

    expect(isIgnorableStdIoWriteError(epipeError)).toBe(true);
    expect(isIgnorableStdIoWriteError(destroyedError)).toBe(true);
    expect(isIgnorableStdIoWriteError(Object.assign(new Error("boom"), { code: "ENOENT" }))).toBe(
      false,
    );
  });
});

describe("createSafeStdIoWrite", () => {
  it("passes through successful writes", () => {
    const originalWrite = vi.fn(() => true) as unknown as typeof process.stdout.write;
    const mirror = vi.fn();
    const patchedWrite = createSafeStdIoWrite(originalWrite, mirror);

    expect(patchedWrite("hello\n", "utf8")).toBe(true);
    expect(originalWrite).toHaveBeenCalledWith("hello\n", "utf8");
    expect(mirror).toHaveBeenCalledWith("hello\n", "utf8");
  });

  it("swallows broken pipe errors and stops writing to the broken stream", () => {
    let attempts = 0;
    const mirroredWrites: string[] = [];
    const originalWrite = ((_chunk: string | Uint8Array): boolean => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("broken pipe"), { code: "EPIPE" });
      }
      return true;
    }) as typeof process.stdout.write;
    const patchedWrite = createSafeStdIoWrite(originalWrite, (chunk) => {
      mirroredWrites.push(toText(chunk));
    });

    expect(patchedWrite("first\n")).toBe(false);
    expect(patchedWrite("second\n")).toBe(false);
    expect(attempts).toBe(1);
    expect(mirroredWrites).toEqual(["first\n", "second\n"]);
  });
});
