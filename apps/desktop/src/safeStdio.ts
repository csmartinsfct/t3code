const IGNORED_STDIO_ERROR_CODES = new Set(["EPIPE", "ERR_STREAM_DESTROYED"]);

type StdIoWrite = typeof process.stdout.write;

function notifyWriteCallback(
  encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
  callback?: (error?: Error | null) => void,
): void {
  const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
  if (!done) return;
  queueMicrotask(() => {
    done(null);
  });
}

export function isIgnorableStdIoWriteError(error: unknown): error is NodeJS.ErrnoException {
  if (!(error instanceof Error)) {
    return false;
  }

  const { code } = error as NodeJS.ErrnoException;
  return typeof code === "string" && IGNORED_STDIO_ERROR_CODES.has(code);
}

export function createSafeStdIoWrite(
  originalWrite: StdIoWrite,
  mirror?: (chunk: string | Uint8Array, encoding: BufferEncoding | undefined) => void,
): StdIoWrite {
  let streamBroken = false;

  return (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;

    if (mirror) {
      try {
        mirror(chunk, encoding);
      } catch {
        // Logging should never take down the desktop main process.
      }
    }

    if (streamBroken) {
      notifyWriteCallback(encodingOrCallback, callback);
      return false;
    }

    try {
      if (typeof encodingOrCallback === "function") {
        return originalWrite(chunk, encodingOrCallback);
      }
      if (callback !== undefined) {
        return originalWrite(chunk, encoding, callback);
      }
      if (encoding !== undefined) {
        return originalWrite(chunk, encoding);
      }
      return originalWrite(chunk);
    } catch (error) {
      if (!isIgnorableStdIoWriteError(error)) {
        throw error;
      }

      streamBroken = true;
      notifyWriteCallback(encodingOrCallback, callback);
      return false;
    }
  };
}
