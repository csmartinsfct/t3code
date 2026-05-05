import { logWebTimeline } from "./timelineLogger";

import "./components/file-explorer/FileSearchModal";
import "./components/GitActionsControl";
import "./components/ProjectScriptsControl";

logWebTimeline("overlay-routes.loaded", {
  routes: [
    "file-search",
    "git-commit-dialog",
    "git-default-branch-confirm",
    "git-tooltip",
    "project-script-editor",
  ],
});
