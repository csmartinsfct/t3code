# Chat Model-to-User Prompts

Interactive UI patterns where the model (or server) surfaces a prompt that the user can accept, reject, or respond to directly in the chat or composer.

## Pattern Overview

There are two categories:

1. **Code block cards** — The model outputs a fenced code block with a special `t3:*` language tag. ChatMarkdown detects it and renders an interactive card inline. The user edits fields and clicks Accept/Reject.
2. **Activity-based prompts** — The orchestration engine emits an activity (approval request, user input question, proposed plan). The composer footer renders a dedicated panel with action buttons.

## Code Block Cards

### Propose Action (`t3:propose-action`)

Lets the model propose a new project action/script for the user to review.

**Data flow:**

````
MCP tool: propose_project_script (managedRuns/http.ts)
  → model outputs ```t3:propose-action ... ``` code block
  → ChatMarkdown.tsx detects via isProposeActionBlock() (lib/proposeActionParser.ts)
  → renders ProposeActionCard (components/chat/ProposeActionCard.tsx)
  → user clicks Accept/Reject
  → ChatMarkdown fires onProposeAction callback
  → MessagesTimeline.tsx passes it up
  → ChatView.tsx handleProposeAction():
      accept: dispatches project.meta.update + thread.turn.start with "Action added: ..."
      reject: dispatches thread.turn.start with "User rejected the proposed action."
````

**Key files:**

- Parser: `apps/web/src/lib/proposeActionParser.ts`
- Card: `apps/web/src/components/chat/ProposeActionCard.tsx`
- MCP tool: `apps/server/src/managedRuns/http.ts` → `propose_project_script`
- Handler: `apps/web/src/components/ChatView.tsx` → `handleProposeAction`

### Propose Cron Job (`t3:propose-cron`)

Lets the model propose a scheduled cron job for the user to review.

**Data flow:**

````
MCP tool: propose_cron_job (cronJobs/http.ts)
  → model outputs ```t3:propose-cron ... ``` code block
  → ChatMarkdown.tsx detects via isProposeCronJobBlock() (lib/proposeCronJobParser.ts)
  → renders ProposeCronJobCard (components/chat/ProposeCronJobCard.tsx)
  → user clicks Accept/Reject
  → ChatMarkdown fires onProposeCronJob callback
  → MessagesTimeline.tsx passes it up
  → ChatView.tsx handleProposeCronJob():
      accept: calls api.cronJobs.create() + thread.turn.start with "Cron job added: ..."
      reject: dispatches thread.turn.start with "User rejected the proposed cron job."
````

**Key files:**

- Parser: `apps/web/src/lib/proposeCronJobParser.ts`
- Card: `apps/web/src/components/chat/ProposeCronJobCard.tsx`
- MCP tool: `apps/server/src/cronJobs/http.ts` → `propose_cron_job`
- Handler: `apps/web/src/components/ChatView.tsx` → `handleProposeCronJob`

### Adding a new code block card

1. Choose a language tag: `t3:your-feature`
2. Create a parser in `apps/web/src/lib/` with `isYourFeatureBlock()` and `parseYourFeaturePayload()`
3. Create a card component in `apps/web/src/components/chat/`
4. Wire detection in `ChatMarkdown.tsx` (in the `pre` component override, after existing checks)
5. Add callback prop to `ChatMarkdownProps`, thread through `MessagesTimeline.tsx`
6. Add handler in `ChatView.tsx`
7. Create the MCP tool that instructs the model to output the code block

## Activity-Based Prompts

These render in the **composer footer**, not inline in messages.

### Pending Approval

The provider requests permission for an action (file read, file change, command execution).

**Data flow:**

```
Provider emits approval_requested activity
  → store derives via derivePendingApprovals() (session-logic.ts)
  → ChatView.tsx renders ComposerPendingApprovalPanel + ComposerPendingApprovalActions
  → user clicks Approve/Decline/Always Allow
  → ChatView.tsx onRespondToApproval() → api.orchestration.dispatchCommand()
```

**Key files:**

- Logic: `apps/web/src/session-logic.ts` → `derivePendingApprovals()`
- Panel: `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx`
- Actions: `apps/web/src/components/chat/ComposerPendingApprovalActions.tsx`

### Pending User Input

The model asks a structured question with numbered options (e.g., "Which approach?").

**Data flow:**

```
Provider emits user_input_requested activity with questions[]
  → store derives via derivePendingUserInputs() (session-logic.ts)
  → ChatView.tsx renders ComposerPendingUserInputPanel
  → user selects an option (keyboard 1-9) or types custom answer
  → ChatView.tsx onRespondToUserInput() → api.orchestration.dispatchCommand()
```

**Key files:**

- Logic: `apps/web/src/session-logic.ts` → `derivePendingUserInputs()`
- Panel: `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx`

### Proposed Plan

The model outputs a plan that appears as a timeline entry and in a sidebar.

**Data flow:**

```
Model outputs structured plan → server persists as ProposedPlan
  → store maps to "proposed-plan" timeline entry
  → MessagesTimeline.tsx renders ProposedPlanCard
  → PlanSidebar.tsx shows the active plan
  → ComposerPlanFollowUpBanner.tsx shows "PLAN READY" in composer
  → user can auto-implement (plan-accept mode) or provide custom follow-up
```

**Key files:**

- Card: `apps/web/src/components/chat/ProposedPlanCard.tsx`
- Sidebar: `apps/web/src/components/PlanSidebar.tsx`
- Banner: `apps/web/src/components/chat/ComposerPlanFollowUpBanner.tsx`
- Utilities: `apps/web/src/proposedPlan.ts`

## Component Hierarchy

```
ChatView.tsx
├── MessagesTimeline.tsx
│   ├── ChatMarkdown.tsx
│   │   ├── ProposeActionCard.tsx      (t3:propose-action)
│   │   └── ProposeCronJobCard.tsx     (t3:propose-cron)
│   └── ProposedPlanCard.tsx           (proposed-plan timeline entry)
├── PlanSidebar.tsx
└── Composer Footer
    ├── ComposerPendingApprovalPanel.tsx
    ├── ComposerPendingApprovalActions.tsx
    ├── ComposerPendingUserInputPanel.tsx
    └── ComposerPlanFollowUpBanner.tsx
```
