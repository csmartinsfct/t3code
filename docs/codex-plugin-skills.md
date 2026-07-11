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
  visible parent/grouping entries in the composer.
- `skills/list` returns skill entries, including the documented `name` and
  `path` fields needed for explicit skill activation.

The confirmed activation path for a selected provider skill is the documented
Codex app-server skill input shape. A `turn/start` request should include both:

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

Direct plugin activation is not confirmed or implemented. Selecting a plugin
row alone keeps the plugin visible in T3's structured draft state, but it does
not inject an unsupported app-server payload. To activate a bundled plugin
skill, select the specific skill row discovered from `skills/list`.

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
