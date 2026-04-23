import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ResolveMcpServersInput,
  ResolveMcpServersResult,
  ServerConfigStreamMcpStatusUpdatedEvent,
} from "./server";

function decodeSync<S extends Schema.Top>(schema: S, input: unknown): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
}

describe("ResolveMcpServersInput", () => {
  it("decodes project-scoped MCP status requests", () => {
    const decoded = decodeSync(ResolveMcpServersInput, {
      provider: "claudeAgent:design",
      projectId: "project-1",
      cwd: "/tmp/project",
      forceRefresh: true,
    });

    expect(decoded).toEqual({
      provider: "claudeAgent:design",
      projectId: "project-1",
      cwd: "/tmp/project",
      forceRefresh: true,
    });
  });
});

describe("ResolveMcpServersResult", () => {
  it("decodes loading results", () => {
    expect(
      decodeSync(ResolveMcpServersResult, {
        status: "loading",
        refreshing: true,
        serverNames: [],
      }),
    ).toEqual({
      status: "loading",
      refreshing: true,
      serverNames: [],
    });
  });

  it("decodes ready results with profile snapshots", () => {
    expect(
      decodeSync(ResolveMcpServersResult, {
        status: "ready",
        serverNames: ["github-personal"],
        servers: [
          {
            name: "github-personal",
            status: "connected",
            scope: "user",
            toolCount: 12,
          },
        ],
        profiles: [
          {
            provider: "claudeAgent",
            projectId: "project-1",
            cwd: "/tmp/project",
            status: "ready",
            serverNames: ["github-personal"],
          },
          {
            provider: "claudeAgent:design",
            projectId: "project-1",
            cwd: "/tmp/project",
            status: "ready",
            serverNames: [],
          },
        ],
      }).profiles?.map((snapshot) => snapshot.provider),
    ).toEqual(["claudeAgent", "claudeAgent:design"]);
  });

  it("decodes error results with a message", () => {
    expect(
      decodeSync(ResolveMcpServersResult, {
        status: "error",
        serverNames: [],
        error: "Unable to load MCP status.",
      }),
    ).toEqual({
      status: "error",
      serverNames: [],
      error: "Unable to load MCP status.",
    });
  });
});

describe("ServerConfigStreamMcpStatusUpdatedEvent", () => {
  it("decodes project MCP status stream updates", () => {
    const decoded = decodeSync(ServerConfigStreamMcpStatusUpdatedEvent, {
      version: 1,
      type: "mcpStatusUpdated",
      payload: {
        snapshots: [
          {
            provider: "claudeAgent:design",
            projectId: "project-1",
            cwd: "/tmp/project",
            status: "error",
            serverNames: [],
            error: "Timed out",
          },
        ],
      },
    });

    expect(decoded.payload.snapshots[0]?.provider).toBe("claudeAgent:design");
  });
});
