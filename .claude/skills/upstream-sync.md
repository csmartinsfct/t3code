# upstream-sync

Sync the local fork with the upstream repository by cherry-picking new commits one at a time, resolving conflicts, and verifying each one builds cleanly.

## Context

This is a fork of `pingdotgg/t3code`. The upstream remote is configured as `upstream`. We cherry-pick commits rather than merging to keep our fork's commit history clean and allow us to skip or defer commits that conflict heavily with our local changes.

A cursor file at `.upstream-sync-cursor` tracks the last successfully processed upstream commit hash.

## Steps

### 1. Fetch upstream and determine pending commits

```bash
git fetch upstream
```

Read the cursor from `.upstream-sync-cursor` (a single commit hash on the first line). Then list commits between the cursor and `upstream/main`:

```bash
git log --oneline --reverse <cursor>..upstream/main
```

If no new commits, report "Already up to date" and stop.

### 2. Review the pending commits

Before applying anything, review what each commit touches:

```bash
git show --stat <commit>
```

Flag any commits that look risky (large diffs, touches many files, modifies core infrastructure). Report the full list to the user with your assessment.

### 3. Apply commits one at a time

For each pending commit, in order:

#### a. Cherry-pick

```bash
git cherry-pick <commit> --no-commit
```

#### b. If conflicts occur

Check the number of conflicted files:

```bash
git diff --name-only --diff-filter=U
```

**If more than 5 conflicted files**, or if the conflicts look complex and widespread:

- Abort: `git cherry-pick --abort`
- Report to the user: explain what the commit does, what conflicts arose, and why it needs manual attention
- **Stop processing further commits** — do not skip ahead

**If conflicts are manageable** (5 or fewer files):

- Read each conflicted file and resolve the conflicts
- Stage the resolved files: `git add <files>`

#### c. Verify the build

Run all three checks:

```bash
bun typecheck
bun lint
bun fmt
```

If any check fails:

- Try to fix the issue (type errors from merge, lint issues, etc.)
- If the fix is not obvious or requires significant changes, abort and report to the user

#### d. Commit

```bash
git commit -m "Cherry-pick: <original commit message>

Cherry-picked from <commit-hash>.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

#### e. Update the cursor

Write the commit hash to `.upstream-sync-cursor`:

```bash
echo "<commit-hash>" > .upstream-sync-cursor
```

#### f. Test the app (if changes are significant)

For commits that modify server code, UI components, or WebSocket logic:

1. Start the dev server using managed runs: call `launch_project_script` with the `web-dev` script
2. Wait for the Vite health check to report healthy
3. Use Chrome DevTools MCP to navigate to `http://localhost:5733` and verify the app loads without console errors
4. Stop the dev server when done

For minor changes (docs, tests only, deps), skip this step.

### 4. Report results

After processing all commits (or stopping early), provide a summary:

- How many commits were applied successfully
- Which commit (if any) caused a stop and why
- Current state of `.upstream-sync-cursor`
- Any follow-up actions needed

## Bail-out rules

Stop and inform the user when:

- A commit has more than 5 conflicted files
- Typecheck fails after conflict resolution and the fix isn't obvious
- A commit is very large (100+ lines of non-trivial changes across many files) and touches areas you're unsure about
- You've applied 5 commits in a row — pause and report progress before continuing (to avoid runaway changes)

## Important notes

- **NEVER** run `bun test` — always use `bun run test` if tests are needed
- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before committing
- The upstream remote is `upstream`, the fork remote is `origin`
- The main branch is `main`
- Cherry-pick commit messages should reference the original hash for traceability
