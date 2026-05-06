import { logWebTimeline } from "./timelineLogger";

import "./components/attachments/ImageExtensionConfirmDialog";
import "./components/file-explorer/FileSearchModal";
import "./components/GitActionsControl";
import "./components/ManagedRunsControl";
import "./components/ProjectScriptsControl";
import "./components/chat/ContextWindowMeter";
import "./components/chat/ProposeActionCard";
import "./components/chat/RateLimitMeter";
import "./components/management/BoardToolbar";
import "./components/management/TicketDetailFieldSelectOverlay";
import "./components/management/MoveTicketToBoardDialog";
import "./components/management/TicketConfirmDialogs";
import "./components/management/TicketLabelPicker";
import "./components/settings/ScheduledTaskConfirmDialogs";
import "./components/settings/TicketComments";
import "./components/terminal/TerminalTooltipOverlay";

logWebTimeline("overlay-routes.loaded", {
  routes: [
    "file-search",
    "git-commit-dialog",
    "git-default-branch-confirm",
    "git-tooltip",
    "project-script-editor",
    "managed-runs-control",
    "context-window-meter",
    "propose-action-icon-picker",
    "rate-limit-meter",
    "board-toolbar-filter",
    "ticket-detail-field-select",
    "move-ticket-to-board",
    "ticket-selection-delete-confirm",
    "ticket-selection-archive-confirm",
    "ticket-delete-confirm",
    "ticket-archive-confirm",
    "sub-tickets-archive-confirm",
    "ticket-label-picker",
    "image-extension-confirm",
    "scheduled-task-delete-confirm",
    "delete-comment-confirm",
    "terminal-tooltip",
  ],
});
