# Codex Plugin Skills

Notes from debugging a case where a Codex plugin was installed but its skills
were not visible in T3 Code provider sessions.

## Summary

T3 launches Codex with `codex app-server` and sets `CODEX_HOME` to the selected
Codex provider home. For the base provider this is usually `~/.codex`; T3
profile providers such as `codex:zbd` use separate homes such as `~/.codex-zbd`.

Codex CLI profiles are different from T3 provider homes. The Codex `-p` /
`--profile` flag layers `$CODEX_HOME/<profile>.config.toml` on top of
`$CODEX_HOME/config.toml`; it does not switch to `~/.codex-<profile>`.

During the Superpowers plugin investigation, `codex plugin list` showed
`superpowers@openai-curated` as installed and enabled in `~/.codex`, but
`codex debug prompt-input` still did not include the Superpowers skill names.
The plugin files existed under the Codex plugin cache, but the plugin install
path alone did not make those skills model-visible to `codex app-server`.

The working workaround was to expose the plugin's skill directories through the
documented user-skill location, `~/.agents/skills`.

## App-Server Discovery And Activation

T3 discovers Codex provider capabilities through the app-server JSON-RPC API:

- `plugin/list` returns installed and enabled plugin rows. These are useful as
  visible entries in the composer and, for app-backed plugins, as capability
  roots for new Codex threads.
- `skills/list` returns skill entries, including the documented `name` and
  `path` fields needed for explicit skill activation.

Discovery results are cached for 60 seconds per Codex provider, home, binary,
and project cwd. Concurrent callers share one in-flight app-server query, and
the web client refreshes on the same cadence. This keeps profile and
cwd-specific inventories isolated while avoiding a new short-lived
`codex app-server` process every few seconds.

Some remote connector plugins omit artwork from `plugin/list`. T3 falls back to
the newest Codex `cache/remote_plugin_catalog` entry, preferring its composer
icon and then its logo. If neither surface provides artwork, the UI uses the
generic plugin icon.

T3 supports two Codex activation paths.

### Visualize Skill And Inline Fragments

The bundled `visualize` skill writes HTML fragments under the active Codex home
at `<CODEX_HOME>/visualizations/YYYY/MM/DD/<native-thread-id>/` and emits a
`::codex-inline-vis{file="<basename>.html"}` directive. T3 resolves that
directive on the server when the Codex assistant message completes; the browser
never needs filesystem access. A safe basename is matched only within the
native thread directory, then the HTML is converted into the existing Dynamic
Chat UI marker and persisted in `metadata.dynamicChatUiArtifacts`.

Resolution is optional and bounded to 32 date directories, 8 directives, and a
2-second best-effort budget. A missing, stale, unreadable, or oversized valid
reference is replaced inline with `_Preview unavailable: visualization file was
removed._`; malformed, unsafe, or unrelated directives remain literal text.
Persisted HTML keeps an imported visualization available after the source file
is gone.
Existing threads with an unmaterialized directive are backfilled when thread
content is loaded. T3 uses the persisted Codex resume cursor for the native
thread id and does not start a provider session during backfill.
The existing sandboxed iframe supplies the native theme aliases and six
theme-derived visualization series for both light and dark themes. The native
`window.openai.sendFollowUpMessage` action is intentionally deferred until T3
defines a follow-up bridge through `window.t3ChatUi`.

Native Visualize fragments may import CORS-enabled resources from the skill's
documented CDN allowlist: `cdnjs.cloudflare.com`, `esm.sh`,
`cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com`,
and `fonts.bunny.net`. The iframe sandbox isolates the fragment from the parent
origin but does not disable network access. T3 does not currently enforce the
allowlist with a CSP or URL filter, so the browser can also load other origins
that permit the request through CORS.

For app-backed plugins such as Gmail, T3 reads the installed plugin root from
`plugin/list` or the local Codex plugin cache, then reads app connector ids from
the plugin's `.app.json`. T3 passes installed app-backed plugin roots to fresh
`thread/start` requests by default so connector-backed plugins behave like they
do in Codex. Selecting that plugin, or a skill contributed by that plugin, still
adds a visible composer chip but is not required for session-level connector
availability:

```json
{
  "environments": [{ "environmentId": "local", "cwd": "/repo" }],
  "selectedCapabilityRoots": [
    {
      "id": "gmail@openai-curated-remote",
      "location": {
        "type": "environment",
        "environmentId": "local",
        "path": "/.../.codex/plugins/cache/openai-curated-remote/gmail/0.1.5"
      }
    }
  ]
}
```

This is a session/thread-start capability, not a per-turn mutation. An explicit
plugin attachment therefore restarts an active T3 provider session before the
turn while preserving the persisted Codex resume cursor. Codex resumes the same
native thread in a fresh app-server process, allowing newly selected connector
tools to load without losing conversation context. A fresh native thread also
receives the selected roots on `thread/start`. Installing or enabling a plugin
outside the composer still requires a new or restarted provider session.

The server never trusts capability roots, connector ids, paths, names, or icon
URLs supplied by the browser. It rediscovers the selected `provider + kind + id`
against the active Codex profile and builds canonical session metadata from
that inventory. Discovery failure is non-fatal during ordinary startup, but an
explicit attachment fails validation rather than falling back to client paths.

Explicit attachments are persisted in the user message's
`metadata.providerCapabilities`. The sent-message bubble renders the plugin
icon and display name from that metadata, so reloads retain the same visible
intent cue that appeared in the composer.

For selected provider skills, T3 also uses the documented Codex app-server skill
input shape. A `turn/start` request should include both:

- a text input item whose text includes the `$<skill-name>` marker;
- a skill input item with the discovered skill name and path:

```json
{
  "type": "skill",
  "name": "skill-creator",
  "path": "/.../SKILL.md"
}
```

T3 wires only that explicit skill path. When a selected Codex skill capability
has both `name` and `path`, T3 prepends `$<skill-name>` to the first user text
input if the marker is not already present, then appends the `skill` input item.

Use the safe probe to inspect the current app-server surface without consuming
model usage:

```bash
bun run tsx scripts/probe-codex-capability-activation.ts
```

The probe initializes `codex app-server`, calls `plugin/list` and `skills/list`,
prints discovered skill entries with their paths, and prints the exact candidate
`turn/start` input shape T3 would send for the first skill with `name` and
`path`.

## Diagnosis Commands

Check which Codex home T3 app-server processes are using:

```bash
ps auxww | rg '[c]odex app-server'
/bin/ps eww -p <pid> | tr ' ' '\n' | rg 'CODEX_HOME|HOME='
```

Check plugin install state in the same Codex home:

```bash
CODEX_HOME="$HOME/.codex" codex plugin list --available --json
```

Check whether skills are actually present in the model-visible prompt:

```bash
CODEX_HOME="$HOME/.codex" codex debug prompt-input 'do you have Superpowers?' \
  > /tmp/codex-prompt.json

node - <<'NODE'
const fs = require("fs");
const prompt = fs.readFileSync("/tmp/codex-prompt.json", "utf8");
for (const term of [
  "using-superpowers",
  "test-driven-development",
  "systematic-debugging",
  "dispatching-parallel-agents",
]) {
  console.log(term, prompt.includes(term));
}
NODE
```

If `codex plugin list` reports the plugin installed, but `codex debug
prompt-input` does not include the expected skill names, the problem is below
T3's launch layer.

## Superpowers Workaround

Create symlinks from the installed plugin skill folders into the documented
user-skill directory:

```bash
mkdir -p "$HOME/.agents/skills"

for dir in "$HOME/.codex/plugins/cache/openai-curated/superpowers/"*/skills/*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  target="$HOME/.agents/skills/$name"
  if [ -e "$target" ] || [ -L "$target" ]; then
    printf 'skip existing %s\n' "$target"
  else
    ln -s "$dir" "$target"
    printf 'linked %s -> %s\n' "$target" "$dir"
  fi
done
```

Verify with `codex debug prompt-input` again. A successful verification includes
skill names such as:

- `using-superpowers`
- `test-driven-development`
- `systematic-debugging`
- `dispatching-parallel-agents`

After the prompt renderer sees the skill names, start a new T3 Codex thread or
restart the existing provider session. Existing app-server sessions may keep the
old prompt surface.

## Cleanup

The workaround is reversible. Remove the symlinks from `~/.agents/skills`:

```bash
rm "$HOME/.agents/skills/using-superpowers"
rm "$HOME/.agents/skills/test-driven-development"
rm "$HOME/.agents/skills/systematic-debugging"
```

Repeat for the other Superpowers skill symlinks as needed. Do not delete the
plugin cache unless intentionally uninstalling or reinstalling the plugin.

## References

- Codex environment variables: `CODEX_HOME` controls Codex state and config.
  <https://developers.openai.com/codex/environment-variables>
- Codex config reference: `--profile` layers profile config files inside the
  active `CODEX_HOME`.
  <https://developers.openai.com/codex/config-reference>
