import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, type ReactNode, useCallback, useEffect, useState } from "react";

import ChatView from "../components/ChatView";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import { projectScriptCwd } from "../projectScripts";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import {
  FileExplorerPanelShell,
  type FileExplorerPanelMode,
} from "../components/FileExplorerPanelShell";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import {
  type FileExplorerRouteSearch,
  parseFileExplorerRouteSearch,
  stripFileExplorerSearchParams,
} from "../fileExplorerRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useStore } from "../store";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const LazyFileExplorer = lazy(() => import("../components/file-explorer/FileExplorer"));
const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const FILE_EXPLORER_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_file_explorer_sidebar_width";
const FILE_EXPLORER_INLINE_DEFAULT_WIDTH = "clamp(40rem,60vw,75rem)";
const FILE_EXPLORER_INLINE_SIDEBAR_MIN_WIDTH = 640;

const DiffPanelSheet = (props: {
  children: ReactNode;
  diffOpen: boolean;
  onCloseDiff: () => void;
}) => {
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-[820px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const FileExplorerLoadingFallback = (props: { mode: FileExplorerPanelMode }) => {
  return (
    <FileExplorerPanelShell mode={props.mode}>
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <span className="text-sm text-muted-foreground">Loading file explorer…</span>
      </div>
    </FileExplorerPanelShell>
  );
};

const FileExplorerSheet = (props: {
  children: ReactNode;
  fileExplorerOpen: boolean;
  onCloseFileExplorer: () => void;
}) => {
  return (
    <Sheet
      open={props.fileExplorerOpen}
      onOpenChange={(open) => {
        if (!open) props.onCloseFileExplorer();
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,1200px)] max-w-[1200px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const FileExplorerInlineSidebar = (props: {
  fileExplorerOpen: boolean;
  onCloseFileExplorer: () => void;
  onOpenFileExplorer: () => void;
  renderContent: boolean;
  cwd: string | null;
}) => {
  const { fileExplorerOpen, onCloseFileExplorer, onOpenFileExplorer, renderContent, cwd } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) onOpenFileExplorer();
      else onCloseFileExplorer();
    },
    [onCloseFileExplorer, onOpenFileExplorer],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={fileExplorerOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": FILE_EXPLORER_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: FILE_EXPLORER_INLINE_SIDEBAR_MIN_WIDTH,
          storageKey: FILE_EXPLORER_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderContent && cwd ? (
          <Suspense fallback={<FileExplorerLoadingFallback mode="sidebar" />}>
            <LazyFileExplorer cwd={cwd} mode="sidebar" onClose={onCloseFileExplorer} />
          </Suspense>
        ) : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

function ChatThreadRouteView() {
  const bootstrapComplete = useStore((store) => store.bootstrapComplete);
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const threadExists = useStore((store) => store.threads.some((thread) => thread.id === threadId));
  const draftThreadExists = useComposerDraftStore((store) =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId),
  );
  const routeThreadExists = threadExists || draftThreadExists;

  // Diff panel state
  const diffOpen = search.diff === "1";
  const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
  // TanStack Router keeps active route components mounted across param-only navigations
  // unless remountDeps are configured, so this stays warm across thread switches.
  const [hasOpenedDiff, setHasOpenedDiff] = useState(diffOpen);
  const closeDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => ({ ...stripDiffSearchParams(previous), diff: undefined }),
    });
  }, [navigate, threadId]);
  const openDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [navigate, threadId]);

  // File explorer panel state
  const fileExplorerOpen = search.fileExplorer === "1";
  const shouldUseFileExplorerSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
  const [hasOpenedFileExplorer, setHasOpenedFileExplorer] = useState(fileExplorerOpen);
  const closeFileExplorer = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => ({
        ...stripFileExplorerSearchParams(previous),
        fileExplorer: undefined,
      }),
    });
  }, [navigate, threadId]);
  const openFileExplorer = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => {
        const rest = stripFileExplorerSearchParams(previous);
        return { ...rest, fileExplorer: "1" };
      },
    });
  }, [navigate, threadId]);

  // Effective workspace cwd for the file explorer (accounts for worktrees).
  // Must check both server threads and draft threads (new/unsent threads live
  // only in composerDraftStore until the first message is sent).
  const serverThreadProjectId = useStore(
    (store) => store.threads.find((t) => t.id === threadId)?.projectId ?? null,
  );
  const serverThreadWorktreePath = useStore(
    (store) => store.threads.find((t) => t.id === threadId)?.worktreePath ?? null,
  );
  const draftThreadProjectId = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId]?.projectId ?? null,
  );
  const draftThreadWorktreePath = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId]?.worktreePath ?? null,
  );
  const resolvedProjectId = serverThreadProjectId ?? draftThreadProjectId;
  const resolvedWorktreePath = serverThreadWorktreePath ?? draftThreadWorktreePath ?? null;
  const projectCwd = useStore((store) => {
    if (!resolvedProjectId) return null;
    const project = store.projects.find((p) => p.id === resolvedProjectId);
    if (!project) return null;
    return projectScriptCwd({ project, worktreePath: resolvedWorktreePath });
  });

  useEffect(() => {
    if (diffOpen) setHasOpenedDiff(true);
  }, [diffOpen]);

  useEffect(() => {
    if (fileExplorerOpen) setHasOpenedFileExplorer(true);
  }, [fileExplorerOpen]);

  useEffect(() => {
    if (!bootstrapComplete) return;
    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, navigate, routeThreadExists, threadId]);

  if (!bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const shouldRenderFileExplorerContent = fileExplorerOpen || hasOpenedFileExplorer;

  if (!shouldUseDiffSheet) {
    return (
      <>
        <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
          <ChatView threadId={threadId} />
        </SidebarInset>
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
        {!shouldUseFileExplorerSheet && (
          <FileExplorerInlineSidebar
            fileExplorerOpen={fileExplorerOpen}
            onCloseFileExplorer={closeFileExplorer}
            onOpenFileExplorer={openFileExplorer}
            renderContent={shouldRenderFileExplorerContent}
            cwd={projectCwd}
          />
        )}
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView threadId={threadId} />
      </SidebarInset>
      <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
        {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
      </DiffPanelSheet>
      <FileExplorerSheet
        fileExplorerOpen={fileExplorerOpen}
        onCloseFileExplorer={closeFileExplorer}
      >
        {shouldRenderFileExplorerContent && projectCwd ? (
          <Suspense fallback={<FileExplorerLoadingFallback mode="sheet" />}>
            <LazyFileExplorer cwd={projectCwd} mode="sheet" onClose={closeFileExplorer} />
          </Suspense>
        ) : null}
      </FileExplorerSheet>
    </>
  );
}

type ChatThreadRouteSearch = DiffRouteSearch & FileExplorerRouteSearch;

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search): ChatThreadRouteSearch => ({
    ...parseDiffRouteSearch(search),
    ...parseFileExplorerRouteSearch(search),
  }),
  search: {
    middlewares: [retainSearchParams<ChatThreadRouteSearch>(["diff", "fileExplorer"])],
  },
  component: ChatThreadRouteView,
});
