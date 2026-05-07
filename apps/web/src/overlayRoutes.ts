import { logWebTimeline } from "./timelineLogger";

import "./components/attachments/ImageExtensionConfirmDialog";
import "./components/BranchToolbar";
import "./components/BranchToolbarBranchSelector";
import "./components/file-explorer/FileSearchModal";
import "./components/GitActionsControl";
import "./components/ManagedRunsControl";
import "./components/ProjectScriptsControl";
import "./components/PullRequestThreadDialog";
import "./components/SidebarSortMenu";
import "./components/SystemPromptDialog";
import "./components/browser/EmbeddedBrowserViewportToolbar";
import "./components/chat/ContextWindowMeter";
import "./components/chat/ComposerPrimaryActions";
import "./components/chat/OpenInPicker";
import "./components/chat/OrchestrationProgressHeader";
import "./components/chat/ProposeActionCard";
import "./components/chat/ProposedPlanCard";
import "./components/chat/RateLimitMeter";
import "./components/chat/SkillsPicker";
import "./components/chat/ThreadSwitcherDropdown";
import "./components/management/BoardToolbar";
import "./components/management/TicketDetailFieldSelectOverlay";
import "./components/management/KanbanTicketDetail";
import "./components/management/MoveTicketToBoardDialog";
import "./components/management/TicketConfirmDialogs";
import "./components/management/TicketLabelPicker";
import "./components/settings/DynamicChatUiPromptSection";
import "./components/settings/LabelEditorDialog";
import "./components/settings/PromptEditorDialog";
import "./components/settings/ScheduledTaskConfirmDialogs";
import "./components/settings/ScheduledTaskDialog";
import "./components/settings/SettingsConfirmOverlay";
import "./components/settings/TemplateEditorDialog";
import "./components/settings/TicketComments";
import "./components/terminal/TerminalTooltipOverlay";

logWebTimeline("overlay-routes.loaded", {
  routes: [
    "file-search",
    "branch-env-mode-select",
    "branch-selector-combobox",
    "browser-viewport-preset-select",
    "browser-viewport-zoom-select",
    "git-actions-menu",
    "git-commit-dialog",
    "git-default-branch-confirm",
    "git-tooltip",
    "project-script-editor",
    "project-script-menu",
    "sidebar-sort-menu",
    "pull-request-thread-dialog",
    "system-prompt-dialog",
    "label-editor",
    "template-editor",
    "managed-runs-control",
    "context-window-meter",
    "composer-implement-menu",
    "open-in-picker-menu",
    "orchestration-resume-menu",
    "plan-actions-menu",
    "propose-action-icon-picker",
    "proposed-plan-save-dialog",
    "rate-limit-meter",
    "skills-picker-menu",
    "thread-switcher-menu",
    "board-toolbar-filter",
    "ticket-detail-field-select",
    "ticket-detail-actions-menu",
    "move-ticket-to-board",
    "ticket-selection-delete-confirm",
    "ticket-selection-archive-confirm",
    "ticket-delete-confirm",
    "ticket-archive-confirm",
    "sub-tickets-archive-confirm",
    "ticket-label-picker",
    "image-extension-confirm",
    "prompt-editor",
    "dynamic-chat-ui-prompt-editor",
    "scheduled-task-delete-confirm",
    "scheduled-task-editor",
    "settings-confirm",
    "delete-comment-confirm",
    "terminal-tooltip",
  ],
});
