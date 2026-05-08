import type { GitBranch } from "@t3tools/contracts";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDownIcon } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import { OverlayRouteCombobox, OverlayRouteComboboxPopup } from "~/routedOverlayAdapters";
import { useRoutedPopoverSurface } from "~/routedPopover";

import {
  gitBranchSearchInfiniteQueryOptions,
  gitQueryKeys,
  gitStatusQueryOptions,
  invalidateGitQueries,
} from "../lib/gitReactQuery";
import { readNativeApi } from "../nativeApi";
import { parsePullRequestReference } from "../pullRequestReference";
import {
  deriveLocalBranchNameFromRemoteRef,
  EnvMode,
  filterVisibleBranchPickerBranches,
  resolveBranchSelectionTarget,
  resolveBranchToolbarValue,
  shouldIncludeBranchPickerItem,
} from "./BranchToolbar.logic";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "./ui/combobox";
import { toastManager } from "./ui/toast";

const BRANCH_SELECTOR_OVERLAY_ROUTE_KEY = "branch-selector-combobox";
const CHECKOUT_PULL_REQUEST_PREFIX = "__checkout_pull_request__:";
const CREATE_BRANCH_PREFIX = "__create_new_branch__:";

interface BranchToolbarBranchSelectorProps {
  activeProjectCwd: string;
  activeThreadBranch: string | null;
  activeWorktreePath: string | null;
  branchCwd: string | null;
  effectiveEnvMode: EnvMode;
  envLocked: boolean;
  onSetThreadBranch: (branch: string | null, worktreePath: string | null) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

function toBranchActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

function getBranchTriggerLabel(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
  resolvedActiveBranch: string | null;
}): string {
  const { activeWorktreePath, effectiveEnvMode, resolvedActiveBranch } = input;
  if (!resolvedActiveBranch) {
    return "Select branch";
  }
  if (effectiveEnvMode === "worktree" && !activeWorktreePath) {
    return `From ${resolvedActiveBranch}`;
  }
  return resolvedActiveBranch;
}

function getBranchBadge(branch: GitBranch, activeProjectCwd: string): string | null {
  const hasSecondaryWorktree = branch.worktreePath && branch.worktreePath !== activeProjectCwd;
  return branch.current
    ? "current"
    : hasSecondaryWorktree
      ? "worktree"
      : branch.isRemote
        ? "remote"
        : branch.isDefault
          ? "default"
          : null;
}

type BranchPickerDisplayItem =
  | { kind: "checkout-pull-request"; value: string; reference: string }
  | { kind: "create-branch"; value: string; branchName: string }
  | { kind: "branch"; value: string; branch: GitBranch };

type BranchPickerResult =
  | { kind: "checkout-pull-request"; reference: string }
  | { kind: "create-branch"; branchName: string }
  | { kind: "select-branch"; branch: GitBranch };

function buildBranchPickerDisplayItems(input: {
  branches: readonly GitBranch[];
  query: string;
  isSelectingWorktreeBase: boolean;
  canCheckoutPullRequest: boolean;
}): BranchPickerDisplayItem[] {
  const { branches, canCheckoutPullRequest, isSelectingWorktreeBase, query } = input;
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const prReference = parsePullRequestReference(trimmedQuery);
  const checkoutPullRequestItemValue =
    prReference && canCheckoutPullRequest ? `${CHECKOUT_PULL_REQUEST_PREFIX}${prReference}` : null;
  const branchByName = new Map(branches.map((branch) => [branch.name, branch] as const));
  const createBranchItemValue =
    !isSelectingWorktreeBase && trimmedQuery.length > 0
      ? `${CREATE_BRANCH_PREFIX}${trimmedQuery}`
      : null;

  const items: BranchPickerDisplayItem[] = branches.map((branch) => ({
    kind: "branch",
    value: branch.name,
    branch,
  }));
  if (createBranchItemValue && !branchByName.has(trimmedQuery)) {
    items.push({
      kind: "create-branch",
      value: createBranchItemValue,
      branchName: trimmedQuery,
    });
  }
  if (checkoutPullRequestItemValue && prReference) {
    items.unshift({
      kind: "checkout-pull-request",
      value: checkoutPullRequestItemValue,
      reference: prReference,
    });
  }

  if (normalizedQuery.length === 0) return items;
  return items.filter((item) =>
    shouldIncludeBranchPickerItem({
      itemValue: item.value,
      normalizedQuery,
      createBranchItemValue,
      checkoutPullRequestItemValue,
    }),
  );
}

function branchPickerResultForItem(item: BranchPickerDisplayItem): BranchPickerResult {
  if (item.kind === "checkout-pull-request") {
    return { kind: "checkout-pull-request", reference: item.reference };
  }
  if (item.kind === "create-branch") {
    return { kind: "create-branch", branchName: item.branchName };
  }
  return { kind: "select-branch", branch: item.branch };
}

function isBranchPickerResult(value: unknown): value is BranchPickerResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BranchPickerResult>;
  if (candidate.kind === "checkout-pull-request") {
    return typeof candidate.reference === "string";
  }
  if (candidate.kind === "create-branch") {
    return typeof candidate.branchName === "string";
  }
  if (candidate.kind === "select-branch") {
    const branch = candidate.branch as Partial<GitBranch> | undefined;
    return Boolean(branch && typeof branch.name === "string");
  }
  return false;
}

function BranchPickerComboboxItem({
  activeProjectCwd,
  index,
  item,
  onSelect,
  style,
}: {
  activeProjectCwd: string;
  index: number;
  item: BranchPickerDisplayItem;
  onSelect: (result: BranchPickerResult) => void;
  style?: CSSProperties;
}) {
  if (item.kind === "checkout-pull-request") {
    return (
      <ComboboxItem
        hideIndicator
        key={item.value}
        index={index}
        value={item.value}
        style={style}
        onClick={() => onSelect(branchPickerResultForItem(item))}
      >
        <div className="flex min-w-0 flex-col items-start py-1">
          <span className="truncate font-medium">Checkout Pull Request</span>
          <span className="truncate text-muted-foreground text-xs">{item.reference}</span>
        </div>
      </ComboboxItem>
    );
  }

  if (item.kind === "create-branch") {
    return (
      <ComboboxItem
        hideIndicator
        key={item.value}
        index={index}
        value={item.value}
        style={style}
        onClick={() => onSelect(branchPickerResultForItem(item))}
      >
        <span className="truncate">Create new branch "{item.branchName}"</span>
      </ComboboxItem>
    );
  }

  const badge = getBranchBadge(item.branch, activeProjectCwd);
  return (
    <ComboboxItem
      hideIndicator
      key={item.value}
      index={index}
      value={item.value}
      style={style}
      onClick={() => onSelect(branchPickerResultForItem(item))}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="truncate">{item.value}</span>
        {badge && <span className="shrink-0 text-[10px] text-muted-foreground/45">{badge}</span>}
      </div>
    </ComboboxItem>
  );
}

export function BranchToolbarBranchSelector({
  activeProjectCwd,
  activeThreadBranch,
  activeWorktreePath,
  branchCwd,
  effectiveEnvMode,
  envLocked,
  onSetThreadBranch,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarBranchSelectorProps) {
  const queryClient = useQueryClient();
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const deferredBranchQuery = useDeferredValue(branchQuery);

  const branchStatusQuery = useQuery(gitStatusQueryOptions(branchCwd));
  const deferredTrimmedBranchQuery = deferredBranchQuery.trim();

  useEffect(() => {
    if (!branchCwd) return;
    void queryClient.prefetchInfiniteQuery(
      gitBranchSearchInfiniteQueryOptions({ cwd: branchCwd, query: "" }),
    );
  }, [branchCwd, queryClient]);

  const {
    data: branchesSearchData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending: isBranchesSearchPending,
  } = useInfiniteQuery(
    gitBranchSearchInfiniteQueryOptions({
      cwd: branchCwd,
      query: deferredTrimmedBranchQuery,
      enabled: isBranchMenuOpen,
    }),
  );
  const allBranches = useMemo(
    () => branchesSearchData?.pages.flatMap((page) => page.branches) ?? [],
    [branchesSearchData?.pages],
  );
  const branches = useMemo(() => filterVisibleBranchPickerBranches(allBranches), [allBranches]);
  const currentGitBranch =
    branchStatusQuery.data?.branch ?? allBranches.find((branch) => branch.current)?.name ?? null;
  const canonicalActiveBranch = resolveBranchToolbarValue({
    envMode: effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch,
    currentGitBranch,
  });
  const isSelectingWorktreeBase =
    effectiveEnvMode === "worktree" && !envLocked && !activeWorktreePath;
  const branchPickerItems = useMemo(
    () =>
      buildBranchPickerDisplayItems({
        branches,
        query: deferredTrimmedBranchQuery,
        isSelectingWorktreeBase,
        canCheckoutPullRequest: Boolean(onCheckoutPullRequestRequest),
      }),
    [branches, deferredTrimmedBranchQuery, isSelectingWorktreeBase, onCheckoutPullRequestRequest],
  );
  const branchPickerItemValues = useMemo(
    () => branchPickerItems.map((item) => item.value),
    [branchPickerItems],
  );
  const [resolvedActiveBranch, setOptimisticBranch] = useOptimistic(
    canonicalActiveBranch,
    (_currentBranch: string | null, optimisticBranch: string | null) => optimisticBranch,
  );
  const [isBranchActionPending, startBranchActionTransition] = useTransition();
  const shouldVirtualizeBranchList = branchPickerItems.length > 40;
  const branchStatusText = isBranchesSearchPending
    ? "Loading branches..."
    : isFetchingNextPage
      ? "Loading more branches..."
      : hasNextPage && branches.length > 0
        ? `Showing ${branches.length} branches`
        : null;

  const runBranchAction = useCallback(
    (action: () => Promise<void>) => {
      startBranchActionTransition(async () => {
        await action().catch(() => undefined);
        await invalidateGitQueries(queryClient).catch(() => undefined);
      });
    },
    [queryClient, startBranchActionTransition],
  );

  const selectBranch = useCallback(
    (branch: GitBranch) => {
      const api = readNativeApi();
      if (!api || !branchCwd || isBranchActionPending) return;

      // In new-worktree mode, selecting a branch sets the base branch.
      if (isSelectingWorktreeBase) {
        onSetThreadBranch(branch.name, null);
        setIsBranchMenuOpen(false);
        onComposerFocusRequest?.();
        return;
      }

      const selectionTarget = resolveBranchSelectionTarget({
        activeProjectCwd,
        activeWorktreePath,
        branch,
      });

      // If the branch already lives in a worktree, point the thread there.
      if (selectionTarget.reuseExistingWorktree) {
        onSetThreadBranch(branch.name, selectionTarget.nextWorktreePath);
        setIsBranchMenuOpen(false);
        onComposerFocusRequest?.();
        return;
      }

      const selectedBranchName = branch.isRemote
        ? deriveLocalBranchNameFromRemoteRef(branch.name)
        : branch.name;

      setIsBranchMenuOpen(false);
      onComposerFocusRequest?.();

      runBranchAction(async () => {
        setOptimisticBranch(selectedBranchName);
        try {
          await api.git.checkout({ cwd: selectionTarget.checkoutCwd, branch: branch.name });
          await invalidateGitQueries(queryClient);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to checkout branch.",
            description: toBranchActionErrorMessage(error),
          });
          return;
        }

        let nextBranchName = selectedBranchName;
        if (branch.isRemote) {
          const status = await api.git
            .status({ cwd: selectionTarget.checkoutCwd })
            .catch(() => null);
          if (status?.branch) {
            nextBranchName = status.branch;
          }
        }

        setOptimisticBranch(nextBranchName);
        onSetThreadBranch(nextBranchName, selectionTarget.nextWorktreePath);
      });
    },
    [
      activeProjectCwd,
      activeWorktreePath,
      branchCwd,
      isBranchActionPending,
      isSelectingWorktreeBase,
      onComposerFocusRequest,
      onSetThreadBranch,
      queryClient,
      runBranchAction,
      setOptimisticBranch,
    ],
  );

  const createBranch = useCallback(
    (rawName: string) => {
      const name = rawName.trim();
      const api = readNativeApi();
      if (!api || !branchCwd || !name || isBranchActionPending) return;

      setIsBranchMenuOpen(false);
      onComposerFocusRequest?.();

      runBranchAction(async () => {
        setOptimisticBranch(name);

        try {
          await api.git.createBranch({ cwd: branchCwd, branch: name });
          try {
            await api.git.checkout({ cwd: branchCwd, branch: name });
          } catch (error) {
            toastManager.add({
              type: "error",
              title: "Failed to checkout branch.",
              description: toBranchActionErrorMessage(error),
            });
            return;
          }
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to create branch.",
            description: toBranchActionErrorMessage(error),
          });
          return;
        }

        setOptimisticBranch(name);
        onSetThreadBranch(name, activeWorktreePath);
        setBranchQuery("");
      });
    },
    [
      activeWorktreePath,
      branchCwd,
      isBranchActionPending,
      onComposerFocusRequest,
      onSetThreadBranch,
      runBranchAction,
      setOptimisticBranch,
    ],
  );

  const handleBranchPickerResult = useCallback(
    (result: BranchPickerResult) => {
      if (result.kind === "checkout-pull-request") {
        if (!result.reference || !onCheckoutPullRequestRequest) return;
        setIsBranchMenuOpen(false);
        setBranchQuery("");
        onComposerFocusRequest?.();
        onCheckoutPullRequestRequest(result.reference);
        return;
      }

      if (result.kind === "create-branch") {
        createBranch(result.branchName);
        return;
      }

      selectBranch(result.branch);
    },
    [createBranch, onCheckoutPullRequestRequest, onComposerFocusRequest, selectBranch],
  );

  const handleBranchRouteResult = useCallback(
    (value: BranchPickerResult) => {
      if (!isBranchPickerResult(value)) return;
      setIsBranchMenuOpen(false);
      setBranchQuery("");
      handleBranchPickerResult(value);
    },
    [handleBranchPickerResult],
  );

  useEffect(() => {
    if (
      effectiveEnvMode !== "worktree" ||
      activeWorktreePath ||
      activeThreadBranch ||
      !currentGitBranch
    ) {
      return;
    }
    onSetThreadBranch(currentGitBranch, null);
  }, [
    activeThreadBranch,
    activeWorktreePath,
    currentGitBranch,
    effectiveEnvMode,
    onSetThreadBranch,
  ]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsBranchMenuOpen(open);
      if (!open) {
        setBranchQuery("");
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: gitQueryKeys.branches(branchCwd),
      });
    },
    [branchCwd, queryClient],
  );

  const branchListScrollElementRef = useRef<HTMLDivElement | null>(null);
  const maybeFetchNextBranchPage = useCallback(() => {
    if (!isBranchMenuOpen || !hasNextPage || isFetchingNextPage) {
      return;
    }

    const scrollElement = branchListScrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const distanceFromBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
    if (distanceFromBottom > 96) {
      return;
    }

    void fetchNextPage().catch(() => undefined);
  }, [fetchNextPage, hasNextPage, isBranchMenuOpen, isFetchingNextPage]);
  const branchListVirtualizer = useVirtualizer({
    count: branchPickerItems.length,
    estimateSize: (index) => (branchPickerItems[index]?.kind === "checkout-pull-request" ? 44 : 28),
    getScrollElement: () => branchListScrollElementRef.current,
    overscan: 12,
    enabled: isBranchMenuOpen && shouldVirtualizeBranchList,
    initialRect: {
      height: 224,
      width: 0,
    },
  });
  const virtualBranchRows = branchListVirtualizer.getVirtualItems();
  const setBranchListRef = useCallback(
    (element: HTMLDivElement | null) => {
      branchListScrollElementRef.current =
        (element?.parentElement as HTMLDivElement | null) ?? null;
      if (element) {
        branchListVirtualizer.measure();
      }
    },
    [branchListVirtualizer],
  );

  useEffect(() => {
    if (!isBranchMenuOpen || !shouldVirtualizeBranchList) return;
    queueMicrotask(() => {
      branchListVirtualizer.measure();
    });
  }, [
    branchListVirtualizer,
    branchPickerItems.length,
    isBranchMenuOpen,
    shouldVirtualizeBranchList,
  ]);

  useEffect(() => {
    if (!isBranchMenuOpen) {
      return;
    }

    branchListScrollElementRef.current?.scrollTo({ top: 0 });
  }, [deferredTrimmedBranchQuery, isBranchMenuOpen]);

  useEffect(() => {
    const scrollElement = branchListScrollElementRef.current;
    if (!scrollElement || !isBranchMenuOpen) {
      return;
    }

    const handleScroll = () => {
      maybeFetchNextBranchPage();
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [isBranchMenuOpen, maybeFetchNextBranchPage]);

  useEffect(() => {
    maybeFetchNextBranchPage();
  }, [allBranches.length, maybeFetchNextBranchPage]);

  const triggerLabel = getBranchTriggerLabel({
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
  });
  const branchRoute = useRoutedPopoverSurface<HTMLButtonElement, BranchPickerResult>({
    routeKey: BRANCH_SELECTOR_OVERLAY_ROUTE_KEY,
    kind: "menu",
    align: "end",
    side: "top",
    params: {
      activeProjectCwd,
      activeThreadBranch,
      activeWorktreePath,
      branchCwd,
      effectiveEnvMode,
      envLocked,
      resolvedActiveBranch,
      canCheckoutPullRequest: Boolean(onCheckoutPullRequestRequest),
    },
    onResult: handleBranchRouteResult,
  });
  const handleComboboxOpenChange = useCallback(
    (open: boolean) => {
      handleOpenChange(open);
      branchRoute.onOpenChange(open);
    },
    [branchRoute, handleOpenChange],
  );

  return (
    <Combobox
      items={branchPickerItemValues}
      filteredItems={branchPickerItemValues}
      autoHighlight
      virtualized={shouldVirtualizeBranchList}
      onItemHighlighted={(_value, eventDetails) => {
        if (!isBranchMenuOpen || eventDetails.index < 0) return;
        branchListVirtualizer.scrollToIndex(eventDetails.index, { align: "auto" });
      }}
      onOpenChange={handleComboboxOpenChange}
      open={branchRoute.domOpen}
      value={resolvedActiveBranch}
    >
      <ComboboxTrigger
        render={<Button variant="ghost" size="xs" />}
        className="text-muted-foreground/70 hover:text-foreground/80"
        disabled={(isBranchesSearchPending && branches.length === 0) || isBranchActionPending}
        onFocusCapture={branchRoute.updateAnchor}
        onMouseOverCapture={branchRoute.updateAnchor}
        ref={branchRoute.triggerRef}
      >
        <span className="max-w-[240px] truncate">{triggerLabel}</span>
        <ChevronDownIcon />
      </ComboboxTrigger>
      <ComboboxPopup align="end" side="top" className="w-80">
        <div className="border-b p-1">
          <ComboboxInput
            className="[&_input]:font-sans rounded-md"
            inputClassName="ring-0"
            placeholder="Search branches..."
            showTrigger={false}
            size="sm"
            value={branchQuery}
            onChange={(event) => setBranchQuery(event.target.value)}
          />
        </div>
        <ComboboxEmpty>No branches found.</ComboboxEmpty>

        <ComboboxList ref={setBranchListRef} className="max-h-56">
          {shouldVirtualizeBranchList ? (
            <div
              className="relative"
              style={{
                height: `${branchListVirtualizer.getTotalSize()}px`,
              }}
            >
              {virtualBranchRows.map((virtualRow) => {
                const item = branchPickerItems[virtualRow.index];
                if (!item) return null;
                return (
                  <BranchPickerComboboxItem
                    activeProjectCwd={activeProjectCwd}
                    index={virtualRow.index}
                    item={item}
                    key={item.value}
                    onSelect={handleBranchPickerResult}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  />
                );
              })}
            </div>
          ) : (
            branchPickerItems.map((item, index) => (
              <BranchPickerComboboxItem
                activeProjectCwd={activeProjectCwd}
                index={index}
                item={item}
                key={item.value}
                onSelect={handleBranchPickerResult}
              />
            ))
          )}
        </ComboboxList>
        {branchStatusText ? <ComboboxStatus>{branchStatusText}</ComboboxStatus> : null}
      </ComboboxPopup>
    </Combobox>
  );
}

registerOverlayRoute<{
  activeProjectCwd?: unknown;
  activeThreadBranch?: unknown;
  activeWorktreePath?: unknown;
  branchCwd?: unknown;
  canCheckoutPullRequest?: unknown;
  effectiveEnvMode?: unknown;
  envLocked?: unknown;
  resolvedActiveBranch?: unknown;
}>(
  BRANCH_SELECTOR_OVERLAY_ROUTE_KEY,
  function BranchSelectorComboboxOverlayRoute({ message, controller }) {
    const activeProjectCwd = readStringParam(message.params.activeProjectCwd) ?? "";
    const branchCwd = readStringParam(message.params.branchCwd);
    const effectiveEnvMode = readEnvModeParam(message.params.effectiveEnvMode);
    const activeWorktreePath = readStringParam(message.params.activeWorktreePath);
    const envLocked = message.params.envLocked === true;
    const canCheckoutPullRequest = message.params.canCheckoutPullRequest === true;
    const resolvedActiveBranch = readStringParam(message.params.resolvedActiveBranch);
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query);
    const trimmedQuery = deferredQuery.trim();

    const {
      data: branchesSearchData,
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage,
      isPending,
    } = useInfiniteQuery(
      gitBranchSearchInfiniteQueryOptions({
        cwd: branchCwd,
        query: trimmedQuery,
        enabled: branchCwd !== null,
      }),
    );
    const allBranches = useMemo(
      () => branchesSearchData?.pages.flatMap((page) => page.branches) ?? [],
      [branchesSearchData?.pages],
    );
    const branches = useMemo(() => filterVisibleBranchPickerBranches(allBranches), [allBranches]);
    const isSelectingWorktreeBase =
      effectiveEnvMode === "worktree" && !envLocked && !activeWorktreePath;
    const displayItems = useMemo(
      () =>
        buildBranchPickerDisplayItems({
          branches,
          query: trimmedQuery,
          isSelectingWorktreeBase,
          canCheckoutPullRequest,
        }),
      [branches, canCheckoutPullRequest, isSelectingWorktreeBase, trimmedQuery],
    );
    const itemValues = useMemo(() => displayItems.map((item) => item.value), [displayItems]);
    const statusText = isPending
      ? "Loading branches..."
      : isFetchingNextPage
        ? "Loading more branches..."
        : hasNextPage && branches.length > 0
          ? `Showing ${branches.length} branches`
          : null;
    const shouldVirtualize = displayItems.length > 40;
    const scrollElementRef = useRef<HTMLDivElement | null>(null);
    const maybeFetchNextPage = useCallback(() => {
      if (!hasNextPage || isFetchingNextPage) return;
      const scrollElement = scrollElementRef.current;
      if (!scrollElement) return;
      const distanceFromBottom =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
      if (distanceFromBottom > 96) return;
      void fetchNextPage().catch(() => undefined);
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
    const virtualizer = useVirtualizer({
      count: displayItems.length,
      estimateSize: (index) => (displayItems[index]?.kind === "checkout-pull-request" ? 44 : 28),
      getScrollElement: () => scrollElementRef.current,
      overscan: 12,
      enabled: shouldVirtualize,
      initialRect: {
        height: 224,
        width: 0,
      },
    });
    const virtualRows = virtualizer.getVirtualItems();
    const setListRef = useCallback(
      (element: HTMLDivElement | null) => {
        scrollElementRef.current = (element?.parentElement as HTMLDivElement | null) ?? null;
        if (element) {
          virtualizer.measure();
        }
      },
      [virtualizer],
    );

    useEffect(() => {
      if (!shouldVirtualize) return;
      queueMicrotask(() => {
        virtualizer.measure();
      });
    }, [displayItems.length, shouldVirtualize, virtualizer]);

    useEffect(() => {
      scrollElementRef.current?.scrollTo({ top: 0 });
    }, [trimmedQuery]);

    useEffect(() => {
      const scrollElement = scrollElementRef.current;
      if (!scrollElement) return;
      const handleScroll = () => {
        maybeFetchNextPage();
      };
      scrollElement.addEventListener("scroll", handleScroll, { passive: true });
      handleScroll();
      return () => {
        scrollElement.removeEventListener("scroll", handleScroll);
      };
    }, [maybeFetchNextPage]);

    useEffect(() => {
      maybeFetchNextPage();
    }, [allBranches.length, maybeFetchNextPage]);

    const submitItem = (result: BranchPickerResult) => {
      controller.submit(result);
    };

    return (
      <OverlayRouteCombobox
        items={itemValues}
        filteredItems={itemValues}
        autoHighlight
        virtualized={shouldVirtualize}
        value={resolvedActiveBranch}
      >
        <OverlayRouteComboboxPopup align="end" side="top" className="w-80">
          <div className="border-b p-1">
            <ComboboxInput
              className="[&_input]:font-sans rounded-md"
              inputClassName="ring-0"
              placeholder="Search branches..."
              showTrigger={false}
              size="sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <ComboboxEmpty>No branches found.</ComboboxEmpty>
          <ComboboxList ref={setListRef} className="max-h-56">
            {shouldVirtualize ? (
              <div
                className="relative"
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                }}
              >
                {virtualRows.map((virtualRow) => {
                  const item = displayItems[virtualRow.index];
                  if (!item) return null;
                  return (
                    <BranchPickerComboboxItem
                      activeProjectCwd={activeProjectCwd}
                      index={virtualRow.index}
                      item={item}
                      key={item.value}
                      onSelect={submitItem}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              displayItems.map((item, index) => (
                <BranchPickerComboboxItem
                  activeProjectCwd={activeProjectCwd}
                  index={index}
                  item={item}
                  key={item.value}
                  onSelect={submitItem}
                />
              ))
            )}
          </ComboboxList>
          {statusText ? <ComboboxStatus>{statusText}</ComboboxStatus> : null}
        </OverlayRouteComboboxPopup>
      </OverlayRouteCombobox>
    );
  },
);

function readStringParam(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readEnvModeParam(value: unknown): EnvMode {
  return value === "worktree" ? "worktree" : "local";
}
