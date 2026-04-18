import { Schema } from "effect";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";

export const ORCHESTRATION_PROMPT_GROUP_ID = "orchestration" as const;
export const OrchestrationPromptGroupId = Schema.Literal(ORCHESTRATION_PROMPT_GROUP_ID);
export type OrchestrationPromptGroupId = typeof OrchestrationPromptGroupId.Type;

export const ORCHESTRATION_PROMPT_IDS = [
  "implement",
  "resume",
  "resumeFreshAgent",
  "review",
  "reReview",
  "reviewFeedback",
] as const;
export type OrchestrationPromptId = (typeof ORCHESTRATION_PROMPT_IDS)[number];
export const OrchestrationPromptId = Schema.Literals(ORCHESTRATION_PROMPT_IDS);

export const ADMIN_PROMPT_GROUP_ID = "admin" as const;
export const AdminPromptGroupId = Schema.Literal(ADMIN_PROMPT_GROUP_ID);
export type AdminPromptGroupId = typeof AdminPromptGroupId.Type;

export const ADMIN_PROMPT_IDS = ["general", "managedRuns", "scheduledTasks", "ticketing"] as const;
export type AdminPromptId = (typeof ADMIN_PROMPT_IDS)[number];
export const AdminPromptId = Schema.Literals(ADMIN_PROMPT_IDS);

export const PROMPT_GROUP_IDS = [ORCHESTRATION_PROMPT_GROUP_ID, ADMIN_PROMPT_GROUP_ID] as const;
export type PromptGroupId = (typeof PROMPT_GROUP_IDS)[number];
export const PromptGroupId = Schema.Literals(PROMPT_GROUP_IDS);

export const ALL_PROMPT_IDS = [...ORCHESTRATION_PROMPT_IDS, ...ADMIN_PROMPT_IDS] as const;
export type PromptId = (typeof ALL_PROMPT_IDS)[number];
export const PromptId = Schema.Literals(ALL_PROMPT_IDS);

export const OrchestrationPromptOverrides = Schema.Struct({
  implement: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
  resume: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
  resumeFreshAgent: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
  review: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
  reReview: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
  reviewFeedback: Schema.optionalKey(Schema.suspend(() => PromptDocumentV1)),
}).pipe(Schema.withDecodingDefault(() => ({})));
export type OrchestrationPromptOverrides = typeof OrchestrationPromptOverrides.Type;

export const OrchestrationPromptOverridesPatch = Schema.Struct({
  implement: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
  resume: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
  resumeFreshAgent: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
  review: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
  reReview: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
  reviewFeedback: Schema.optionalKey(Schema.NullOr(Schema.suspend(() => PromptDocumentV1))),
}).pipe(Schema.withDecodingDefault(() => ({})));
export type OrchestrationPromptOverridesPatch = typeof OrchestrationPromptOverridesPatch.Type;

export const PROMPT_TEMPLATE_VERSION = 1 as const;
export const PromptTemplateVersion = Schema.Literal(PROMPT_TEMPLATE_VERSION);
export type PromptTemplateVersion = typeof PromptTemplateVersion.Type;

export const CANONICAL_PROMPT_VARIABLE_KEYS = [
  "ticketId",
  "ticketTitle",
  "ticketDescription",
  "acceptanceCriteria",
  "worktree",
  "projectTitle",
  "projectPath",
  "commitDiff",
  "reviewIteration",
  "reviewSummary",
  "reviewComments",
] as const;
export type CanonicalPromptVariableKey = (typeof CANONICAL_PROMPT_VARIABLE_KEYS)[number];
export const CanonicalPromptVariableKey = Schema.Literals(CANONICAL_PROMPT_VARIABLE_KEYS);

export const PromptTemplateCondition = Schema.Struct({
  type: Schema.Literal("exists"),
  variable: CanonicalPromptVariableKey,
});
export type PromptTemplateCondition = typeof PromptTemplateCondition.Type;

export const PromptTemplateBlock = Schema.Struct({
  when: Schema.NullOr(PromptTemplateCondition),
  text: Schema.String,
});
export type PromptTemplateBlock = typeof PromptTemplateBlock.Type;

export const PromptTemplateDocument = Schema.Struct({
  version: PromptTemplateVersion,
  blocks: Schema.Array(PromptTemplateBlock),
});
export type PromptTemplateDocument = typeof PromptTemplateDocument.Type;
export const PromptDocumentV1 = PromptTemplateDocument;
export type PromptDocumentV1 = typeof PromptDocumentV1.Type;

export const PromptTemplateVariableDefinition = Schema.Struct({
  key: CanonicalPromptVariableKey,
  promptIds: Schema.Array(PromptId),
  label: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  aliases: Schema.Array(TrimmedNonEmptyString),
});
export type PromptTemplateVariableDefinition = typeof PromptTemplateVariableDefinition.Type;

export const PROMPT_TEMPLATE_VALIDATION_ERROR_CODES = [
  "invalid_document",
  "invalid_version",
  "invalid_block",
  "invalid_condition",
  "malformed_interpolation_token",
  "unknown_variable",
  "variable_not_allowed",
] as const;
export type PromptTemplateValidationErrorCode =
  (typeof PROMPT_TEMPLATE_VALIDATION_ERROR_CODES)[number];
export const PromptTemplateValidationErrorCode = Schema.Literals(
  PROMPT_TEMPLATE_VALIDATION_ERROR_CODES,
);

export const PromptTemplateValidationError = Schema.Struct({
  code: PromptTemplateValidationErrorCode,
  promptGroupId: PromptGroupId,
  promptId: PromptId,
  message: TrimmedNonEmptyString,
  path: Schema.Array(Schema.String),
  blockIndex: Schema.NullOr(NonNegativeInt),
  variable: Schema.NullOr(Schema.String),
  token: Schema.NullOr(Schema.String),
});
export type PromptTemplateValidationError = typeof PromptTemplateValidationError.Type;

export const ORCHESTRATION_PROMPT_SHIPPED_DEFAULTS = {
  implement: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "Work on ticket ${ticketTitle} - ${ticketId}.",
      },
      {
        when: { type: "exists", variable: "worktree" },
        text: " Worktree: ${worktree}.",
      },
      {
        when: null,
        text: " Pull the ticket details and any other context you need yourself. If you get blocked, update the ticket status to blocked and stop. Try to complete the acceptance criteria mentioned in the ticket, if defined. Otherwise try to comply with the specifications in the ticket.",
      },
    ],
  },
  resume: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "Continue.",
      },
    ],
  },
  resumeFreshAgent: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "Work on ticket ${ticketTitle} - ${ticketId}. You are taking over this ticket with a fresh agent session, and prior work may already exist in the workspace or thread history.",
      },
      {
        when: { type: "exists", variable: "worktree" },
        text: " Worktree: ${worktree}.",
      },
      {
        when: null,
        text: " First inspect the current workspace state and determine what remains. Do not overwrite unrelated changes or assume the earlier agent finished correctly. Pull the ticket details and any other context you need yourself. If you get blocked, update the ticket status to blocked and stop. Try to complete the acceptance criteria mentioned in the ticket, if defined. Otherwise try to comply with the specifications in the ticket.",
      },
    ],
  },
  review: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "You are reviewing completed work for a ticket in an automated orchestration workflow. Evaluate the implementation against the ticket requirements and the provided diff. Return valid JSON only. Do not include markdown fences, commentary, or any text outside the JSON object.\n\nReview the completed work for ticket ${ticketId}: ${ticketTitle}.",
      },
      {
        when: { type: "exists", variable: "ticketDescription" },
        text: "\n\nTicket description:\n${ticketDescription}",
      },
      {
        when: { type: "exists", variable: "acceptanceCriteria" },
        text: "\n\nAcceptance criteria:\n${acceptanceCriteria}",
      },
      {
        when: { type: "exists", variable: "worktree" },
        text: "\n\nWorktree:\n${worktree}",
      },
      {
        when: null,
        text: '\n\nDiff:\n${commitDiff}\n\nReview iteration: ${reviewIteration}\n\nReturn a JSON object matching this shape exactly:\n{\n  "changesNeeded": boolean,\n  "summary": string,\n  "comments": [\n    {\n      "file": string | null,\n      "line": number | null,\n      "severity": "critical" | "suggestion" | "nit",\n      "body": string\n    }\n  ]\n}\n\nIf the ticket worktree is not null, treat it as part of the task context while reviewing. Set changesNeeded to true if the work should not yet be accepted. Set it to false only if the ticket is ready to be accepted as complete. Return JSON only.',
      },
    ],
  },
  reReview: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "You are performing a follow-up review for a ticket in an automated orchestration workflow. Verify whether the latest implementation changes addressed the prior review findings. Return valid JSON only. Do not include markdown fences, commentary, or any text outside the JSON object.\n\nRe-review the latest changes for ticket ${ticketId}: ${ticketTitle}.",
      },
      {
        when: { type: "exists", variable: "ticketDescription" },
        text: "\n\nTicket description:\n${ticketDescription}",
      },
      {
        when: { type: "exists", variable: "acceptanceCriteria" },
        text: "\n\nAcceptance criteria:\n${acceptanceCriteria}",
      },
      {
        when: { type: "exists", variable: "worktree" },
        text: "\n\nWorktree:\n${worktree}",
      },
      {
        when: { type: "exists", variable: "reviewSummary" },
        text: "\n\nPrior review summary:\n${reviewSummary}",
      },
      {
        when: null,
        text: '\n\nLatest changes since the prior review:\n${commitDiff}\n\nReview iteration: ${reviewIteration}\n\nReturn a JSON object matching this shape exactly:\n{\n  "changesNeeded": boolean,\n  "summary": string,\n  "comments": [\n    {\n      "file": string | null,\n      "line": number | null,\n      "severity": "critical" | "suggestion" | "nit",\n      "body": string\n    }\n  ]\n}\n\nSet changesNeeded to true if the requested fixes are not fully addressed or the work should not yet be accepted. Set it to false only if the ticket is ready to be accepted as complete. Return JSON only.',
      },
    ],
  },
  reviewFeedback: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      {
        when: null,
        text: "Address the automated review feedback for ticket ${ticketId}.\n\nReview summary: ${reviewSummary}",
      },
      {
        when: { type: "exists", variable: "reviewComments" },
        text: "\n\nReview comments:\n${reviewComments}",
      },
      {
        when: null,
        text: "\n\nApply the needed fixes, then continue until the ticket is ready for review again.",
      },
    ],
  },
} as const satisfies Record<OrchestrationPromptId, PromptDocumentV1>;

// ---------------------------------------------------------------------------
// Admin prompt shipped defaults
// ---------------------------------------------------------------------------

const GENERAL_DEFAULT_TEXT = `## Session Restart

If the underlying agent process needs to be restarted — for example, because you installed a new MCP server that only loads at startup, or because a tool call (commonly \`chrome-devtools\`) has deadlocked and is not recoverable — call \`restart_session\` on the session-restart endpoint.

1. Call \`POST /api/session-restart\` with tool \`restart_session\`. No arguments are required.
2. The tool returns immediately. Your current turn will end, the underlying session will be stopped and resumed, and you will receive a short continuation prompt telling you to continue your work.
3. Prior conversation context is preserved via the session resume cursor — you will still have the full history.
4. Do NOT call this casually. Every call costs a real stop/start cycle (usually a few seconds of latency). Only use it when you have a concrete reason (newly installed MCP, stuck tool, known-bad session state).`;

const MANAGED_RUNS_DEFAULT_TEXT = `## T3 Managed Runs

This project has T3 managed runs support via the T3 managed runs REST API. When you need to start a long-running service (dev server, build watcher, docker compose, etc.):

1. Call list_managed_runs to check what's already running AND what actions are available.
2. If a matching action exists in the availableActions list, use launch_project_script with its scriptId to start it. Match by command/purpose, not just by name — an action named "Magneto" running "yarn dev" is the right match for "start the magneto dev server".
3. Only if NO existing action matches, use propose_project_script to suggest a new one to the user.
4. Do NOT start long-running services directly via Bash or terminal — always use managed runs so T3 can track lifecycle, detect service health, and manage logs.
5. Use get_managed_run_logs to check output and get_managed_run to see service health status.

### Declaring Services

When proposing a project action, you MUST investigate what the command actually launches and declare each service with a health check. T3 monitors declared services independently of the launcher process — this is critical for commands that exit after starting background services (e.g. docker compose, supabase start).

Health check types:
- Web servers/APIs: { "type": "url", "url": "http://localhost:PORT" }
- Docker containers: { "type": "docker", "container": "container_name" }
- Services on known ports: { "type": "port", "port": PORT }
- Other services: { "type": "command", "command": "status-check-command" }

Example for npx supabase start:
{
  "name": "Supabase",
  "command": "cd magneto && npx supabase start",
  "icon": "play",
  "services": [
    { "name": "Supabase API", "healthCheck": { "type": "url", "url": "http://127.0.0.1:54321" } },
    { "name": "Supabase Studio", "healthCheck": { "type": "url", "url": "http://127.0.0.1:54323" } },
    { "name": "Supabase DB", "healthCheck": { "type": "docker", "container": "supabase_db_magneto" } }
  ]
}

Example for npm run dev:
{
  "name": "Dev Server",
  "command": "npm run dev",
  "icon": "play",
  "services": [
    { "name": "Next.js", "healthCheck": { "type": "url", "url": "http://localhost:3000" } }
  ]
}

Always declare services — even for simple foreground dev servers. This enables T3 to show accurate service health in the Runs UI.`;

const SCHEDULED_TASKS_DEFAULT_TEXT = `## T3 Scheduled Tasks

This project has T3 scheduled tasks support via the T3 scheduled tasks REST API. When the user asks to schedule recurring tasks or automate thread creation:

1. Call list_scheduled_tasks to check what tasks already exist.
2. To create a new task with user review, use propose_scheduled_task — the user will see an interactive card where they can edit, accept, or reject the proposal.
3. To create a task directly (when the user has already confirmed), use create_scheduled_task.
4. Use toggle_scheduled_task to enable or disable existing tasks.
5. Use run_scheduled_task_now to manually trigger a task for testing.
6. Use list_scheduled_task_runs to check run history.

### Proposing Scheduled Tasks

When proposing a scheduled task, use propose_scheduled_task. After calling it, you MUST include the returned code block with language tag \`t3:propose-scheduled-task\` in your response. The user will see an interactive card to review and accept.

Standard 5-field cron expressions: minute hour day-of-month month day-of-week
- Every minute: * * * * *
- Every day at 9am: 0 9 * * *
- Every weekday at 9am: 0 9 * * 1-5
- Every hour: 0 * * * *`;

const TICKETING_DEFAULT_TEXT = `## T3 Ticketing

This project has T3 ticketing support via the T3 ticketing REST API.

**All ticket ID parameters use human-readable identifiers (e.g. "ZBD-7").** The server resolves identifiers automatically.
When you mention a ticket in chat text, format it as markdown using the exact identifier, for example \`[ZBD-7](t3://ticket/ZBD-7)\`. This lets the UI open the ticket directly.

When the user asks about tickets, tasks, issues, or project tracking:

1. Call list_tickets to see existing tickets with optional filters (status, priority, label, search).
2. Use create_ticket to add new tickets with title, description, status, priority, labels, and dependencies.
3. Use update_ticket to modify existing tickets (title, description, status, priority, parent).
4. Use search_tickets for text-based search across ticket titles, descriptions, and identifiers.
5. Use get_ticket_tree to view the hierarchical structure of tickets (epics and sub-tickets).
6. Manage dependencies with add_ticket_dependency and remove_ticket_dependency. Cycle detection prevents circular dependencies.
7. Use create_label and add_ticket_label / remove_ticket_label to organize tickets with project-scoped labels.
8. Use create_comment for ticket discussions. Comments support single-depth threading (replies to top-level comments).
9. Use create_artifact to attach Figma URLs, Mermaid diagrams, or images to tickets or comments.
10. Use update_criterion_status to track acceptance criteria progress (pending, met, not_met).
11. Use get_ticket_history for audit trails of all ticket changes.
12. Tickets can optionally have a \`worktree\` field storing the git worktree/branch name for isolated development. Set it via create_ticket or update_ticket. Set to null to clear.`;

export const ADMIN_PROMPT_SHIPPED_DEFAULTS = {
  general: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [{ when: null, text: GENERAL_DEFAULT_TEXT }],
  },
  managedRuns: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [{ when: null, text: MANAGED_RUNS_DEFAULT_TEXT }],
  },
  scheduledTasks: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [{ when: null, text: SCHEDULED_TASKS_DEFAULT_TEXT }],
  },
  ticketing: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [{ when: null, text: TICKETING_DEFAULT_TEXT }],
  },
} as const satisfies Record<AdminPromptId, PromptDocumentV1>;
