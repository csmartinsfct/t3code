# Provider Capabilities Design

## Context

T3 Code currently exposes several agent affordances as separate concepts:

- file mentions through the composer `@` picker;
- local skill attachments through the composer Skills button;
- MCP server status and actions through the MCP button;
- provider-native plugin and skill systems only indirectly, if the provider loads them itself.

Codex and Claude both have plugin systems. A plugin can contain skills, MCP
servers, hooks, agents, assets, auth/install metadata, and provider-specific
runtime behavior. Some plugins, such as Superpowers, are mostly skill-oriented.
Others, such as Claude's Vercel plugin, include skills plus MCP and hook
components. The user-facing need is not "show every implementation type in a
separate toolbar"; it is "let me make the active agent use this capability."

## Goal

Introduce a provider-neutral capability model and surface provider-native
plugins and skills in the existing composer UI without increasing toolbar
footprint.

Users should be able to type `@sup`, see Superpowers, select it, and have T3
preserve the structured provider capability selection for the next message. The
same picker should also support provider plugin skills, local skill attachments,
and file mentions.

## Non-Goals

- Do not replace the existing MCP management UI in the first implementation.
- Do not collapse the Skills and MCP toolbar buttons into one Capabilities
  button yet.
- Do not model every plugin component type in the first implementation.
- Do not fake provider plugins by pasting raw `@plugin` text into the prompt.
- Do not attempt to make Claude and Codex use the same wire protocol.

## Design Principles

1. **One user concept, provider-specific execution.** T3 calls these
   "capabilities" in code and design, but each provider adapter preserves its
   own activation semantics.
2. **Activation is different from management.** The composer and `@` picker are
   activation surfaces. Install, login, enable, disable, and details remain
   management actions inside menus or provider-specific settings.
3. **No new toolbar section.** The existing Skills button can grow into a
   skills-and-plugin-capabilities browser. The `@` picker becomes the fast path.
4. **Structured identity, friendly label.** A chip may render as "Superpowers",
   but internally it carries `provider`, `kind`, `id`, and optional parent
   plugin metadata.
5. **Provider support is incremental.** Codex ships first because its app-server
   exposes the needed discovery methods. Claude follows as a second adapter.

## Capability Types

Initial capability kinds:

- `file`: existing filesystem mention inserted as a composer chip.
- `local-skill`: existing T3-discovered skill file. Selecting it attaches the
  skill content to the draft, as the Skills button does today.
- `provider-plugin`: provider-native plugin package, such as
  `superpowers@openai-curated-remote`.
- `provider-skill`: provider-native skill, usually contributed by a plugin,
  such as `superpowers:brainstorming`.

Future capability kinds:

- `provider-agent`
- `provider-mcp-server`
- `provider-hook`
- `provider-tool`

The UI should be ready to show these later, but the first implementation only
needs files, local skills, Codex plugins, and Codex plugin skills.

## Data Model

Add a provider-neutral capability entry shape in contracts:

```ts
type ProviderCapabilityKind = "plugin" | "skill" | "agent" | "mcp-server" | "hook" | "tool";

interface ProviderCapabilityEntry {
  id: string;
  provider: ProviderKind;
  kind: ProviderCapabilityKind;
  name: string;
  displayName: string;
  description?: string;
  source?: string;
  parentId?: string;
  parentDisplayName?: string;
  enabled: boolean;
  installed?: boolean;
  needsAuth?: boolean;
  iconPath?: string;
  iconUrl?: string;
}
```

Composer chips should use a smaller persistent shape:

```ts
interface ComposerCapabilitySelection {
  provider: ProviderKind;
  kind: ProviderCapabilityKind;
  id: string;
  displayName: string;
  parentId?: string;
  parentDisplayName?: string;
}
```

The persistent draft stores selections separately from plain prompt text so T3
can send structured metadata to the provider on submit.

For the first implementation, a composer capability selection is **next-turn
scoped**. Selecting a plugin or provider skill adds it to the current draft.
Sending the draft activates it for that submitted user message, then clears the
chip with the rest of the draft. T3 does not change the provider's global plugin
enablement state from this action.

## Discovery

### Codex

Codex discovery should call the running or probe `codex app-server` where
possible:

- `plugin/list` or `plugin/installed` for plugin rows;
- `skills/list` for provider-native skills;
- `plugin/read` and `plugin/skill/read` for details when the user opens a
  details/reveal action.

The first implementation can limit discovery to installed and enabled plugins
and skills.

Codex can report duplicate skill names when the same plugin exists through more
than one marketplace/cache source. T3 should dedupe provider skills by
`provider + parentDisplayName + displayName`, preferring the skill whose
marketplace/source matches an installed enabled plugin from `plugin/list`.

### Claude

Claude discovery should be adapter-backed, not UI-specific. The initial adapter
can use the Claude CLI plugin surface:

- `claude plugin list`
- `claude plugin details <name>`

If Claude later exposes a machine-readable SDK/API for plugin inventory, the
adapter can switch without changing the UI model.

### Local Skills

Existing `resolveSkills` behavior remains. Local skills continue to attach their
content to the draft. They should be normalized into the unified picker result
list but do not need to become provider-native capabilities.

### MCP Servers

Existing MCP status/actions remain separate in the first implementation. Later,
the MCP menu can feed `provider-mcp-server` entries into the same capability
list so the UI can converge without a second rewrite.

## Composer UI

### `@` Picker

The current file picker becomes a mixed capability picker. Results can include:

```text
Superpowers                         Plugin
Brainstorming                       Skill · Superpowers
Using Superpowers                   Skill · Superpowers
docs/codex-plugin-skills.md         File
```

Ranking:

1. exact prefix matches for plugin/skill names;
2. exact prefix matches for files;
3. fuzzy provider capability matches;
4. fuzzy file matches.

This keeps `@sup` focused on Superpowers while preserving file-heavy workflows
such as `@docs/`.

Selecting a row:

- `file`: insert existing file mention chip.
- `local-skill`: attach skill content and insert a skill chip.
- `provider-plugin`: insert provider plugin chip and persist selection.
- `provider-skill`: insert provider skill chip and persist selection.

### Skills Button

Keep the toolbar button. The menu should render local skills and provider
capabilities in sections:

```text
Local skills
  review
  deploy-checklist

Codex plugins
  Superpowers

Codex plugin skills
  Brainstorming
  Using Superpowers
```

The button label can remain "Skills" for now. A tooltip or menu header can say
"Skills and plugins" once provider capabilities are present.

### Chips

Capability chips should:

- be removable;
- show the provider or parent plugin in a tooltip/title;
- preserve structured identity;
- avoid expanding into raw prompt text while editing.

File chips keep the existing file icon behavior. Provider plugin/skill chips can
use plugin icons when available, otherwise a simple capability icon.

## Submission Semantics

When the user sends a message, T3 should build:

- the plain prompt text;
- file mentions and local skill attachments as it does today;
- provider capability selections as structured turn/session metadata.

For Codex, T3 should not rely on literal `@superpowers` text. The confirmed
app-server activation path is provider skill activation: a `turn/start` input
whose text contains `$<skill-name>` plus a `{ type: "skill", name, path }` input
item from `skills/list`. Direct plugin activation is not yet documented or
implemented, so plugin rows are visible parent/grouping selections and bundled
skill rows are the explicit activation path.

For Claude, activation should go through the Claude adapter's plugin/skill
mechanism rather than copying Codex's payload shape.

## Error And State Handling

Capability rows should expose clear disabled states:

- plugin installed but disabled;
- plugin available but not installed;
- capability needs login/auth;
- provider does not support capability activation in the current runtime;
- provider discovery failed.

The first implementation can render unsupported or unavailable capabilities as
disabled rows with a short label. Management actions can follow later.

## Implementation Phases

### Phase 1: Codex Vertical Slice

- Add provider capability contract and RPC.
- Add Codex capability discovery from `codex app-server`.
- Add provider plugin/skill rows to the `@` picker.
- Add provider plugin/skill rows to the Skills menu.
- Add composer capability chips and draft persistence.
- Wire Codex send behavior for selected skill capabilities; keep direct plugin
  activation unsupported until Codex exposes or documents a plugin activation
  payload.
- Add tests for discovery normalization, picker ranking, chip persistence, and
  turn payload construction.

### Phase 2: Claude Discovery

- Add a Claude capability adapter based on `claude plugin list/details`.
- Normalize Claude plugin and plugin-skill rows into the same UI model.
- Add tests using fixture CLI output.

### Phase 3: Capability Management

- Add install/enable/login/reveal actions where provider APIs support them.
- Show capability state badges consistently.
- Keep activation and management actions visually distinct.

### Phase 4: MCP Convergence

- Feed existing MCP status rows into the capability model.
- Decide whether to keep separate Skills/MCP toolbar buttons or collapse them
  into one Capabilities button.

## Open Questions

1. Codex activation payload: confirm the exact app-server message sequence used
   by Codex CLI/TUI after selecting a plugin or provider skill.
2. Naming: decide when to rename user-facing "Skills" to "Capabilities". The
   initial design keeps the toolbar label stable.

## Acceptance Criteria

- Typing `@sup` in a Codex thread shows Superpowers above unrelated file
  results.
- Selecting Superpowers inserts a removable plugin chip and does not paste raw
  plugin text into the prompt.
- Selecting a provider skill inserts a removable skill chip with its parent
  plugin visible in row metadata or tooltip.
- Existing file mentions still work.
- Existing local skill attachments still work.
- No new composer toolbar button is added.
- Capability selections survive draft persistence until removed or sent.
- Unsupported providers do not show broken provider capability rows.
