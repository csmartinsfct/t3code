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
