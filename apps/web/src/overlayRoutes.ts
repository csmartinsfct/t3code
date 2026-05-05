import { logWebTimeline } from "./timelineLogger";

import "./components/file-explorer/FileSearchModal";

logWebTimeline("overlay-routes.loaded", { routes: ["file-search"] });
