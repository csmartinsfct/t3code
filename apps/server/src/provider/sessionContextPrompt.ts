import { createHash } from "node:crypto";
import type { PromptDocumentV1, ThreadId } from "@t3tools/contracts";

import {
  buildEnvironmentHeader,
  buildRestEndpointSystemPrompt,
  renderAdminPromptDocument,
} from "./restEndpointSystemPrompt.ts";

export interface AdminPromptDocuments {
  readonly general: PromptDocumentV1;
  readonly managedRuns: PromptDocumentV1;
  readonly scheduledTasks: PromptDocumentV1;
  readonly ticketing: PromptDocumentV1;
}

/**
 * The single, provider-neutral block that tells an agent how to reach the T3
 * project services. Codex, Claude, and Gemini all inject this identical text —
 * Codex/Claude via `appendDeveloperInstructions` / `systemPrompt.append`,
 * Gemini via ACP embedded context on the first user turn.
 */
export function buildT3ServiceInjectionPrompt(input: {
  readonly port: number;
  readonly isDev: boolean;
  readonly projectTitle?: string;
  readonly token: string;
  readonly adminPrompts: AdminPromptDocuments;
}): string {
  const { port, isDev, projectTitle, token, adminPrompts } = input;
  const sections: string[] = [
    buildEnvironmentHeader({ port, isDev, ...(projectTitle ? { projectTitle } : {}) }),
    buildRestEndpointSystemPrompt({ port, token }),
    renderAdminPromptDocument(adminPrompts.general),
    renderAdminPromptDocument(adminPrompts.managedRuns),
    renderAdminPromptDocument(adminPrompts.scheduledTasks),
    renderAdminPromptDocument(adminPrompts.ticketing),
  ];
  return sections.join("\n\n");
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
    sections.push(
      buildT3ServiceInjectionPrompt({
        port: input.serviceContext.port,
        isDev: input.serviceContext.isDev,
        projectTitle: input.projectTitle,
        token: input.serviceContext.token,
        adminPrompts: input.serviceContext.adminPrompts,
      }),
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
