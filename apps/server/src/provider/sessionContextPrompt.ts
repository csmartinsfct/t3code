import { createHash } from "node:crypto";
import type { PromptDocumentV1, ThreadId } from "@t3tools/contracts";

import {
  buildEnvironmentHeader,
  buildRestEndpointSystemPrompt,
  renderAdminPromptDocument,
} from "./restEndpointSystemPrompt.ts";

interface AdminPromptDocuments {
  readonly managedRuns: PromptDocumentV1;
  readonly scheduledTasks: PromptDocumentV1;
  readonly ticketing: PromptDocumentV1;
}

interface ProviderSessionContextPromptInput {
  readonly threadId: ThreadId;
  readonly projectTitle: string;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly systemPrompt: string | null;
  readonly includeProjectContext?: boolean;
  readonly serviceContext?: {
    readonly port: number;
    readonly isDev: boolean;
    readonly token: string;
    readonly adminPrompts: AdminPromptDocuments;
  };
}

function buildProjectContextSection(input: ProviderSessionContextPromptInput): string {
  const lines = [
    "## T3 Project Context",
    "",
    `- **Project:** ${input.projectTitle}`,
    `- **Thread:** ${input.threadId}`,
    `- **Workspace root:** ${input.workspaceRoot}`,
  ];
  if (input.worktreePath) {
    lines.push(`- **Worktree:** ${input.worktreePath}`);
  }
  return lines.join("\n");
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildProviderSessionContextPrompt(
  input: ProviderSessionContextPromptInput,
): string | undefined {
  const sections: string[] = [];

  if (input.includeProjectContext) {
    sections.push(buildProjectContextSection(input));
  }

  if (input.serviceContext && input.serviceContext.port > 0) {
    const { port, isDev, token, adminPrompts } = input.serviceContext;
    sections.push(
      buildEnvironmentHeader({
        port,
        isDev,
        projectTitle: input.projectTitle,
      }),
      buildRestEndpointSystemPrompt({ port, token }),
      renderAdminPromptDocument(adminPrompts.managedRuns),
      renderAdminPromptDocument(adminPrompts.scheduledTasks),
      renderAdminPromptDocument(adminPrompts.ticketing),
    );
  }

  const projectSystemPrompt = trimOrUndefined(input.systemPrompt);
  if (projectSystemPrompt) {
    sections.push(projectSystemPrompt);
  }

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

export function hashProviderSessionContextPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}
