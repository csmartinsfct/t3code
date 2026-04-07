import nodePath from "node:path";

import {
  type CheckpointRef,
  OrchestrationGetTurnDiffResult,
  type GitDiscoveredRepo,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
  type RepoTurnDiff,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { RepoDiscovery } from "../../workspace/Services/RepoDiscovery.ts";
import { CheckpointInvariantError, CheckpointUnavailableError } from "../Errors.ts";
import { checkpointRefForThreadTurn } from "../Utils.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from "../Services/CheckpointDiffQuery.ts";

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult);

const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const checkpointStore = yield* CheckpointStore;
  const repoDiscovery = yield* RepoDiscovery;

  /** Compute a diff for a single repo cwd, returning empty string if refs are missing. */
  const diffSingleRepo = (
    cwd: string,
    fromCheckpointRef: CheckpointRef,
    toCheckpointRef: CheckpointRef,
  ) =>
    Effect.gen(function* () {
      const [fromExists, toExists] = yield* Effect.all(
        [
          checkpointStore.hasCheckpointRef({ cwd, checkpointRef: fromCheckpointRef }),
          checkpointStore.hasCheckpointRef({ cwd, checkpointRef: toCheckpointRef }),
        ],
        { concurrency: "unbounded" },
      );

      if (!fromExists || !toExists) return "";

      return yield* checkpointStore.diffCheckpoints({
        cwd,
        fromCheckpointRef,
        toCheckpointRef,
        fallbackFromToHead: false,
      });
    }).pipe(
      // If a repo fails to diff (e.g. not a git repo), return empty string
      Effect.catch(() => Effect.succeed("")),
    );

  const getTurnDiff: CheckpointDiffQueryShape["getTurnDiff"] = Effect.fn("getTurnDiff")(
    function* (input) {
      const operation = "CheckpointDiffQuery.getTurnDiff";

      if (input.fromTurnCount === input.toTurnCount) {
        const emptyDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff: "",
        };
        if (!isTurnDiffResult(emptyDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed turn diff result does not satisfy contract schema.",
          });
        }
        return emptyDiff;
      }

      const threadContext = yield* projectionSnapshotQuery.getThreadCheckpointContext(
        input.threadId,
      );
      if (Option.isNone(threadContext)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Thread '${input.threadId}' not found.`,
        });
      }

      const maxTurnCount = threadContext.value.checkpoints.reduce(
        (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
        0,
      );
      if (input.toTurnCount > maxTurnCount) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${maxTurnCount}.`,
        });
      }

      const fromCheckpointRef =
        input.fromTurnCount === 0
          ? checkpointRefForThreadTurn(input.threadId, 0)
          : threadContext.value.checkpoints.find(
              (checkpoint) => checkpoint.checkpointTurnCount === input.fromTurnCount,
            )?.checkpointRef;
      if (!fromCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.fromTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.fromTurnCount}.`,
        });
      }

      const toCheckpointRef = threadContext.value.checkpoints.find(
        (checkpoint) => checkpoint.checkpointTurnCount === input.toTurnCount,
      )?.checkpointRef;
      if (!toCheckpointRef) {
        return yield* new CheckpointUnavailableError({
          threadId: input.threadId,
          turnCount: input.toTurnCount,
          detail: `Checkpoint ref is unavailable for turn ${input.toTurnCount}.`,
        });
      }

      // Determine workspace cwds — multi-repo or single
      const workspaceRoot = threadContext.value.workspaceRoot;
      const worktreePath = threadContext.value.worktreePath;

      let repoCwds: string[];
      let discoveredRepos: ReadonlyArray<GitDiscoveredRepo> = [];

      if (worktreePath) {
        // Worktree threads are always single-repo
        repoCwds = [worktreePath];
      } else if (workspaceRoot) {
        discoveredRepos = yield* repoDiscovery
          .getRepos(workspaceRoot)
          .pipe(Effect.catch(() => Effect.succeed([] as readonly GitDiscoveredRepo[])));
        repoCwds = discoveredRepos.length > 0 ? discoveredRepos.map((r) => r.cwd) : [workspaceRoot];
      } else {
        return yield* new CheckpointInvariantError({
          operation,
          detail: `Workspace path missing for thread '${input.threadId}' when computing turn diff.`,
        });
      }

      // Single-cwd fast path (no repoDiffs overhead)
      if (repoCwds.length === 1) {
        const cwd = repoCwds[0]!;
        const [fromExists, toExists] = yield* Effect.all(
          [
            checkpointStore.hasCheckpointRef({ cwd, checkpointRef: fromCheckpointRef }),
            checkpointStore.hasCheckpointRef({ cwd, checkpointRef: toCheckpointRef }),
          ],
          { concurrency: "unbounded" },
        );

        if (!fromExists) {
          return yield* new CheckpointUnavailableError({
            threadId: input.threadId,
            turnCount: input.fromTurnCount,
            detail: `Filesystem checkpoint is unavailable for turn ${input.fromTurnCount}.`,
          });
        }
        if (!toExists) {
          return yield* new CheckpointUnavailableError({
            threadId: input.threadId,
            turnCount: input.toTurnCount,
            detail: `Filesystem checkpoint is unavailable for turn ${input.toTurnCount}.`,
          });
        }

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd,
          fromCheckpointRef,
          toCheckpointRef,
          fallbackFromToHead: false,
        });

        const turnDiff: OrchestrationGetTurnDiffResultType = {
          threadId: input.threadId,
          fromTurnCount: input.fromTurnCount,
          toTurnCount: input.toTurnCount,
          diff,
        };
        if (!isTurnDiffResult(turnDiff)) {
          return yield* new CheckpointInvariantError({
            operation,
            detail: "Computed turn diff result does not satisfy contract schema.",
          });
        }
        return turnDiff;
      }

      // Multi-repo path: diff each repo in parallel, aggregate results
      const perRepoDiffs = yield* Effect.forEach(
        repoCwds,
        (cwd) => diffSingleRepo(cwd, fromCheckpointRef, toCheckpointRef),
        { concurrency: 4 },
      );

      const repoDiffs: RepoTurnDiff[] = [];
      const allDiffParts: string[] = [];

      for (let i = 0; i < repoCwds.length; i++) {
        const diff = perRepoDiffs[i];
        const cwd = repoCwds[i]!;
        if (!diff) continue;

        allDiffParts.push(diff);

        const matchingRepo = discoveredRepos.find((r) => r.cwd === cwd);
        repoDiffs.push({
          repoRoot: cwd,
          relativePath: matchingRepo?.relativePath ?? nodePath.basename(cwd),
          label: matchingRepo?.label ?? nodePath.basename(cwd),
          diff,
        });
      }

      const turnDiff: OrchestrationGetTurnDiffResultType = {
        threadId: input.threadId,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        diff: allDiffParts.join("\n"),
        repoDiffs,
      };
      if (!isTurnDiffResult(turnDiff)) {
        return yield* new CheckpointInvariantError({
          operation,
          detail: "Computed turn diff result does not satisfy contract schema.",
        });
      }

      return turnDiff;
    },
  );

  const getFullThreadDiff: CheckpointDiffQueryShape["getFullThreadDiff"] = (
    input: OrchestrationGetFullThreadDiffInput,
  ) =>
    getTurnDiff({
      threadId: input.threadId,
      fromTurnCount: 0,
      toTurnCount: input.toTurnCount,
    }).pipe(Effect.map((result): OrchestrationGetFullThreadDiffResult => result));

  return {
    getTurnDiff,
    getFullThreadDiff,
  } satisfies CheckpointDiffQueryShape;
});

export const CheckpointDiffQueryLive = Layer.effect(CheckpointDiffQuery, make);
