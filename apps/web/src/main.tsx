import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import type { ProjectId } from "@t3tools/contracts";

import "@xterm/xterm/css/xterm.css";
import "./index.css";

import { isElectron } from "./env";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { EmbeddedBrowserPopoutApp } from "./components/browser/EmbeddedBrowserPopoutApp";

document.title = APP_DISPLAY_NAME;

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// Popout mode (T3CO-424). When the desktop main process opens a free-floating
// browser window for a project, the URL carries `?popout=<projectId>` so this
// renderer entry knows to skip the full app shell and just mount the
// EmbeddedBrowser component, which owns the WebContentsView lifecycle for
// that project.
const popoutProjectId = new URLSearchParams(window.location.search).get("popout");
if (popoutProjectId) {
  root.render(
    <React.StrictMode>
      <EmbeddedBrowserPopoutApp projectId={popoutProjectId as ProjectId} />
    </React.StrictMode>,
  );
} else {
  // Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
  const history = isElectron ? createHashHistory() : createBrowserHistory();
  const router = getRouter(history);
  root.render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
}
