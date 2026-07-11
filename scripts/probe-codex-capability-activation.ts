import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

type JsonRpcResponse = {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: {
    readonly message?: unknown;
  };
};

type CodexPluginListResponse = {
  readonly marketplaces?: ReadonlyArray<{
    readonly name?: string;
    readonly plugins?: ReadonlyArray<{
      readonly id?: string;
      readonly name?: string;
      readonly installed?: boolean;
      readonly enabled?: boolean;
    }>;
  }>;
};

type CodexSkillsListResponse = {
  readonly data?: ReadonlyArray<{
    readonly cwd?: string;
    readonly skills?: ReadonlyArray<{
      readonly name?: string;
      readonly path?: string;
      readonly enabled?: boolean;
      readonly scope?: string;
      readonly description?: string;
    }>;
  }>;
};

type PendingRequest = {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
};

function buildCodexInitializeParams() {
  return {
    clientInfo: {
      name: "t3code_desktop",
      title: "T3 Code Desktop",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  } as const;
}

function killCodexChildProcess(child: ChildProcessWithoutNullStreams): void {
  child.kill("SIGTERM");
}

function readArgValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function requestJsonRpc(input: {
  readonly child: ChildProcessWithoutNullStreams;
  readonly pending: Map<number, PendingRequest>;
  readonly method: string;
  readonly params: unknown;
  readonly nextId: () => number;
  readonly observations: unknown[];
}): Promise<unknown> {
  const id = input.nextId();
  input.observations.push({
    direction: "request",
    id,
    method: input.method,
    params: input.params,
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      input.pending.delete(id);
      reject(new Error(`Timed out waiting for ${input.method}.`));
    }, 10_000);
    input.pending.set(id, {
      method: input.method,
      resolve,
      reject,
      timeout,
    });
    input.child.stdin.write(
      `${JSON.stringify({ id, method: input.method, params: input.params })}\n`,
    );
  });
}

function installedPluginSummaries(response: CodexPluginListResponse) {
  return (response.marketplaces ?? []).flatMap((marketplace) =>
    (marketplace.plugins ?? [])
      .filter((plugin) => plugin.installed === true && plugin.enabled === true)
      .map((plugin) => ({
        marketplace: marketplace.name ?? "unknown",
        id: plugin.id ?? null,
        name: plugin.name ?? null,
      })),
  );
}

function enabledSkillSummaries(response: CodexSkillsListResponse) {
  return (response.data ?? []).flatMap((block) =>
    (block.skills ?? [])
      .filter((skill) => skill.enabled === true)
      .map((skill) => ({
        cwd: block.cwd ?? null,
        name: skill.name ?? null,
        path: skill.path ?? null,
        scope: skill.scope ?? null,
        description: skill.description ?? null,
      })),
  );
}

async function main() {
  const binaryPath = readArgValue("--binary") ?? process.env.CODEX_BINARY ?? "codex";
  const homePath = readArgValue("--home") ?? process.env.CODEX_HOME;
  const sendTurn =
    process.argv.includes("--send-turn") || process.env.CODEX_CAPABILITY_PROBE_SEND_TURN === "1";
  const observations: unknown[] = [];
  const stderrLines: string[] = [];

  if (sendTurn) {
    throw new Error(
      "Safe discovery mode does not send a model turn. Remove --send-turn or extend this probe with an explicit disposable thread guard before consuming model usage.",
    );
  }

  const child = spawn(binaryPath, ["app-server"], {
    env: {
      ...process.env,
      ...(homePath ? { CODEX_HOME: homePath } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const output = readline.createInterface({ input: child.stdout });
  const stderr = readline.createInterface({ input: child.stderr });
  const pending = new Map<number, PendingRequest>();
  let requestId = 1;
  let completed = false;

  const cleanup = () => {
    output.close();
    stderr.close();
    if (!child.killed) {
      killCodexChildProcess(child);
    }
  };

  const failAll = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  };

  output.on("line", (line) => {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      failAll(new Error(`Received invalid JSON from codex app-server: ${line}`));
      return;
    }
    if (typeof parsed.id !== "number") return;
    const pendingRequest = pending.get(parsed.id);
    if (!pendingRequest) return;
    clearTimeout(pendingRequest.timeout);
    pending.delete(parsed.id);
    if (typeof parsed.error?.message === "string") {
      pendingRequest.reject(new Error(`${pendingRequest.method} failed: ${parsed.error.message}`));
      return;
    }
    observations.push({
      direction: "response",
      id: parsed.id,
      method: pendingRequest.method,
      hasResult: parsed.result !== undefined,
    });
    pendingRequest.resolve(parsed.result);
  });

  stderr.on("line", (line) => {
    stderrLines.push(line);
    if (stderrLines.length > 20) stderrLines.shift();
  });

  child.once("error", (error) => failAll(error));
  child.once("exit", (code, signal) => {
    if (!completed) {
      failAll(
        new Error(
          `codex app-server exited before probe completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
    }
  });

  const request = (method: string, params: unknown) =>
    requestJsonRpc({
      child,
      pending,
      method,
      params,
      nextId: () => requestId++,
      observations,
    });

  try {
    await request("initialize", buildCodexInitializeParams());
    observations.push({ direction: "notification", method: "initialized" });
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    const [pluginsRaw, skillsRaw] = await Promise.all([
      request("plugin/list", {}),
      request("skills/list", {}),
    ]);
    completed = true;

    const plugins = installedPluginSummaries(pluginsRaw as CodexPluginListResponse);
    const skills = enabledSkillSummaries(skillsRaw as CodexSkillsListResponse);
    const skillCandidate = skills.find((skill) => skill.name && skill.path);
    const candidateTurnStart =
      skillCandidate?.name && skillCandidate.path
        ? {
            method: "turn/start",
            params: {
              threadId: "<provider-thread-id>",
              input: [
                {
                  type: "text",
                  text: `$${skillCandidate.name}\n\n<user text>`,
                  text_elements: [],
                },
                {
                  type: "skill",
                  name: skillCandidate.name,
                  path: skillCandidate.path,
                },
              ],
            },
          }
        : null;

    console.log(
      JSON.stringify(
        {
          mode: "safe-discovery",
          binaryPath,
          homePath: homePath ?? null,
          observations,
          installedPlugins: plugins,
          enabledSkills: skills,
          candidateTurnStart,
          limitation:
            "Direct plugin activation is not probed or documented here; use a discovered skill row with name and path for activation.",
          stderrTail: stderrLines,
        },
        null,
        2,
      ),
    );
  } finally {
    cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
