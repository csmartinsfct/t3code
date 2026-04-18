import { spawn } from "node:child_process";
import readline from "node:readline";

type JsonRpcId = string | number;

interface JsonRpcError {
  code?: number;
  message?: string;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

interface JsonRpcNotification {
  jsonrpc?: "2.0";
  method: string;
  params?: unknown;
}

interface PendingRequest {
  method: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface GeminiAcpIncomingRequest {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface GeminiAcpIncomingNotification {
  readonly method: string;
  readonly params?: unknown;
}

export interface GeminiAcpConnection {
  readonly childPid: number | undefined;
  initialize: () => Promise<unknown>;
  newSession: (input: { cwd: string; mcpServers?: ReadonlyArray<unknown> }) => Promise<{
    readonly sessionId: string;
    readonly result: unknown;
  }>;
  loadSession: (input: {
    sessionId: string;
    cwd: string;
    mcpServers?: ReadonlyArray<unknown>;
  }) => Promise<unknown>;
  setModel: (input: { sessionId: string; modelId: string }) => Promise<void>;
  setMode: (input: {
    sessionId: string;
    modeId: "default" | "auto_edit" | "yolo" | "plan";
  }) => Promise<void>;
  prompt: (input: { sessionId: string; text: string }) => Promise<unknown>;
  cancel: (sessionId: string) => Promise<void>;
  close: () => void;
}

export interface GeminiAcpConnectionOptions {
  readonly binaryPath: string;
  readonly cwd?: string;
  readonly homePath?: string;
  readonly requestTimeoutMs?: number;
  readonly onNotification?: (notification: GeminiAcpIncomingNotification) => void;
  readonly onRequest?: (request: GeminiAcpIncomingRequest) => void;
  readonly onStderr?: (line: string) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const CLIENT_INFO = {
  name: "t3-code",
  title: "T3 Code",
  version: "0.0.0",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcResponse(message: unknown): message is JsonRpcResponse {
  return isRecord(message) && ("result" in message || "error" in message) && "id" in message;
}

function isJsonRpcRequest(message: unknown): message is JsonRpcRequest {
  return (
    isRecord(message) &&
    typeof message.method === "string" &&
    "id" in message &&
    !("result" in message) &&
    !("error" in message)
  );
}

function isJsonRpcNotification(message: unknown): message is JsonRpcNotification {
  return isRecord(message) && typeof message.method === "string" && !("id" in message);
}

function formatJsonRpcError(error: JsonRpcError | undefined, fallback: string): string {
  return error?.message ? `${fallback}: ${error.message}` : fallback;
}

function isMethodNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return (
    lower.includes("method not found") ||
    lower.includes("unknown method") ||
    lower.includes("unsupported method") ||
    lower.includes("-32601")
  );
}

function sessionIdFromResult(result: unknown): string | null {
  if (typeof result === "string" && result.trim()) {
    return result;
  }
  if (!isRecord(result)) {
    return null;
  }
  const direct = result.sessionId;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }
  const session = result.session;
  if (isRecord(session) && typeof session.sessionId === "string" && session.sessionId.trim()) {
    return session.sessionId;
  }
  if (isRecord(session) && typeof session.id === "string" && session.id.trim()) {
    return session.id;
  }
  return null;
}

export function createGeminiAcpConnection(
  options: GeminiAcpConnectionOptions,
): GeminiAcpConnection {
  const child = spawn(options.binaryPath, ["--acp"], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(options.homePath ? { GEMINI_CLI_HOME: options.homePath } : {}),
    },
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = readline.createInterface({ input: child.stdout });
  const errorOutput = readline.createInterface({ input: child.stderr });
  const pending = new Map<JsonRpcId, PendingRequest>();
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let nextRequestId = 1;
  let closed = false;

  const rejectPending = (error: Error) => {
    for (const [id, request] of pending) {
      clearTimeout(request.timeout);
      request.reject(error);
      pending.delete(id);
    }
  };

  const writeMessage = (message: unknown) => {
    if (closed) {
      throw new Error("Gemini ACP connection is closed.");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const respondToAgentRequest = (id: JsonRpcId, error: JsonRpcError) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`);
  };

  const request = (method: string, params?: unknown): Promise<unknown> => {
    const id = nextRequestId++;
    const message: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for Gemini ACP response to ${method}.`));
      }, requestTimeoutMs);
      pending.set(id, { method, timeout, resolve, reject });
      try {
        writeMessage(message);
      } catch (error) {
        clearTimeout(timeout);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const requestWithFallback = async (
    primaryMethod: string,
    fallbackMethod: string,
    params: unknown,
  ): Promise<unknown> => {
    try {
      return await request(primaryMethod, params);
    } catch (error) {
      if (!isMethodNotFound(error)) {
        throw error;
      }
      return await request(fallbackMethod, params);
    }
  };

  output.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (isJsonRpcResponse(parsed)) {
      const requestState = pending.get(parsed.id);
      if (!requestState) return;
      clearTimeout(requestState.timeout);
      pending.delete(parsed.id);
      if (parsed.error) {
        requestState.reject(
          new Error(formatJsonRpcError(parsed.error, `Gemini ACP ${requestState.method} failed`)),
        );
        return;
      }
      requestState.resolve(parsed.result);
      return;
    }

    if (isJsonRpcRequest(parsed)) {
      options.onRequest?.({
        id: parsed.id,
        method: parsed.method,
        ...(parsed.params !== undefined ? { params: parsed.params } : {}),
      });
      respondToAgentRequest(parsed.id, {
        code: -32601,
        message: `${parsed.method} is not implemented by T3 Code yet.`,
      });
      return;
    }

    if (isJsonRpcNotification(parsed)) {
      options.onNotification?.({
        method: parsed.method,
        ...(parsed.params !== undefined ? { params: parsed.params } : {}),
      });
    }
  });

  errorOutput.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed) {
      options.onStderr?.(trimmed);
    }
  });

  child.once("error", (error) => {
    closed = true;
    rejectPending(error);
  });

  child.once("exit", (code, signal) => {
    closed = true;
    rejectPending(
      new Error(
        `Gemini ACP process exited${code === null ? "" : ` with code ${code}`}${
          signal ? ` (${signal})` : ""
        }.`,
      ),
    );
  });

  return {
    get childPid() {
      return child.pid;
    },
    initialize: () =>
      request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: CLIENT_INFO,
      }),
    newSession: async (input) => {
      const params = {
        cwd: input.cwd,
        mcpServers: [...(input.mcpServers ?? [])],
      };
      const result = await requestWithFallback("session/new", "newSession", params);
      const sessionId = sessionIdFromResult(result);
      if (!sessionId) {
        throw new Error("Gemini ACP did not return a sessionId.");
      }
      return { sessionId, result };
    },
    loadSession: (input) => {
      const params = {
        sessionId: input.sessionId,
        cwd: input.cwd,
        mcpServers: [...(input.mcpServers ?? [])],
      };
      return requestWithFallback("session/load", "loadSession", params);
    },
    setModel: async (input) => {
      const params = {
        sessionId: input.sessionId,
        modelId: input.modelId,
      };
      await requestWithFallback("session/set_model", "unstable_setSessionModel", params);
    },
    setMode: async (input) => {
      const params = {
        sessionId: input.sessionId,
        modeId: input.modeId,
      };
      await requestWithFallback("session/set_mode", "setSessionMode", params);
    },
    prompt: (input) => {
      const params = {
        sessionId: input.sessionId,
        prompt: [{ type: "text", text: input.text }],
      };
      return requestWithFallback("session/prompt", "prompt", params);
    },
    cancel: async (sessionId) => {
      const notification = { jsonrpc: "2.0", method: "session/cancel", params: { sessionId } };
      try {
        writeMessage(notification);
      } catch (error) {
        if (error instanceof Error && error.message.includes("closed")) {
          return;
        }
        throw error;
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      output.close();
      errorOutput.close();
      rejectPending(new Error("Gemini ACP connection closed."));
      if (!child.killed) {
        child.kill();
      }
    },
  };
}
