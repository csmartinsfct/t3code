import * as FS from "node:fs";
import * as Path from "node:path";

export interface PersistedEmbeddedBrowserTab {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly favicon: string | null;
}

export interface PersistedEmbeddedBrowserProject {
  readonly activeTabId: number;
  readonly tabs: readonly PersistedEmbeddedBrowserTab[];
}

export interface PersistedEmbeddedBrowserTabState {
  readonly version: 1;
  readonly projects: Record<string, PersistedEmbeddedBrowserProject>;
}

const EMPTY_STATE: PersistedEmbeddedBrowserTabState = {
  version: 1,
  projects: {},
};

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const ALLOWED_PROTOCOLS = new Set(["about:", "http:", "https:", "chrome-extension:"]);

export function emptyEmbeddedBrowserTabState(): PersistedEmbeddedBrowserTabState {
  return EMPTY_STATE;
}

export function readEmbeddedBrowserTabState(filePath: string): PersistedEmbeddedBrowserTabState {
  try {
    if (!FS.existsSync(filePath)) return emptyEmbeddedBrowserTabState();
    return parseEmbeddedBrowserTabState(JSON.parse(FS.readFileSync(filePath, "utf8")));
  } catch {
    return emptyEmbeddedBrowserTabState();
  }
}

export function writeEmbeddedBrowserTabState(
  filePath: string,
  state: PersistedEmbeddedBrowserTabState,
): void {
  const dir = Path.dirname(filePath);
  FS.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  FS.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, filePath);
}

export function parseEmbeddedBrowserTabState(value: unknown): PersistedEmbeddedBrowserTabState {
  if (!isRecord(value)) return emptyEmbeddedBrowserTabState();
  if (value.version !== 1 || !isRecord(value.projects)) return emptyEmbeddedBrowserTabState();

  const projects: Record<string, PersistedEmbeddedBrowserProject> = {};
  for (const [projectId, rawProject] of Object.entries(value.projects)) {
    if (!isPersistableProjectId(projectId)) continue;
    const project = parseEmbeddedBrowserProject(rawProject);
    if (project) projects[projectId] = project;
  }

  return { version: 1, projects };
}

export function parseEmbeddedBrowserProject(
  value: unknown,
): PersistedEmbeddedBrowserProject | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null;

  const seen = new Set<number>();
  const tabs: PersistedEmbeddedBrowserTab[] = [];
  for (const rawTab of value.tabs) {
    const tab = parseEmbeddedBrowserTab(rawTab);
    if (!tab || seen.has(tab.id)) continue;
    seen.add(tab.id);
    tabs.push(tab);
  }
  if (tabs.length === 0) return null;

  const rawActiveTabId = Number(value.activeTabId);
  const activeTabId =
    Number.isInteger(rawActiveTabId) && seen.has(rawActiveTabId) ? rawActiveTabId : tabs[0]!.id;

  return { activeTabId, tabs };
}

export function upsertEmbeddedBrowserProjectTabState(
  state: PersistedEmbeddedBrowserTabState,
  projectId: string,
  project: PersistedEmbeddedBrowserProject,
): PersistedEmbeddedBrowserTabState {
  if (!isPersistableProjectId(projectId) || project.tabs.length === 0) return state;
  return {
    version: 1,
    projects: {
      ...state.projects,
      [projectId]: project,
    },
  };
}

function parseEmbeddedBrowserTab(value: unknown): PersistedEmbeddedBrowserTab | null {
  if (!isRecord(value)) return null;
  const id = Number(value.id);
  if (!Number.isInteger(id) || id < 0) return null;
  if (typeof value.url !== "string" || !isPersistableUrl(value.url)) return null;
  return {
    id,
    url: value.url,
    title: typeof value.title === "string" ? value.title.slice(0, 300) : "",
    favicon:
      typeof value.favicon === "string" && isPersistableUrl(value.favicon) ? value.favicon : null,
  };
}

function isPersistableProjectId(projectId: string): boolean {
  return projectId !== "." && projectId !== ".." && PROJECT_ID_PATTERN.test(projectId);
}

function isPersistableUrl(url: string): boolean {
  if (url === "" || url === "about:blank" || url === "about:newtab") return true;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
