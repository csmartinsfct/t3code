#!/usr/bin/env node

import readline from "node:readline";

const SESSION_ID = process.env.T3_CURSOR_ACP_HARNESS_SESSION_ID || "t3-cursor-harness-session";
const DEFAULT_SCENARIO = process.env.T3_CURSOR_ACP_HARNESS_SCENARIO || "";

let nextRequestId = 10_000;
const pending = new Map();

const input = readline.createInterface({ input: process.stdin });

function write(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function respond(id, result) {
  write({ id, result });
}

function sessionInfo(mode = "agent", model = "composer-2") {
  return {
    sessionId: SESSION_ID,
    modes: {
      currentModeId: mode,
      availableModes: [{ id: "agent" }, { id: "plan" }, { id: "ask" }],
    },
    models: {
      currentModelId: model,
      availableModels: [
        { modelId: "composer-2", name: "composer-2" },
        { modelId: "composer-2[fast=true]", name: "composer-2 fast" },
        { modelId: "sonnet-4-thinking", name: "sonnet-4-thinking" },
      ],
    },
    configOptions: [
      {
        id: "mode",
        name: "Mode",
        category: "mode",
        type: "select",
        currentValue: mode,
        options: [
          { value: "agent", name: "Agent" },
          { value: "plan", name: "Plan" },
          { value: "ask", name: "Ask" },
        ],
      },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: model,
        options: [
          { value: "composer-2", name: "composer-2" },
          { value: "composer-2[fast=true]", name: "composer-2 fast" },
          { value: "sonnet-4-thinking", name: "sonnet-4-thinking" },
        ],
      },
    ],
  };
}

function promptText(params) {
  if (!params || typeof params !== "object" || !Array.isArray(params.prompt)) return "";
  return params.prompt
    .map((part) => {
      if (part && typeof part === "object" && part.type === "text") {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .join("\n");
}

function scenarioFromPrompt(text) {
  if (DEFAULT_SCENARIO) return DEFAULT_SCENARIO;
  if (text.includes("T3_CURSOR_HARNESS_ASK_QUESTION")) return "ask-question";
  if (text.includes("T3_CURSOR_HARNESS_FILE_APPROVAL")) return "file-approval";
  if (text.includes("T3_CURSOR_HARNESS_COMMAND_APPROVAL")) return "command-approval";
  return "assistant-message";
}

function notifyAgentChunk(text) {
  write({
    method: "session/update",
    params: {
      sessionId: SESSION_ID,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

function requestClient(method, params) {
  const id = nextRequestId++;
  write({ id, method, params });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for client response to ${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timeout });
  });
}

async function runScenario(scenario) {
  if (scenario === "ask-question") {
    await requestClient("cursor/ask_question", {
      sessionId: SESSION_ID,
      toolCallId: "harness-question-1",
      title: "Harness input",
      questions: [
        {
          id: "next_step",
          prompt: "Which path should the harness take?",
          options: [
            { id: "continue", label: "Continue" },
            { id: "stop", label: "Stop" },
          ],
        },
      ],
    });
    notifyAgentChunk("Harness ask_question completed.");
    return;
  }

  if (scenario === "file-approval") {
    await requestClient("session/request_permission", {
      sessionId: SESSION_ID,
      toolCall: {
        toolCallId: "harness-edit-1",
        title: "Edit File",
        kind: "edit",
        status: "pending",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Harness file edit approval for docs/cursor-acp-harness.md",
            },
          },
        ],
      },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    });
    notifyAgentChunk("Harness file approval completed.");
    return;
  }

  if (scenario === "command-approval") {
    await requestClient("session/request_permission", {
      sessionId: SESSION_ID,
      toolCall: {
        toolCallId: "harness-command-1",
        title: "`pwd`",
        kind: "execute",
        status: "pending",
        content: [
          {
            type: "content",
            content: { type: "text", text: "Harness command approval" },
          },
        ],
      },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    });
    notifyAgentChunk("Harness command approval completed.");
    return;
  }

  notifyAgentChunk("Harness assistant message completed.");
}

async function handleRequest(message) {
  const params = message.params ?? {};

  switch (message.method) {
    case "initialize":
      respond(message.id, {
        protocolVersion: 1,
        authMethods: [{ id: "cursor_login", name: "Cursor Login" }],
        capabilities: {},
      });
      return;
    case "authenticate":
      respond(message.id, {});
      return;
    case "session/new":
      respond(message.id, sessionInfo());
      return;
    case "session/load":
      respond(message.id, sessionInfo());
      return;
    case "session/set_config_option":
      respond(
        message.id,
        sessionInfo(
          typeof params.value === "string" && params.configId === "mode" ? params.value : "agent",
          typeof params.value === "string" && params.configId === "model"
            ? params.value
            : "composer-2",
        ),
      );
      return;
    case "session/prompt":
      try {
        await runScenario(scenarioFromPrompt(promptText(params)));
        respond(message.id, { stopReason: "end_turn" });
      } catch (error) {
        write({
          id: message.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      return;
    default:
      write({
        id: message.id,
        error: { code: -32601, message: `Unsupported harness method: ${message.method}` },
      });
  }
}

input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (!message || typeof message !== "object") return;

  if (
    Object.prototype.hasOwnProperty.call(message, "id") &&
    ("result" in message || "error" in message)
  ) {
    const pendingRequest = pending.get(message.id);
    if (!pendingRequest) return;
    clearTimeout(pendingRequest.timeout);
    pending.delete(message.id);
    if (message.error) {
      pendingRequest.reject(new Error(message.error.message || "ACP client returned an error"));
    } else {
      pendingRequest.resolve(message.result);
    }
    return;
  }

  if (typeof message.method === "string" && Object.prototype.hasOwnProperty.call(message, "id")) {
    void handleRequest(message);
  }
});
