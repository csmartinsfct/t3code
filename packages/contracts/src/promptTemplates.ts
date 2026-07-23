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

export const ADMIN_PROMPT_IDS = [
  "general",
  "managedRuns",
  "scheduledTasks",
  "ticketing",
  "browser",
  "dynamicChatUi",
] as const;
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

// This version tracks the prompt document format, not the shipped prompt text.
// Text-only default prompt updates must keep the same version so persisted
// settings, project overrides, and orchestration-run overrides remain readable.
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

export const RUNTIME_MATCH_VALUES = [
  "devElectron",
  "devWeb",
  "prodElectron",
  "prodWeb",
  "anyDev",
  "anyElectron",
] as const;
export type RuntimeMatch = (typeof RUNTIME_MATCH_VALUES)[number];
export const RuntimeMatch = Schema.Literals(RUNTIME_MATCH_VALUES);

export const PROMPT_CONDITION_TYPES = ["exists", "runtime"] as const;
export type PromptConditionType = (typeof PROMPT_CONDITION_TYPES)[number];
export const PromptConditionType = Schema.Literals(PROMPT_CONDITION_TYPES);

export const PromptTemplateExistsCondition = Schema.Struct({
  type: Schema.Literal("exists"),
  variable: CanonicalPromptVariableKey,
});
export type PromptTemplateExistsCondition = typeof PromptTemplateExistsCondition.Type;

export const PromptTemplateRuntimeCondition = Schema.Struct({
  type: Schema.Literal("runtime"),
  match: RuntimeMatch,
});
export type PromptTemplateRuntimeCondition = typeof PromptTemplateRuntimeCondition.Type;

export const PromptTemplateCondition = Schema.Union([
  PromptTemplateExistsCondition,
  PromptTemplateRuntimeCondition,
]);
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
2. If a matching action exists in the availableActions list, use launch_project_script with its scriptId to start it. Match by command/purpose, not just by name — an action named "Magneto" running "yarn dev" is the right match for "start the magneto dev server". If the user is working in a worktree (or any directory other than the project root), pass \`cwd\` to run the action there; otherwise it runs in the thread's default working directory.
3. Only if NO existing action matches, use propose_project_script to suggest a new one to the user.
4. Do NOT start long-running services directly via Bash or terminal — always use managed runs so T3 can track lifecycle, detect service health, and manage logs.
5. Use get_managed_run_logs to check output and get_managed_run to see service health status.

### Declaring Services

When proposing a project action, investigate what the command actually launches and declare each service by name. T3 binds health checks automatically — never specify a \`healthCheck\` field.

Two shapes are supported.

**Legacy single-process action** — one top-level \`command\` plus a flat list of services as named metadata:

{
  "name": "Supabase",
  "command": "cd magneto && npx supabase start",
  "icon": "play",
  "services": [
    { "name": "Supabase API" },
    { "name": "Supabase Studio" },
    { "name": "Supabase DB" }
  ]
}

**Composite multi-service action** — omit the top-level \`command\` and provide a per-service \`command\` for every entry. Each service runs in its own subprocess with its own log tab, ideal when the user benefits from per-service log separation:

{
  "name": "Web Dev (split)",
  "icon": "play",
  "services": [
    { "name": "Backend", "command": "bun run dev:server" },
    { "name": "Vite", "command": "bun run dev:web" }
  ]
}

Mixing the two shapes (top-level \`command\` AND per-service \`command\`s) is rejected by T3 — pick one. Use composite when the user benefits from per-service log separation; use the legacy single-command shape otherwise.`;

const SCHEDULED_TASKS_DEFAULT_TEXT = `## T3 Scheduled Tasks

This project has T3 scheduled tasks support via the T3 scheduled tasks REST API. When the user asks to schedule recurring tasks or automate thread creation:

1. Call list_scheduled_tasks to check what tasks already exist.
2. To create a new task with user review, use propose_scheduled_task — the user will see an interactive card where they can edit, accept, or reject the proposal.
3. To create a task directly (when the user has already confirmed), use create_scheduled_task.
4. Use toggle_scheduled_task to enable or disable existing tasks.
5. Use run_scheduled_task_now to manually trigger a task for testing.
6. Use list_scheduled_task_runs to check run history.

Scheduled tasks can include providerCapabilities for provider-native plugins or plugin skills. Reuse exact capability metadata already present in the conversation or tool context; do not invent capability IDs, paths, or connector IDs.

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

const BROWSER_DEFAULT_TEXT = `## T3 Browser Automation

This project has T3 browser automation via the \`/api/browser\` REST endpoint — a per-project Chromium context with plaintext output and stable element references (@refs). In the desktop build it drives the visible embedded browser pane in T3 Code; in the server-only build it drives a headless Playwright Chromium. Prefer this over any chrome-devtools or other browser MCP: it is faster, per-project isolated, and the default endpoint the T3 server provides.

### When to use it

- Automating a web UI (click buttons, fill forms, extract text, take screenshots).
- Verifying that a dev-server change renders correctly in a real browser.
- Scraping a page for structured data (links, forms, Open Graph, JSON-LD).
- Inspecting or modifying CSS live on a running page.

### Call pattern

\`\`\`bash
curl -s -X POST <BASE_URL>/api/browser?projectId=<PROJECT_UUID> \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"<tool>","input":{...}}'
\`\`\`

Responses wrap the command's plaintext output in the standard T3 envelope:
\`{"data":{"message":"OK","data":{"output":"<plaintext>"}},"error":null}\`.

Call \`GET /api/browser\` first to discover the full tool registry with input schemas — 55+ tools are registered.

### The @ref system (important)

Call \`snapshot\` first to get the accessibility tree with stable element references. Each element gets an \`@e<N>\` (ARIA role) or \`@c<N>\` (cursor-interactive) identifier. Use those refs in follow-up \`click\`, \`fill\`, \`hover\`, \`attrs\`, \`css\`, \`is\`, \`screenshot\` calls. @refs are invalidated on navigation — call \`snapshot\` again after \`goto\` / \`click\` / \`reload\`.

Example flow:
1. \`{"tool":"goto","input":{"url":"https://example.com"}}\`
2. \`{"tool":"snapshot","input":{"interactive":true}}\` → returns \`@e1 [link] "Learn more"\`
3. \`{"tool":"click","input":{"ref":"@e1"}}\`
4. \`{"tool":"snapshot","input":{"interactive":true}}\` → fresh refs for the new page

Prefer @refs over CSS selectors. Selectors still work as a fallback but are fragile.

### Command categories

- **Navigate:** \`goto\`, \`back\`, \`forward\`, \`reload\`, \`url\`
- **Read:** \`text\`, \`html\`, \`links\`, \`forms\`, \`accessibility\`, \`js\`, \`evaluate\`, \`eval\`, \`css\`, \`attrs\`, \`is\`, \`console\`, \`network\`, \`dialog\`, \`cookies\`, \`storage\`, \`perf\`, \`inspect\`, \`media\`, \`data\`
- **Interact:** \`click\`, \`fill\`, \`select\`, \`hover\`, \`type\`, \`press\`, \`scroll\`, \`wait\`, \`viewport\`, \`cookie\`, \`cookie-import\`, \`cookie-import-browser\`, \`header\`, \`upload\`, \`dialog-accept\`, \`dialog-dismiss\`, \`style\`, \`cleanup\`, \`prettyscreenshot\`
- **Visual/Meta:** \`snapshot\`, \`screenshot\`, \`pdf\`, \`responsive\`, \`diff\`, \`tabs\`, \`tab\`, \`newtab\`, \`closetab\`, \`status\`, \`ux-audit\`
- **Extensions (desktop only):** \`load_extension\`, \`remove_extension\`, \`open_extension\`, \`list_extensions\`, \`ext_windows\`, \`ext_switch\`, \`ext_close\`
- **Batch:** \`batch\` runs up to 50 commands sequentially in one request. Entries are \`{tool, input}\` objects, same shape as top-level calls. Nested \`batch\` is rejected.

### Chrome extension tools (desktop only)

Install and interact with Chrome extensions (e.g. MetaMask, Rainbow wallet) in the embedded browser:

- **\`load_extension <extensionId>\`** — install a Chrome extension by its 32-char Web Store ID (find it in the Web Store URL). Users can also click "Add to Chrome" directly in the embedded browser — that flow is fully automatic and requires no agent action.
- **\`remove_extension <extensionId>\`** — remove a loaded extension. Web Store extensions are uninstalled from T3's managed extension directory; unpacked dev extensions are unloaded without deleting the source folder.
- **\`list_extensions\`** — list all installed extensions with their IDs, names, versions
- **\`open_extension <extensionId>\`** — open an extension's action popup as a real floating window (same as clicking the extension icon). Required before \`ext_switch\` if no popup is open yet.
- **\`ext_windows\`** — list all open extension popup windows, including dapp approval windows from \`chrome.windows.create()\`; use the returned \`popupKey\` to disambiguate multiple windows for the same extension
- **\`ext_switch <popupKey|extensionId>\`** — redirect subsequent \`snapshot\`/\`click\`/\`fill\`/\`js\` calls to an extension popup. Prefer \`popupKey\` when \`ext_windows\` lists more than one popup; call with no argument to revert to the main tab.
- **\`ext_close <popupKey|extensionId>\`** — close an extension popup window. Prefer \`popupKey\` when multiple popups are open for the same extension.

Typical wallet dapp flow: \`open_extension <id>\` → \`ext_windows\` → \`ext_switch <popupKey>\` → \`snapshot\` → \`click\` approve → \`ext_switch\` (revert). Use \`ext_windows\` to find approval popups that appeared automatically from dapp interactions.

### Known issues

- \`useragent\` currently fails under the per-project persistent-context (returns "Context recreation failed: null is not an object" and resets the tab). Tracked for fix; avoid until resolved.

### Per-project isolation

Each project has its own Chromium profile at \`<dataDir>/browser/<projectId>/chromium-profile/\`. Cookies, localStorage, and auth sessions persist across server restarts but never bleed between projects.`;

const BROWSER_PACKAGED_AGENT_TEXT = `### Repository-owned Playwright commands

The packaged T3 backend sets \`PLAYWRIGHT_BROWSERS_PATH\` to T3 Code's bundled, version-specific browser cache. That cache is for T3's browser runtime; it is not a universal cache for Playwright versions used by checked-out repositories.

Before running a repository-owned Playwright, Vitest browser, or Storybook test command, remove that variable from the child command so the repository uses its own Playwright cache:

\`\`\`bash
env -u PLAYWRIGHT_BROWSERS_PATH <test-command>
\`\`\`

Use the shell-appropriate equivalent on Windows. Do not install a repository's browser revision into T3's application bundle.

If Playwright reports \`Executable doesn't exist\` under T3's \`Resources/playwright-browsers\` directory, compare the revision requested by the repository with the revisions actually bundled by T3 before diagnosing the failure. A different requested revision is a cache/version mismatch, not evidence that T3's production browser is missing.`;

const BROWSER_ELECTRON_TEXT = `### Embedded browser (desktop build)

The browser this tool drives is the **embedded WebContentsView** in the T3 Code chat shell — the same pane the user can see and interact with. There is no separate Playwright instance. Side effects (navigation, scrolling, typing, dialog interception, viewport emulation) are visible to the user in real time, so the agent's actions and the user's expectations stay in sync.

One tool hasn't been ported to this mode yet and returns "tool X is not yet supported in native (Electron) mode" if called: \`cookie-import-browser\`. Use \`cookie-import\` (not \`cookie-import-browser\`) for cookie-jar imports — it works in both modes.

Everything else — \`goto\`, \`snapshot\`, \`click\`, \`fill\`, \`eval\`, \`console\`, \`network\`, \`dialog\`, \`screenshot\`, \`pdf\`, etc. — works the same as the headless mode.

### Extension development

You can develop and test Chrome extensions inside the embedded browser. The embedded browser fully supports Chrome extension APIs via the \`electron-chrome-extensions\` bridge.

**Loading a local extension:**
Use \`load_unpacked\` with the absolute path to the directory containing manifest.json. Calling it again with the same path reloads the extension after code changes.

**Reloading by ID:**
Use \`reload_extension <extensionId>\` when you have the ID from \`list_extensions\` but not the path.

**Removing by ID:**
Use \`remove_extension <extensionId>\` to uninstall a Web Store extension or unload an unpacked dev extension. Unpacked source folders are never deleted.

**HMR-capable frameworks (Vite+CRXJS, Plasmo, WXT):**
1. Start the framework dev server via the managed runs system
2. Use \`load_unpacked\` pointing at the build output directory (e.g. \`dist/\`)
3. The framework calls \`chrome.runtime.reload()\` automatically on file changes

**Plain/vanilla extensions:** write files → \`load_unpacked <dir>\` → edit → \`load_unpacked <dir>\` again to reload.`;

const DYNAMIC_CHAT_UI_DEFAULT_TEXT = `## Dynamic Chat UI

T3 can generate interactive, durable UI artifacts directly inside the chat timeline through the \`/api/dynamic-chat-ui\` REST endpoint.

Use this when the user asks for an inline interface, simulator, dashboard, table, chart, calculator, picker, visual comparison, or any other UI that would be more useful than prose.

### Available tool

Only call \`create_dynamic_chat_ui_from_prompt\`.

Do not call lower-level artifact creation tools, do not generate raw HTML yourself in the parent chat agent, and do not ask for example templates first. The Dynamic UI builder receives the design guide and constraints internally.

### How to call it

1. Call \`GET /api/dynamic-chat-ui\` to inspect the current input schema.
2. Call \`POST /api/dynamic-chat-ui\` with \`{"tool":"create_dynamic_chat_ui_from_prompt","input":{...}}\`.
3. Put the user's UI request in \`prompt\`.
4. Pass any structured values the UI should render or simulate in \`data\`.
5. Pass short product/domain notes in \`context\` when useful.
6. You must pass a short \`title\` and \`description\`. The \`description\` must be a brief description of what is being built; both fields are shown immediately by the generating timeline card before the hidden builder finishes. Requests without these fields are rejected.
7. For revisions, pass \`sourceArtifactId\` and, when available, \`sourceMessageId\` for the existing UI artifact.

The tool uses the current chat thread's selected model for the hidden builder session, clamped to a practical reasoning level where needed. It inserts a generating card into the chat timeline, replaces it with the finished sandboxed UI, and returns metadata.

### Response behavior

After a successful call, the UI has already been inserted into the chat timeline as a message. Do not print returned HTML, JSON, markdown fences, or artifact blocks. Briefly acknowledge the UI only if the user expects prose around it.

If the user asks to change a generated UI, call the same tool again with the revision request and the source artifact identifiers. The builder will resume the hidden artifact session when possible and receives the previous HTML as context.`;

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
  browser: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [
      { when: null, text: BROWSER_DEFAULT_TEXT },
      {
        when: { type: "runtime", match: "prodElectron" },
        text: BROWSER_PACKAGED_AGENT_TEXT,
      },
      { when: { type: "runtime", match: "anyElectron" }, text: BROWSER_ELECTRON_TEXT },
    ],
  },
  dynamicChatUi: {
    version: PROMPT_TEMPLATE_VERSION,
    blocks: [{ when: null, text: DYNAMIC_CHAT_UI_DEFAULT_TEXT }],
  },
} as const satisfies Record<AdminPromptId, PromptDocumentV1>;
