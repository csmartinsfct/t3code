import {
  type EditorId,
  type ManagedRunSummary,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { memo } from "react";
import type { MultiRepoGitStatus } from "../../lib/multiRepoTypes";
import type { UseOrchestrationSwitcherReturn } from "../../hooks/useOrchestrationSwitcher";
import GitActionsControl from "../GitActionsControl";
import { DiffIcon, FolderOpenIcon, ListTodoIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import ManagedRunsControl from "../ManagedRunsControl";
import { Toggle } from "../ui/toggle";
import { CollapsedSidebarTrigger } from "../ui/sidebar";
import { useUiStateStore } from "../../uiStateStore";
import { OpenInPicker } from "./OpenInPicker";
import { ThreadSwitcherDropdown } from "./ThreadSwitcherDropdown";
import { TicketIdentifierBadge } from "../TicketIdentifierBadge";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  hasActivePlan: boolean;
  planSidebarOpen: boolean;
  activeProjectScripts: ProjectScript[] | undefined;
  activeManagedRuns: ReadonlyArray<ManagedRunSummary>;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  multiRepoStatus: MultiRepoGitStatus;
  diffOpen: boolean;
  fileExplorerOpen: boolean;
  fileExplorerAvailable: boolean;
  onTogglePlanSidebar: () => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onToggleFileExplorer: () => void;
  orchestrationSwitcher: UseOrchestrationSwitcherReturn | null;
  onSwitchThread: ((threadId: string) => void) | undefined;
  activeTicketBadge?:
    | {
        identifier: string;
        title: string;
        onOpen: (identifier: string) => void | Promise<void>;
      }
    | null
    | undefined;
}

function ChatHeaderSidebarTrigger() {
  const viewMode = useUiStateStore((s) => s.viewMode);
  if (viewMode !== "chat") return null;
  return <CollapsedSidebarTrigger className="size-7 shrink-0" />;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  hasActivePlan,
  planSidebarOpen,
  activeProjectScripts,
  activeManagedRuns,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  multiRepoStatus,
  diffOpen,
  fileExplorerOpen,
  fileExplorerAvailable,
  onTogglePlanSidebar,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
  onToggleFileExplorer,
  orchestrationSwitcher,
  onSwitchThread,
  activeTicketBadge,
}: ChatHeaderProps) {
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <ChatHeaderSidebarTrigger />
        {orchestrationSwitcher?.visible && onSwitchThread ? (
          <ThreadSwitcherDropdown
            items={orchestrationSwitcher.items}
            currentLabel={orchestrationSwitcher.currentLabel}
            onNavigate={onSwitchThread}
          />
        ) : (
          <h2
            className="min-w-0 shrink truncate text-sm font-medium text-foreground"
            title={activeThreadTitle}
          >
            {activeThreadTitle}
          </h2>
        )}
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeTicketBadge ? (
          <TicketIdentifierBadge
            identifier={activeTicketBadge.identifier}
            title={activeTicketBadge.title}
            onOpen={activeTicketBadge.onOpen}
          />
        ) : null}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        {hasActivePlan && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant={planSidebarOpen ? "default" : "outline"}
                  className="shrink-0 gap-1"
                  onClick={onTogglePlanSidebar}
                  aria-label={planSidebarOpen ? "Hide plan sidebar" : "Show plan sidebar"}
                >
                  <ListTodoIcon className="size-3" />
                  <span className="sr-only @3xl/header-actions:not-sr-only">Plan</span>
                </Button>
              }
            />
            <TooltipPopup side="bottom">
              {planSidebarOpen ? "Hide plan sidebar" : "Show plan sidebar"}
            </TooltipPopup>
          </Tooltip>
        )}
        {activeProjectName && (
          <ManagedRunsControl
            runs={activeManagedRuns}
            {...(activeProjectScripts ? { scripts: activeProjectScripts } : {})}
          />
        )}
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            multiRepoStatus={multiRepoStatus}
            activeThreadId={activeThreadId}
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={fileExplorerOpen}
                onPressedChange={onToggleFileExplorer}
                aria-label="Toggle file explorer"
                variant="outline"
                size="xs"
                disabled={!fileExplorerAvailable}
              >
                <FolderOpenIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!fileExplorerAvailable
              ? "File explorer is unavailable until this thread has an active project."
              : fileExplorerOpen
                ? "Close file explorer"
                : "Open file explorer"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
