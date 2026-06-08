import { describe, expect, it } from "vitest";

import { parseToolCallBody, type ToolDefinition, validateToolInput } from "./restResponse";

const toolDefinitions: ToolDefinition[] = [
  {
    name: "create_ticket",
    title: "Create Ticket",
    description: "Create a ticket.",
    inputSchema: {
      title: { type: "string" },
      description: { type: "string", optional: true },
      parentId: { type: "string", optional: true },
    },
  },
  {
    name: "restart_session",
    title: "Restart Session",
    description: "Restart the current agent session.",
    inputSchema: {},
  },
  {
    name: "propose_project_script",
    title: "Propose Project Script",
    description: "Propose a project script.",
    inputSchema: {
      name: { type: "string" },
      services: {
        type: "array",
        optional: true,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            command: { type: "string", optional: true },
          },
        },
      },
    },
  },
  {
    name: "preview_prompt_document",
    title: "Preview Prompt Document",
    description: "Preview a prompt document.",
    inputSchema: {
      document: {
        type: "object",
        optional: true,
      },
    },
  },
];

describe("validateToolInput", () => {
  it("rejects unknown top-level input fields with a suggestion", () => {
    const error = validateToolInput(toolDefinitions, "create_ticket", {
      title: "Child ticket",
      parent: "METR-474",
    });

    expect(error).toContain("Unknown input field 'parent' for tool 'create_ticket'.");
    expect(error).toContain("Did you mean 'parentId'?");
    expect(error).toContain("Allowed fields: 'title', 'description', 'parentId'.");
  });

  it("rejects unknown fields for tools with empty input schemas", () => {
    const error = validateToolInput(toolDefinitions, "restart_session", {
      reason: "reload tools",
    });

    expect(error).toContain("Unknown input field 'reason' for tool 'restart_session'.");
    expect(error).toContain("No input fields are accepted.");
  });

  it("rejects unknown nested fields when the input schema declares object properties", () => {
    const error = validateToolInput(toolDefinitions, "propose_project_script", {
      name: "Web dev",
      services: [
        {
          name: "Vite",
          command: "bun run dev:web",
          healthCheck: { url: "http://localhost:5173" },
        },
      ],
    });

    expect(error).toContain(
      "Unknown input field 'services[0].healthCheck' for tool 'propose_project_script'.",
    );
    expect(error).toContain("Allowed fields: 'name', 'command'.");
  });

  it("allows free-form object values when the input schema does not declare properties", () => {
    expect(
      validateToolInput(toolDefinitions, "preview_prompt_document", {
        document: {
          version: 1,
          blocks: [{ id: "intro", unknownToRestValidator: true }],
        },
      }),
    ).toBeNull();
  });
});

describe("parseToolCallBody", () => {
  it("rejects non-object input payloads", async () => {
    const request = new Request("http://localhost/api/ticketing", {
      method: "POST",
      body: JSON.stringify({
        tool: "list_tickets",
        input: [],
      }),
    });

    await expect(parseToolCallBody(request)).resolves.toBeNull();
  });
});
