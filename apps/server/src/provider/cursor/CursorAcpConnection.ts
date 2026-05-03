import type { CursorSettings } from "@t3tools/contracts";
import { spawn } from "node:child_process";
import readline from "node:readline";

export type JsonRpcId = string | number;

export interface JsonRpcError {
  readonly code?: number;
  readonly message?: string;
  readonly data?: unknown;
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

export interface CursorAcpIncomingRequest {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface CursorAcpIncomingNotification {
  readonly method: string;
  readonly params?: unknown;
}

export interface CursorAcpConnection {
  readonly childPid: number | undefined;
  initialize: () => Promise<unknown>;
  authenticate: () => Promise<unknown>;
  newSession: (input: { cwd: string; mcpServers?: ReadonlyArray<unknown> }) => Promise<{
    readonly sessionId: string;
    readonly result: unknown;
  }>;
  loadSession: (input: {
    sessionId: string;
    cwd: string;
    mcpServers?: ReadonlyArray<unknown>;
  }) => Promise<unknown>;
  setConfigOption: (input: {
    sessionId: string;
    configId: string;
    value: string;
  }) => Promise<unknown>;
  prompt: (input: { sessionId: string; text: string }) => Promise<unknown>;
  respond: (input: { id: JsonRpcId; result?: unknown; error?: JsonRpcError }) => void;
  cancel: (sessionId: string) => Promise<void>;
  close: () => void;
}

export interface CursorAcpConnectionOptions {
  readonly settings: CursorSettings;
  readonly cwd?: string;
  readonly requestTimeoutMs?: number;
  readonly promptRequestTimeoutMs?: number;
  readonly onNotification?: (notification: CursorAcpIncomingNotification) => void;
  readonly onRequest?: (request: CursorAcpIncomingRequest) => void;
  readonly onStderr?: (line: string) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_PROMPT_REQUEST_TIMEOUT_MS = 30 * 60_000;
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

export function buildCursorAcpCommand(settings: CursorSettings): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
} {
  const launchCommand = settings.launchCommand.filter((part) => part.trim().length > 0);
  if (launchCommand.length > 0) {
    return {
      command: launchCommand[0] ?? settings.binaryPath,
      args: [...launchCommand.slice(1), "acp"],
    };
  }
  return { command: settings.binaryPath, args: ["acp"] };
}

export function buildCursorAcpEnv(
  settings: CursorSettings,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...settings.env,
    ...(settings.homePath ? { HOME: settings.homePath } : {}),
    ...(settings.configDir ? { CURSOR_CONFIG_DIR: settings.configDir } : {}),
    ...(settings.dataDir ? { CURSOR_DATA_DIR: settings.dataDir } : {}),
  };
}

export function createCursorAcpConnection(
  options: CursorAcpConnectionOptions,
): CursorAcpConnection {
  const command = buildCursorAcpCommand(options.settings);
  const child = spawn(command.command, [...command.args], {
    cwd: options.cwd,
    env: buildCursorAcpEnv(options.settings),
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = readline.createInterface({ input: child.stdout });
  const errorOutput = readline.createInterface({ input: child.stderr });
  const pending = new Map<JsonRpcId, PendingRequest>();
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const promptRequestTimeoutMs =
    options.promptRequestTimeoutMs ?? DEFAULT_PROMPT_REQUEST_TIMEOUT_MS;
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
      throw new Error("Cursor ACP connection is closed.");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const respondToAgentRequest = (input: {
    id: JsonRpcId;
    result?: unknown;
    error?: JsonRpcError;
  }) => {
    const message = {
      jsonrpc: "2.0",
      id: input.id,
      ...(input.error ? { error: input.error } : { result: input.result ?? null }),
    };
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const request = (
    method: string,
    params?: unknown,
    timeoutMs = requestTimeoutMs,
  ): Promise<unknown> => {
    const id = nextRequestId++;
    const message: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for Cursor ACP response to ${method}.`));
      }, timeoutMs);
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
          new Error(formatJsonRpcError(parsed.error, `Cursor ACP ${requestState.method} failed`)),
        );
        return;
      }
      requestState.resolve(parsed.result);
      return;
    }

    if (isJsonRpcRequest(parsed)) {
      if (options.onRequest) {
        options.onRequest({
          id: parsed.id,
          method: parsed.method,
          ...(parsed.params !== undefined ? { params: parsed.params } : {}),
        });
        return;
      }
      respondToAgentRequest({
        id: parsed.id,
        error: {
          code: -32601,
          message: `${parsed.method} is not implemented by T3 Code yet.`,
        },
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
        `Cursor ACP process exited${code === null ? "" : ` with code ${code}`}${
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
    authenticate: () => request("authenticate", { methodId: "cursor_login" }),
    newSession: async (input) => {
      const result = await request("session/new", {
        cwd: input.cwd,
        mcpServers: [...(input.mcpServers ?? [])],
      });
      const sessionId = sessionIdFromResult(result);
      if (!sessionId) {
        throw new Error("Cursor ACP did not return a sessionId.");
      }
      return { sessionId, result };
    },
    loadSession: (input) =>
      request("session/load", {
        sessionId: input.sessionId,
        cwd: input.cwd,
        mcpServers: [...(input.mcpServers ?? [])],
      }),
    setConfigOption: (input) =>
      request("session/set_config_option", {
        sessionId: input.sessionId,
        configId: input.configId,
        value: input.value,
      }),
    prompt: (input) =>
      request(
        "session/prompt",
        {
          sessionId: input.sessionId,
          prompt: [{ type: "text", text: input.text }],
        },
        promptRequestTimeoutMs,
      ),
    respond: (input) => {
      respondToAgentRequest(input);
    },
    cancel: async (sessionId) => {
      try {
        writeMessage({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
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
      rejectPending(new Error("Cursor ACP connection closed."));
      if (!child.killed) {
        child.kill();
      }
    },
  };
}
