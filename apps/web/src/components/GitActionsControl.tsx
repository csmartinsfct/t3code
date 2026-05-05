import type {
  GitActionProgressEvent,
  GitRunStackedActionResult,
  OverlayMenuItem,
  OverlayAnchorRect,
  GitStackedAction,
  GitStatusResult,
  ThreadId,
} from "@t3tools/contracts";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, CloudUploadIcon, GitCommitIcon, InfoIcon } from "lucide-react";
import { GitHubIcon } from "./Icons";
import {
  buildGitActionProgressStages,
  buildMenuItems,
  buildMultiRepoMenuItems,
  type GitActionIconName,
  type GitActionMenuItem,
  type GitQuickAction,
  type DefaultBranchConfirmableAction,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  resolveLiveThreadBranchUpdate,
  resolveMultiRepoQuickAction,
  resolveQuickAction,
  resolveThreadBranchUpdate,
} from "./GitActionsControl.logic";
import type { MultiRepoGitStatus } from "~/lib/multiRepoTypes";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { toastManager, type ThreadToastData } from "~/components/ui/toast";
import { openInPreferredEditor } from "~/editorPreferences";
import {
  gitInitMutationOptions,
  gitMutationKeys,
  gitPullMutationOptions,
  gitRunStackedActionMutationOptions,
  invalidateGitStatusQuery,
} from "~/lib/gitReactQuery";
import { newCommandId, randomUUID } from "~/lib/utils";
import { resolvePathLinkTarget } from "~/terminal-links";
import { readNativeApi } from "~/nativeApi";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import {
  OverlayRouteDialog,
  OverlayRoutePopover,
  OverlayRoutePopoverPopup,
  useRoutedOverlaySurface,
} from "~/routedOverlayAdapters";
import { useStore } from "~/store";

interface GitActionsControlProps {
  gitCwd: string | null;
  multiRepoStatus: MultiRepoGitStatus;
  activeThreadId: ThreadId | null;
}

interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  commitMessage?: string;
  onConfirmed?: () => void;
  filePaths?: string[];
}

type GitActionToastId = ReturnType<typeof toastManager.add>;

interface ActiveGitActionProgress {
  toastId: GitActionToastId;
  toastData: ThreadToastData | undefined;
  actionId: string;
  title: string;
  phaseStartedAtMs: number | null;
  hookStartedAtMs: number | null;
  hookName: string | null;
  lastOutputLine: string | null;
  currentPhaseLabel: string | null;
}

interface RunGitActionWithToastInput {
  action: GitStackedAction;
  commitMessage?: string;
  onConfirmed?: () => void;
  skipDefaultBranchPrompt?: boolean;
  statusOverride?: GitStatusResult | null;
  featureBranch?: boolean;
  progressToastId?: GitActionToastId;
  filePaths?: string[];
}

function formatElapsedDescription(startedAtMs: number | null): string | undefined {
  if (startedAtMs === null) {
    return undefined;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `Running for ${elapsedSeconds}s`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `Running for ${minutes}m ${seconds}s`;
}

function resolveProgressDescription(progress: ActiveGitActionProgress): string | undefined {
  if (progress.lastOutputLine) {
    return progress.lastOutputLine;
  }
  return formatElapsedDescription(progress.hookStartedAtMs ?? progress.phaseStartedAtMs);
}

function getMenuActionDisabledReason({
  item,
  gitStatus,
  isBusy,
  hasOriginRemote,
}: {
  item: GitActionMenuItem;
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  hasOriginRemote: boolean;
}): string | null {
  if (!item.disabled) return null;
  if (isBusy) return "Git action in progress.";
  if (!gitStatus) return "Git status is unavailable.";

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;

  if (item.id === "commit") {
    if (!hasChanges) {
      return "Worktree is clean. Make changes before committing.";
    }
    return "Commit is currently unavailable.";
  }

  if (item.id === "push") {
    if (!hasBranch) {
      return "Detached HEAD: checkout a branch before pushing.";
    }
    if (hasChanges) {
      return "Commit or stash local changes before pushing.";
    }
    if (isBehind) {
      return "Branch is behind upstream. Pull/rebase before pushing.";
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return 'Add an "origin" remote before pushing.';
    }
    if (!isAhead) {
      return "No local commits to push.";
    }
    return "Push is currently unavailable.";
  }

  if (hasOpenPr) {
    return "View PR is currently unavailable.";
  }
  if (!hasBranch) {
    return "Detached HEAD: checkout a branch before creating a PR.";
  }
  if (hasChanges) {
    return "Commit local changes before creating a PR.";
  }
  if (!gitStatus.hasUpstream && !hasOriginRemote) {
    return 'Add an "origin" remote before creating a PR.';
  }
  if (!isAhead) {
    return "No local commits to include in a PR.";
  }
  if (isBehind) {
    return "Branch is behind upstream. Pull/rebase before creating a PR.";
  }
  return "Create PR is currently unavailable.";
}

const COMMIT_DIALOG_TITLE = "Commit changes";
const COMMIT_DIALOG_DESCRIPTION =
  "Review and confirm your commit. Leave the message blank to auto-generate one.";
const GIT_COMMIT_OVERLAY_ROUTE_KEY = "git-commit-dialog";
const GIT_DEFAULT_BRANCH_OVERLAY_ROUTE_KEY = "git-default-branch-confirm";
const GIT_TOOLTIP_OVERLAY_ROUTE_KEY = "git-tooltip";
const ZERO_OVERLAY_ANCHOR: OverlayAnchorRect = { x: 0, y: 0, width: 0, height: 0 };

type GitCommitFile = GitStatusResult["workingTree"]["files"][number];

interface GitCommitDialogResult {
  commitMessage?: string | undefined;
  filePaths?: string[] | undefined;
  featureBranch?: boolean | undefined;
}

interface GitCommitDialogParams {
  branch: string | null;
  isDefaultBranch: boolean;
  files: readonly GitCommitFile[];
}

type GitDefaultBranchDialogResult = "abort" | "continue" | "feature-branch";

interface GitDefaultBranchDialogParams {
  title: string;
  description: string;
  continueLabel: string;
}

function GitActionItemIcon({ icon }: { icon: GitActionIconName }) {
  if (icon === "commit") return <GitCommitIcon />;
  if (icon === "push") return <CloudUploadIcon />;
  return <GitHubIcon />;
}

function gitActionOverlayIcon(icon: GitActionIconName): string {
  if (icon === "commit") return "GitCommit";
  if (icon === "push") return "CloudUpload";
  return "Github";
}

function GitQuickActionIcon({ quickAction }: { quickAction: GitQuickAction }) {
  const iconClassName = "size-3.5";
  if (quickAction.kind === "open_pr") return <GitHubIcon className={iconClassName} />;
  if (quickAction.kind === "run_pull") return <InfoIcon className={iconClassName} />;
  if (quickAction.kind === "run_action") {
    if (quickAction.action === "commit") return <GitCommitIcon className={iconClassName} />;
    if (quickAction.action === "push" || quickAction.action === "commit_push") {
      return <CloudUploadIcon className={iconClassName} />;
    }
    return <GitHubIcon className={iconClassName} />;
  }
  if (quickAction.label === "Commit") return <GitCommitIcon className={iconClassName} />;
  return <InfoIcon className={iconClassName} />;
}

function GitCommitDialogContent({
  branch,
  files,
  isDefaultBranch,
  onOpenChange,
  onOpenFile,
  onSubmit,
}: GitCommitDialogParams & {
  onOpenChange: (open: boolean) => void;
  onOpenFile: (filePath: string) => void;
  onSubmit: (result: GitCommitDialogResult) => void;
}) {
  const [commitMessage, setCommitMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set());
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const selectedFiles = files.filter((f) => !excludedFiles.has(f.path));
  const allSelected = excludedFiles.size === 0;
  const noneSelected = selectedFiles.length === 0;

  const submit = (featureBranch: boolean) => {
    const trimmedMessage = commitMessage.trim();
    onSubmit({
      ...(trimmedMessage ? { commitMessage: trimmedMessage } : {}),
      ...(!allSelected ? { filePaths: selectedFiles.map((file) => file.path) } : {}),
      ...(featureBranch ? { featureBranch: true } : {}),
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{COMMIT_DIALOG_TITLE}</DialogTitle>
        <DialogDescription>{COMMIT_DIALOG_DESCRIPTION}</DialogDescription>
      </DialogHeader>
      <DialogPanel className="space-y-4">
        <div className="space-y-3 rounded-lg border border-input bg-muted/40 p-3 text-xs">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">Branch</span>
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">{branch ?? "(detached HEAD)"}</span>
              {isDefaultBranch && (
                <span className="text-right text-warning text-xs">Warning: default branch</span>
              )}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isEditingFiles && files.length > 0 && (
                  <Checkbox
                    checked={allSelected}
                    indeterminate={!allSelected && !noneSelected}
                    onCheckedChange={() => {
                      setExcludedFiles(
                        allSelected ? new Set(files.map((file) => file.path)) : new Set(),
                      );
                    }}
                  />
                )}
                <span className="text-muted-foreground">Files</span>
                {!allSelected && !isEditingFiles && (
                  <span className="text-muted-foreground">
                    ({selectedFiles.length} of {files.length})
                  </span>
                )}
              </div>
              {files.length > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setIsEditingFiles((prev) => !prev)}
                >
                  {isEditingFiles ? "Done" : "Edit"}
                </Button>
              )}
            </div>
            {files.length === 0 ? (
              <p className="font-medium">none</p>
            ) : (
              <div className="space-y-2">
                <ScrollArea className="h-44 rounded-md border border-input bg-background">
                  <div className="space-y-1 p-1">
                    {files.map((file) => {
                      const isExcluded = excludedFiles.has(file.path);
                      return (
                        <div
                          key={file.path}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-accent/50"
                        >
                          {isEditingFiles && (
                            <Checkbox
                              checked={!excludedFiles.has(file.path)}
                              onCheckedChange={() => {
                                setExcludedFiles((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(file.path)) {
                                    next.delete(file.path);
                                  } else {
                                    next.add(file.path);
                                  }
                                  return next;
                                });
                              }}
                            />
                          )}
                          <button
                            type="button"
                            className="flex flex-1 items-center justify-between gap-3 text-left truncate"
                            onClick={() => onOpenFile(file.path)}
                          >
                            <span
                              className={`truncate${isExcluded ? " text-muted-foreground" : ""}`}
                            >
                              {file.path}
                            </span>
                            <span className="shrink-0">
                              {isExcluded ? (
                                <span className="text-muted-foreground">Excluded</span>
                              ) : (
                                <>
                                  <span className="text-success">+{file.insertions}</span>
                                  <span className="text-muted-foreground"> / </span>
                                  <span className="text-destructive">-{file.deletions}</span>
                                </>
                              )}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
                <div className="flex justify-end font-mono">
                  <span className="text-success">
                    +{selectedFiles.reduce((sum, file) => sum + file.insertions, 0)}
                  </span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-destructive">
                    -{selectedFiles.reduce((sum, file) => sum + file.deletions, 0)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium">Commit message (optional)</p>
          <Textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Leave empty to auto-generate"
            size="sm"
          />
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="outline" size="sm" disabled={noneSelected} onClick={() => submit(true)}>
          Commit on new branch
        </Button>
        <Button size="sm" disabled={noneSelected} onClick={() => submit(false)}>
          Commit
        </Button>
      </DialogFooter>
    </>
  );
}

function GitCommitDialog({
  open,
  onOpenChange,
  ...contentProps
}: GitCommitDialogParams & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (filePath: string) => void;
  onSubmit: (result: GitCommitDialogResult) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <GitCommitDialogContent onOpenChange={onOpenChange} {...contentProps} />
      </DialogPopup>
    </Dialog>
  );
}

function GitDefaultBranchDialogContent({
  continueLabel,
  description,
  onOpenChange,
  onSubmit,
  title,
}: GitDefaultBranchDialogParams & {
  onOpenChange: (open: boolean) => void;
  onSubmit: (result: GitDefaultBranchDialogResult) => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onSubmit("abort");
            onOpenChange(false);
          }}
        >
          Abort
        </Button>
        <Button variant="outline" size="sm" onClick={() => onSubmit("continue")}>
          {continueLabel}
        </Button>
        <Button size="sm" onClick={() => onSubmit("feature-branch")}>
          Checkout feature branch & continue
        </Button>
      </DialogFooter>
    </>
  );
}

function GitDefaultBranchDialog({
  open,
  onOpenChange,
  ...contentProps
}: GitDefaultBranchDialogParams & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (result: GitDefaultBranchDialogResult) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <GitDefaultBranchDialogContent onOpenChange={onOpenChange} {...contentProps} />
      </DialogPopup>
    </Dialog>
  );
}

function rectForElement(element: HTMLElement | null): OverlayAnchorRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

export default function GitActionsControl({
  gitCwd,
  multiRepoStatus,
  activeThreadId,
}: GitActionsControlProps) {
  const threadToastData = useMemo(
    () => (activeThreadId ? { threadId: activeThreadId } : undefined),
    [activeThreadId],
  );
  const activeServerThread = useStore((store) =>
    activeThreadId ? store.threadsById[activeThreadId] : undefined,
  );
  const setThreadBranch = useStore((store) => store.setThreadBranch);
  const queryClient = useQueryClient();
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null);
  const quickActionDisabledButtonRef = useRef<HTMLButtonElement | null>(null);
  const [quickActionTooltipOpen, setQuickActionTooltipOpen] = useState(false);
  const [quickActionTooltipAnchor, setQuickActionTooltipAnchor] =
    useState<OverlayAnchorRect | null>(null);
  const activeGitActionProgressRef = useRef<ActiveGitActionProgress | null>(null);
  let runGitActionWithToast: (input: RunGitActionWithToastInput) => Promise<void>;

  const updateActiveProgressToast = useCallback(() => {
    const progress = activeGitActionProgressRef.current;
    if (!progress) {
      return;
    }
    toastManager.update(progress.toastId, {
      type: "loading",
      title: progress.title,
      description: resolveProgressDescription(progress),
      timeout: 0,
      data: progress.toastData,
    });
  }, []);

  const persistThreadBranchSync = useCallback(
    (branch: string | null) => {
      if (!activeThreadId || !activeServerThread || activeServerThread.branch === branch) {
        return;
      }

      const worktreePath = activeServerThread.worktreePath;
      const api = readNativeApi();
      if (api) {
        void api.orchestration
          .dispatchCommand({
            type: "thread.meta.update",
            commandId: newCommandId(),
            threadId: activeThreadId,
            branch,
            worktreePath,
          })
          .catch(() => undefined);
      }

      setThreadBranch(activeThreadId, branch, worktreePath);
    },
    [activeServerThread, activeThreadId, setThreadBranch],
  );

  const syncThreadBranchAfterGitAction = useCallback(
    (result: GitRunStackedActionResult) => {
      const branchUpdate = resolveThreadBranchUpdate(result);
      if (!branchUpdate) {
        return;
      }

      persistThreadBranchSync(branchUpdate.branch);
    },
    [persistThreadBranchSync],
  );

  const { repos, statusByRepoCwd } = multiRepoStatus;
  const isMultiRepo = repos.length > 1;
  // For single-repo, use the first repo's status; for no repos, fallback to query
  const gitStatus = isMultiRepo
    ? null
    : repos.length === 1
      ? (statusByRepoCwd.get(repos[0]!.cwd) ?? null)
      : null;
  // Default to true while loading so we don't flash init controls.
  const isRepo = multiRepoStatus.isLoading ? true : multiRepoStatus.hasAnyRepo;
  const hasOriginRemote = gitStatus?.hasOriginRemote ?? false;
  const gitStatusForActions = gitStatus;

  const allFiles = gitStatusForActions?.workingTree.files ?? [];

  const initMutation = useMutation(gitInitMutationOptions({ cwd: gitCwd, queryClient }));

  const runImmediateGitActionMutation = useMutation(
    gitRunStackedActionMutationOptions({
      cwd: gitCwd,
      queryClient,
    }),
  );
  const pullMutation = useMutation(gitPullMutationOptions({ cwd: gitCwd, queryClient }));

  const isRunStackedActionRunning =
    useIsMutating({ mutationKey: gitMutationKeys.runStackedAction(gitCwd) }) > 0;
  const isPullRunning = useIsMutating({ mutationKey: gitMutationKeys.pull(gitCwd) }) > 0;
  const isGitActionRunning = isRunStackedActionRunning || isPullRunning;

  useEffect(() => {
    if (isGitActionRunning) {
      return;
    }

    const branchUpdate = resolveLiveThreadBranchUpdate({
      threadBranch: activeServerThread?.branch ?? null,
      gitStatus: gitStatusForActions,
    });
    if (!branchUpdate) {
      return;
    }

    persistThreadBranchSync(branchUpdate.branch);
  }, [
    activeServerThread?.branch,
    gitStatusForActions,
    isGitActionRunning,
    persistThreadBranchSync,
  ]);

  const isDefaultBranch = useMemo(() => {
    return gitStatusForActions?.isDefaultBranch ?? false;
  }, [gitStatusForActions?.isDefaultBranch]);

  const multiRepoMenu = useMemo(
    () =>
      isMultiRepo ? buildMultiRepoMenuItems(repos, statusByRepoCwd, isGitActionRunning) : null,
    [isMultiRepo, repos, statusByRepoCwd, isGitActionRunning],
  );
  const gitActionMenuItems = useMemo(
    () =>
      isMultiRepo
        ? (multiRepoMenu?.bulkItems ?? [])
        : buildMenuItems(gitStatusForActions, isGitActionRunning, hasOriginRemote),
    [isMultiRepo, multiRepoMenu, gitStatusForActions, hasOriginRemote, isGitActionRunning],
  );
  const quickAction = useMemo(
    () =>
      isMultiRepo
        ? resolveMultiRepoQuickAction(repos, statusByRepoCwd, isGitActionRunning)
        : resolveQuickAction(
            gitStatusForActions,
            isGitActionRunning,
            isDefaultBranch,
            hasOriginRemote,
          ),
    [
      isMultiRepo,
      repos,
      statusByRepoCwd,
      gitStatusForActions,
      hasOriginRemote,
      isDefaultBranch,
      isGitActionRunning,
    ],
  );
  const quickActionDisabledReason = quickAction.disabled
    ? (quickAction.hint ?? "This action is currently unavailable.")
    : null;
  const pendingDefaultBranchActionCopy = pendingDefaultBranchAction
    ? resolveDefaultBranchActionDialogCopy({
        action: pendingDefaultBranchAction.action,
        branchName: pendingDefaultBranchAction.branchName,
        includesCommit: pendingDefaultBranchAction.includesCommit,
      })
    : null;

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!activeGitActionProgressRef.current) {
        return;
      }
      updateActiveProgressToast();
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [updateActiveProgressToast]);

  const openExistingPr = useCallback(async () => {
    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
        data: threadToastData,
      });
      return;
    }
    const prUrl = gitStatusForActions?.pr?.state === "open" ? gitStatusForActions.pr.url : null;
    if (!prUrl) {
      toastManager.add({
        type: "error",
        title: "No open PR found.",
        data: threadToastData,
      });
      return;
    }
    void api.shell.openExternal(prUrl).catch((err) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: err instanceof Error ? err.message : "An error occurred.",
        data: threadToastData,
      });
    });
  }, [gitStatusForActions, threadToastData]);

  runGitActionWithToast = useEffectEvent(
    async ({
      action,
      commitMessage,
      onConfirmed,
      skipDefaultBranchPrompt = false,
      statusOverride,
      featureBranch = false,
      progressToastId,
      filePaths,
    }: RunGitActionWithToastInput) => {
      const actionStatus = statusOverride ?? gitStatusForActions;
      const actionBranch = actionStatus?.branch ?? null;
      const actionIsDefaultBranch = featureBranch ? false : isDefaultBranch;
      const actionCanCommit =
        action === "commit" || action === "commit_push" || action === "commit_push_pr";
      const includesCommit =
        actionCanCommit &&
        (action === "commit" || !!actionStatus?.hasWorkingTreeChanges || featureBranch);
      if (
        !skipDefaultBranchPrompt &&
        requiresDefaultBranchConfirmation(action, actionIsDefaultBranch) &&
        actionBranch
      ) {
        if (
          action !== "push" &&
          action !== "create_pr" &&
          action !== "commit_push" &&
          action !== "commit_push_pr"
        ) {
          return;
        }
        setPendingDefaultBranchAction({
          action,
          branchName: actionBranch,
          includesCommit,
          ...(commitMessage ? { commitMessage } : {}),
          ...(onConfirmed ? { onConfirmed } : {}),
          ...(filePaths ? { filePaths } : {}),
        });
        return;
      }
      onConfirmed?.();

      const progressStages = buildGitActionProgressStages({
        action,
        hasCustomCommitMessage: !!commitMessage?.trim(),
        hasWorkingTreeChanges: !!actionStatus?.hasWorkingTreeChanges,
        featureBranch,
        shouldPushBeforePr:
          action === "create_pr" &&
          (!actionStatus?.hasUpstream || (actionStatus?.aheadCount ?? 0) > 0),
      });
      const scopedToastData = threadToastData ? { ...threadToastData } : undefined;
      const actionId = randomUUID();
      const resolvedProgressToastId =
        progressToastId ??
        toastManager.add({
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: scopedToastData,
        });

      activeGitActionProgressRef.current = {
        toastId: resolvedProgressToastId,
        toastData: scopedToastData,
        actionId,
        title: progressStages[0] ?? "Running git action...",
        phaseStartedAtMs: null,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
        currentPhaseLabel: progressStages[0] ?? "Running git action...",
      };

      if (progressToastId) {
        toastManager.update(progressToastId, {
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: scopedToastData,
        });
      }

      const applyProgressEvent = (event: GitActionProgressEvent) => {
        const progress = activeGitActionProgressRef.current;
        if (!progress) {
          return;
        }
        if (gitCwd && event.cwd !== gitCwd) {
          return;
        }
        if (progress.actionId !== event.actionId) {
          return;
        }

        const now = Date.now();
        switch (event.kind) {
          case "action_started":
            progress.phaseStartedAtMs = now;
            progress.hookStartedAtMs = null;
            progress.hookName = null;
            progress.lastOutputLine = null;
            break;
          case "phase_started":
            progress.title = event.label;
            progress.currentPhaseLabel = event.label;
            progress.phaseStartedAtMs = now;
            progress.hookStartedAtMs = null;
            progress.hookName = null;
            progress.lastOutputLine = null;
            break;
          case "hook_started":
            progress.title = `Running ${event.hookName}...`;
            progress.hookName = event.hookName;
            progress.hookStartedAtMs = now;
            progress.lastOutputLine = null;
            break;
          case "hook_output":
            progress.lastOutputLine = event.text;
            break;
          case "hook_finished":
            progress.title = progress.currentPhaseLabel ?? "Committing...";
            progress.hookName = null;
            progress.hookStartedAtMs = null;
            progress.lastOutputLine = null;
            break;
          case "action_finished":
            // Let the resolved mutation update the toast so we keep the
            // elapsed description visible until the final success state renders.
            return;
          case "action_failed":
            // Let the rejected mutation publish the error toast to avoid a
            // transient intermediate state before the final failure message.
            return;
        }

        updateActiveProgressToast();
      };

      const promise = runImmediateGitActionMutation.mutateAsync({
        actionId,
        action,
        ...(commitMessage ? { commitMessage } : {}),
        ...(featureBranch ? { featureBranch } : {}),
        ...(filePaths ? { filePaths } : {}),
        onProgress: applyProgressEvent,
      });

      try {
        const result = await promise;
        activeGitActionProgressRef.current = null;
        syncThreadBranchAfterGitAction(result);
        const closeResultToast = () => {
          toastManager.close(resolvedProgressToastId);
        };

        const toastCta = result.toast.cta;
        let toastActionProps: {
          children: string;
          onClick: () => void;
        } | null = null;
        if (toastCta.kind === "run_action") {
          toastActionProps = {
            children: toastCta.label,
            onClick: () => {
              closeResultToast();
              void runGitActionWithToast({
                action: toastCta.action.kind,
              });
            },
          };
        } else if (toastCta.kind === "open_pr") {
          toastActionProps = {
            children: toastCta.label,
            onClick: () => {
              const api = readNativeApi();
              if (!api) return;
              closeResultToast();
              void api.shell.openExternal(toastCta.url);
            },
          };
        }

        const successToastBase = {
          type: "success",
          title: result.toast.title,
          description: result.toast.description,
          timeout: 0,
          data: {
            ...scopedToastData,
            dismissAfterVisibleMs: 10_000,
          },
        } as const;

        if (toastActionProps) {
          toastManager.update(resolvedProgressToastId, {
            ...successToastBase,
            actionProps: toastActionProps,
          });
        } else {
          toastManager.update(resolvedProgressToastId, successToastBase);
        }
      } catch (err) {
        activeGitActionProgressRef.current = null;
        toastManager.update(resolvedProgressToastId, {
          type: "error",
          title: "Action failed",
          description: err instanceof Error ? err.message : "An error occurred.",
          data: scopedToastData,
        });
      }
    },
  );

  const continuePendingDefaultBranchAction = useCallback(() => {
    if (!pendingDefaultBranchAction) return;
    const { action, commitMessage, onConfirmed, filePaths } = pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(commitMessage ? { commitMessage } : {}),
      ...(onConfirmed ? { onConfirmed } : {}),
      ...(filePaths ? { filePaths } : {}),
      skipDefaultBranchPrompt: true,
    });
  }, [pendingDefaultBranchAction, runGitActionWithToast]);

  const checkoutFeatureBranchAndContinuePendingAction = useCallback(() => {
    if (!pendingDefaultBranchAction) return;
    const { action, commitMessage, onConfirmed, filePaths } = pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(commitMessage ? { commitMessage } : {}),
      ...(onConfirmed ? { onConfirmed } : {}),
      ...(filePaths ? { filePaths } : {}),
      featureBranch: true,
      skipDefaultBranchPrompt: true,
    });
  }, [pendingDefaultBranchAction, runGitActionWithToast]);

  const runQuickAction = () => {
    if (quickAction.kind === "open_pr") {
      void openExistingPr();
      return;
    }
    if (quickAction.kind === "run_pull") {
      const promise = pullMutation.mutateAsync();
      toastManager.promise(promise, {
        loading: { title: "Pulling...", data: threadToastData },
        success: (result) => ({
          title: result.status === "pulled" ? "Pulled" : "Already up to date",
          description:
            result.status === "pulled"
              ? `Updated ${result.branch} from ${result.upstreamBranch ?? "upstream"}`
              : `${result.branch} is already synchronized.`,
          data: threadToastData,
        }),
        error: (err) => ({
          title: "Pull failed",
          description: err instanceof Error ? err.message : "An error occurred.",
          data: threadToastData,
        }),
      });
      void promise.catch(() => undefined);
      return;
    }
    if (quickAction.kind === "show_hint") {
      toastManager.add({
        type: "info",
        title: quickAction.label,
        description: quickAction.hint,
        data: threadToastData,
      });
      return;
    }
    if (quickAction.action) {
      void runGitActionWithToast({ action: quickAction.action });
    }
  };

  const openDialogForMenuItem = useCallback(
    (item: GitActionMenuItem) => {
      if (item.disabled) return;
      if (item.kind === "open_pr") {
        void openExistingPr();
        return;
      }
      if (item.dialogAction === "push") {
        void runGitActionWithToast({ action: "push" });
        return;
      }
      if (item.dialogAction === "create_pr") {
        void runGitActionWithToast({ action: "create_pr" });
        return;
      }
      setIsCommitDialogOpen(true);
    },
    [openExistingPr, runGitActionWithToast],
  );

  const openChangedFileInEditor = useCallback(
    (filePath: string) => {
      const api = readNativeApi();
      if (!api || !gitCwd) {
        toastManager.add({
          type: "error",
          title: "Editor opening is unavailable.",
          data: threadToastData,
        });
        return;
      }
      const target = resolvePathLinkTarget(filePath, gitCwd);
      void openInPreferredEditor(api, target).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Unable to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
          data: threadToastData,
        });
      });
    },
    [gitCwd, threadToastData],
  );

  const runCommitDialogResult = useCallback(
    (result: GitCommitDialogResult) => {
      void runGitActionWithToast({
        action: "commit",
        ...(result.commitMessage ? { commitMessage: result.commitMessage } : {}),
        ...(result.filePaths ? { filePaths: result.filePaths } : {}),
        ...(result.featureBranch ? { featureBranch: true, skipDefaultBranchPrompt: true } : {}),
      });
    },
    [runGitActionWithToast],
  );

  const handleDefaultBranchDialogResult = useCallback(
    (result: GitDefaultBranchDialogResult) => {
      if (result === "abort") {
        setPendingDefaultBranchAction(null);
        return;
      }
      if (result === "feature-branch") {
        checkoutFeatureBranchAndContinuePendingAction();
        return;
      }
      continuePendingDefaultBranchAction();
    },
    [checkoutFeatureBranchAndContinuePendingAction, continuePendingDefaultBranchAction],
  );

  const commitDialogRoute = useRoutedOverlaySurface<GitCommitDialogResult>({
    open: isCommitDialogOpen,
    onOpenChange: setIsCommitDialogOpen,
    routeKey: GIT_COMMIT_OVERLAY_ROUTE_KEY,
    params: {
      branch: gitStatusForActions?.branch ?? null,
      files: allFiles,
      isDefaultBranch,
    },
    ...(gitCwd ? { context: { cwd: gitCwd } } : {}),
    presentation: { kind: "dialog" },
    onResult: runCommitDialogResult,
  });

  const defaultBranchDialogParams: GitDefaultBranchDialogParams = {
    title: pendingDefaultBranchActionCopy?.title ?? "Run action on default branch?",
    description: pendingDefaultBranchActionCopy?.description ?? "",
    continueLabel: pendingDefaultBranchActionCopy?.continueLabel ?? "Continue",
  };

  const defaultBranchDialogRoute = useRoutedOverlaySurface<GitDefaultBranchDialogResult>({
    open: pendingDefaultBranchAction !== null,
    onOpenChange: (open) => {
      if (!open) setPendingDefaultBranchAction(null);
    },
    routeKey: GIT_DEFAULT_BRANCH_OVERLAY_ROUTE_KEY,
    params: { ...defaultBranchDialogParams },
    presentation: { kind: "dialog" },
    onResult: handleDefaultBranchDialogResult,
  });

  const updateQuickActionTooltipAnchor = useCallback(() => {
    setQuickActionTooltipAnchor(rectForElement(quickActionDisabledButtonRef.current));
  }, []);

  const quickActionTooltipRoute = useRoutedOverlaySurface<void>({
    open: Boolean(quickActionDisabledReason && quickActionTooltipOpen && quickActionTooltipAnchor),
    onOpenChange: setQuickActionTooltipOpen,
    routeKey: GIT_TOOLTIP_OVERLAY_ROUTE_KEY,
    params: { text: quickActionDisabledReason ?? "" },
    presentation: {
      kind: "popover",
      anchor: quickActionTooltipAnchor ?? ZERO_OVERLAY_ANCHOR,
      side: "bottom",
      align: "start",
    },
    enabled: quickActionTooltipAnchor !== null,
  });

  const gitOverlayItems = useMemo<OverlayMenuItem[]>(() => {
    const items: OverlayMenuItem[] = gitActionMenuItems.map((item) => {
      const disabledReason = getMenuActionDisabledReason({
        item,
        gitStatus: gitStatusForActions,
        isBusy: isGitActionRunning,
        hasOriginRemote,
      });
      return {
        id: `single:${item.id}`,
        label: item.label,
        icon: gitActionOverlayIcon(item.icon),
        disabled: item.disabled,
        ...(disabledReason ? { description: disabledReason } : {}),
      };
    });

    if (!isMultiRepo && gitStatusForActions?.branch === null) {
      items.push({
        id: "hint:detached-head",
        label: "Detached HEAD: create and checkout a branch to enable push and PR actions.",
        labelOnly: true,
      });
    }

    if (
      !isMultiRepo &&
      gitStatusForActions &&
      gitStatusForActions.branch !== null &&
      !gitStatusForActions.hasWorkingTreeChanges &&
      gitStatusForActions.behindCount > 0 &&
      gitStatusForActions.aheadCount === 0
    ) {
      items.push({
        id: "hint:behind-upstream",
        label: "Behind upstream. Pull/rebase first.",
        labelOnly: true,
      });
    }

    if (isMultiRepo && multiRepoMenu && multiRepoMenu.repoSections.length > 0) {
      items.push({ id: "separator:repos", label: "", separator: true });
      multiRepoMenu.repoSections.forEach((section, sectionIndex) => {
        const repoStatus = statusByRepoCwd.get(section.repo.cwd) ?? null;
        items.push({
          id: `repo-label:${sectionIndex}`,
          label: section.repo.label,
          labelOnly: true,
          ...(repoStatus?.hasWorkingTreeChanges ? { badge: "changes" } : {}),
        });
        section.items.forEach((item) => {
          items.push({
            id: `repo:${sectionIndex}:${item.id}`,
            label: item.label,
            icon: gitActionOverlayIcon(item.icon),
            iconClassName: "size-4",
            disabled: item.disabled,
          });
        });
      });
    }

    return items;
  }, [
    gitActionMenuItems,
    gitStatusForActions,
    hasOriginRemote,
    isGitActionRunning,
    isMultiRepo,
    multiRepoMenu,
    statusByRepoCwd,
  ]);

  const handleGitOverlaySelect = useCallback(
    (id: string) => {
      if (id.startsWith("single:")) {
        const item = gitActionMenuItems.find((entry) => entry.id === id.slice("single:".length));
        if (item) openDialogForMenuItem(item);
        return;
      }
      if (id.startsWith("repo:") && multiRepoMenu) {
        const [, sectionIndexText, itemId] = id.split(":");
        const sectionIndex = Number(sectionIndexText);
        const item = Number.isInteger(sectionIndex)
          ? multiRepoMenu.repoSections[sectionIndex]?.items.find((entry) => entry.id === itemId)
          : undefined;
        if (item) openDialogForMenuItem(item);
      }
    },
    [gitActionMenuItems, multiRepoMenu, openDialogForMenuItem],
  );

  if (!gitCwd) return null;

  return (
    <>
      {!isRepo ? (
        <Button
          variant="outline"
          size="xs"
          disabled={initMutation.isPending}
          onClick={() => initMutation.mutate()}
        >
          {initMutation.isPending ? "Initializing..." : "Initialize Git"}
        </Button>
      ) : (
        <Group aria-label="Git actions" className="shrink-0">
          {quickActionDisabledReason ? (
            <Popover
              open={quickActionTooltipRoute.domOpen}
              onOpenChange={(open) => {
                if (open) updateQuickActionTooltipAnchor();
                quickActionTooltipRoute.onDomOpenChange(open);
              }}
            >
              <PopoverTrigger
                openOnHover
                render={
                  <Button
                    aria-disabled="true"
                    className="cursor-not-allowed rounded-e-none border-e-0 opacity-64 before:rounded-e-none"
                    onFocusCapture={updateQuickActionTooltipAnchor}
                    onMouseOverCapture={updateQuickActionTooltipAnchor}
                    ref={quickActionDisabledButtonRef}
                    size="xs"
                    variant="outline"
                  />
                }
              >
                <GitQuickActionIcon quickAction={quickAction} />
                <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                  {quickAction.label}
                </span>
              </PopoverTrigger>
              <PopoverPopup tooltipStyle side="bottom" align="start">
                {quickActionDisabledReason}
              </PopoverPopup>
            </Popover>
          ) : (
            <Button
              variant="outline"
              size="xs"
              disabled={isGitActionRunning || quickAction.disabled}
              onClick={runQuickAction}
            >
              <GitQuickActionIcon quickAction={quickAction} />
              <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                {quickAction.label}
              </span>
            </Button>
          )}
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu
            overlayItems={gitOverlayItems}
            overlayMenuAlign="end"
            overlayOnSelect={handleGitOverlaySelect}
            onOpenChange={(open) => {
              if (open) void invalidateGitStatusQuery(queryClient, gitCwd);
            }}
          >
            <MenuTrigger
              render={<Button aria-label="Git action options" size="icon-xs" variant="outline" />}
              disabled={isGitActionRunning}
            >
              <ChevronDownIcon aria-hidden="true" className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-full max-h-80 overflow-y-auto">
              {gitActionMenuItems.map((item) => {
                const disabledReason = getMenuActionDisabledReason({
                  item,
                  gitStatus: gitStatusForActions,
                  isBusy: isGitActionRunning,
                  hasOriginRemote,
                });
                if (item.disabled && disabledReason) {
                  return (
                    <Popover key={`${item.id}-${item.label}`}>
                      <PopoverTrigger
                        openOnHover
                        nativeButton={false}
                        render={<span className="block w-max cursor-not-allowed" />}
                      >
                        <MenuItem className="w-full" disabled>
                          <GitActionItemIcon icon={item.icon} />
                          {item.label}
                        </MenuItem>
                      </PopoverTrigger>
                      <PopoverPopup tooltipStyle side="left" align="center">
                        {disabledReason}
                      </PopoverPopup>
                    </Popover>
                  );
                }

                return (
                  <MenuItem
                    key={`${item.id}-${item.label}`}
                    disabled={item.disabled}
                    onClick={() => {
                      openDialogForMenuItem(item);
                    }}
                  >
                    <GitActionItemIcon icon={item.icon} />
                    {item.label}
                  </MenuItem>
                );
              })}
              {!isMultiRepo && gitStatusForActions?.branch === null && (
                <p className="px-2 py-1.5 text-xs text-warning">
                  Detached HEAD: create and checkout a branch to enable push and PR actions.
                </p>
              )}
              {!isMultiRepo &&
                gitStatusForActions &&
                gitStatusForActions.branch !== null &&
                !gitStatusForActions.hasWorkingTreeChanges &&
                gitStatusForActions.behindCount > 0 &&
                gitStatusForActions.aheadCount === 0 && (
                  <p className="px-2 py-1.5 text-xs text-warning">
                    Behind upstream. Pull/rebase first.
                  </p>
                )}
              {isMultiRepo && multiRepoMenu && multiRepoMenu.repoSections.length > 0 && (
                <>
                  <MenuSeparator />
                  {multiRepoMenu.repoSections.map((section) => {
                    const repoStatus = statusByRepoCwd.get(section.repo.cwd) ?? null;
                    const hasChanges = repoStatus?.hasWorkingTreeChanges ?? false;
                    return (
                      <div key={section.repo.cwd}>
                        <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1.5">
                          {hasChanges && (
                            <span className="inline-block size-1.5 shrink-0 rounded-full bg-amber-500" />
                          )}
                          <span className="truncate text-[11px] font-medium text-muted-foreground">
                            {section.repo.label}
                          </span>
                        </div>
                        {section.items.map((item) => (
                          <MenuItem
                            key={`${section.repo.cwd}-${item.id}`}
                            disabled={item.disabled}
                            className="pl-5 text-xs"
                            onClick={() => {
                              openDialogForMenuItem(item);
                            }}
                          >
                            <GitActionItemIcon icon={item.icon} />
                            {item.label}
                          </MenuItem>
                        ))}
                      </div>
                    );
                  })}
                </>
              )}
            </MenuPopup>
          </Menu>
        </Group>
      )}

      <GitCommitDialog
        open={commitDialogRoute.domOpen}
        onOpenChange={commitDialogRoute.onDomOpenChange}
        branch={gitStatusForActions?.branch ?? null}
        files={allFiles}
        isDefaultBranch={isDefaultBranch}
        onOpenFile={openChangedFileInEditor}
        onSubmit={(result) => {
          runCommitDialogResult(result);
          setIsCommitDialogOpen(false);
        }}
      />

      <GitDefaultBranchDialog
        open={defaultBranchDialogRoute.domOpen}
        onOpenChange={defaultBranchDialogRoute.onDomOpenChange}
        {...defaultBranchDialogParams}
        onSubmit={handleDefaultBranchDialogResult}
      />
    </>
  );
}

registerOverlayRoute<{
  branch?: unknown;
  files?: unknown;
  isDefaultBranch?: unknown;
}>(GIT_COMMIT_OVERLAY_ROUTE_KEY, function GitCommitOverlayRoute({ message, controller }) {
  const cwd = message.context?.cwd;
  const params = readGitCommitDialogParams(message.params);

  const openFile = useCallback(
    (filePath: string) => {
      const api = readNativeApi();
      if (!api || !cwd) {
        toastManager.add({
          type: "error",
          title: "Editor opening is unavailable.",
        });
        return;
      }
      const target = resolvePathLinkTarget(filePath, cwd);
      void openInPreferredEditor(api, target).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Unable to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
    },
    [cwd],
  );

  return (
    <OverlayRouteDialog>
      <DialogPopup>
        <GitCommitDialogContent
          {...params}
          onOpenChange={(open) => {
            if (!open) controller.cancel("dismissed");
          }}
          onOpenFile={openFile}
          onSubmit={(result) => controller.submit(result)}
        />
      </DialogPopup>
    </OverlayRouteDialog>
  );
});

registerOverlayRoute<{
  continueLabel?: unknown;
  description?: unknown;
  title?: unknown;
}>(
  GIT_DEFAULT_BRANCH_OVERLAY_ROUTE_KEY,
  function GitDefaultBranchOverlayRoute({ message, controller }) {
    const params = readGitDefaultBranchDialogParams(message.params);

    return (
      <OverlayRouteDialog>
        <DialogPopup className="max-w-xl">
          <GitDefaultBranchDialogContent
            {...params}
            onOpenChange={() => undefined}
            onSubmit={(result) => controller.submit(result)}
          />
        </DialogPopup>
      </OverlayRouteDialog>
    );
  },
);

registerOverlayRoute<{
  text?: unknown;
}>(GIT_TOOLTIP_OVERLAY_ROUTE_KEY, function GitTooltipOverlayRoute({ message }) {
  const text = typeof message.params.text === "string" ? message.params.text : "";

  return (
    <OverlayRoutePopover>
      <OverlayRoutePopoverPopup tooltipStyle side="bottom" align="start">
        {text}
      </OverlayRoutePopoverPopup>
    </OverlayRoutePopover>
  );
});

function readGitCommitDialogParams(params: Record<string, unknown>): GitCommitDialogParams {
  return {
    branch: typeof params.branch === "string" ? params.branch : null,
    files: readGitCommitFilesParam(params.files),
    isDefaultBranch: params.isDefaultBranch === true,
  };
}

function readGitCommitFilesParam(value: unknown): GitCommitFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const file = entry as { deletions?: unknown; insertions?: unknown; path?: unknown };
    if (
      typeof file.path !== "string" ||
      typeof file.insertions !== "number" ||
      typeof file.deletions !== "number"
    ) {
      return [];
    }
    return [
      {
        path: file.path,
        insertions: file.insertions,
        deletions: file.deletions,
      },
    ];
  });
}

function readGitDefaultBranchDialogParams(
  params: Record<string, unknown>,
): GitDefaultBranchDialogParams {
  return {
    title: typeof params.title === "string" ? params.title : "Run action on default branch?",
    description: typeof params.description === "string" ? params.description : "",
    continueLabel: typeof params.continueLabel === "string" ? params.continueLabel : "Continue",
  };
}
