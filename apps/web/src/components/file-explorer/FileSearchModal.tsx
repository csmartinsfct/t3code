/**
 * FileSearchModal — Cmd+P quick-open palette for the file explorer.
 *
 * Shows recently opened tabs when query is empty, fuzzy search results
 * when the user types. Renders inside a CommandDialog overlay.
 */
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { basenameOfPath, getVscodeIconUrlForEntry } from "~/vscode-icons";
import { useFileExplorerStore, selectWorkspaceState } from "~/fileExplorerStore";
import { OverlayRouteCommandDialog, useRoutedOverlaySurface } from "~/routedOverlayAdapters";
import { registerOverlayRoute } from "~/components/overlay/overlayRouteRegistry";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";

const FILE_SEARCH_DEBOUNCE_MS = 150;
const FILE_SEARCH_LIMIT = 50;
const FILE_SEARCH_OVERLAY_ROUTE_KEY = "file-search";

interface FileSearchRecentTab {
  id: string;
  relativePath: string;
}

interface FileSearchModalProps {
  cwd: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectFile: (relativePath: string) => void;
}

export function FileSearchModal({ cwd, open, onOpenChange, onSelectFile }: FileSearchModalProps) {
  // Recent files: all tabs currently open for this workspace. The overlay
  // WebContents has its own JS context, so pass this serializable snapshot as
  // route params when native overlay rendering is active.
  const ws = useFileExplorerStore((s) => selectWorkspaceState(s, cwd));
  const recentTabs: FileSearchRecentTab[] = [
    ...ws.panes.primary.tabIds,
    ...ws.panes.secondary.tabIds,
  ]
    .filter((id, idx, arr) => arr.indexOf(id) === idx)
    .flatMap((id) => {
      const tab = ws.tabsById[id];
      return tab ? [{ id: tab.id, relativePath: tab.relativePath }] : [];
    });

  const routed = useRoutedOverlaySurface<string>({
    open,
    onOpenChange,
    routeKey: FILE_SEARCH_OVERLAY_ROUTE_KEY,
    params: { cwd, recentTabs },
    context: { cwd },
    presentation: { kind: "command-dialog" },
    onResult: onSelectFile,
  });

  return (
    <FileSearchDialog
      cwd={cwd}
      open={routed.domOpen}
      onOpenChange={routed.onDomOpenChange}
      onSelectFile={onSelectFile}
      recentTabs={recentTabs}
    />
  );
}

function FileSearchDialog({
  cwd,
  open,
  onOpenChange,
  onSelectFile,
  recentTabs,
}: FileSearchModalProps & {
  recentTabs: FileSearchRecentTab[];
}) {
  const [query, setQuery] = useState("");

  const handleSelect = (relativePath: string) => {
    onSelectFile(relativePath);
    onOpenChange(false);
    setQuery("");
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) setQuery("");
      }}
    >
      <CommandDialogPopup>
        <FileSearchCommand
          cwd={cwd}
          query={query}
          recentTabs={recentTabs}
          onQueryChange={setQuery}
          onSelectFile={handleSelect}
        />
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function FileSearchCommand({
  cwd,
  query,
  recentTabs,
  onQueryChange,
  onSelectFile,
}: {
  cwd: string;
  query: string;
  recentTabs: FileSearchRecentTab[];
  onQueryChange: (query: string) => void;
  onSelectFile: (relativePath: string) => void;
}) {
  const [debouncedQuery] = useDebouncedValue(query, { wait: FILE_SEARCH_DEBOUNCE_MS });

  // Fuzzy search
  const searchQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd,
      query: debouncedQuery,
      enabled: debouncedQuery.length > 0,
      limit: FILE_SEARCH_LIMIT,
    }),
  );

  const showRecent = query.length === 0;
  const searchResults = searchQuery.data?.entries ?? [];

  return (
    <Command autoHighlight="always" mode="none">
      <CommandInput
        placeholder="Search files…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <CommandList>
        {showRecent ? (
          recentTabs.length > 0 ? (
            <CommandGroup>
              <CommandGroupLabel>Recently Opened</CommandGroupLabel>
              {recentTabs.map((tab) => {
                const name = basenameOfPath(tab.relativePath);
                const parentDir = tab.relativePath.includes("/")
                  ? tab.relativePath.slice(0, tab.relativePath.lastIndexOf("/"))
                  : "";
                return (
                  <FileResultItem
                    key={tab.id}
                    relativePath={tab.relativePath}
                    name={name}
                    parentDir={parentDir}
                    kind="file"
                    onSelect={onSelectFile}
                  />
                );
              })}
            </CommandGroup>
          ) : (
            <CommandEmpty>
              <span className="px-4 py-3 text-sm text-muted-foreground">
                No recently opened files
              </span>
            </CommandEmpty>
          )
        ) : (
          <>
            {searchQuery.isLoading ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">Searching…</div>
            ) : searchResults.length > 0 ? (
              <CommandGroup>
                {searchResults.map((entry) => {
                  const name = basenameOfPath(entry.path);
                  const parentDir = entry.path.includes("/")
                    ? entry.path.slice(0, entry.path.lastIndexOf("/"))
                    : "";
                  return (
                    <FileResultItem
                      key={entry.path}
                      relativePath={entry.path}
                      name={name}
                      parentDir={parentDir}
                      kind={entry.kind}
                      onSelect={onSelectFile}
                    />
                  );
                })}
              </CommandGroup>
            ) : (
              <CommandEmpty>
                <span className="px-4 py-3 text-sm text-muted-foreground">No files found</span>
              </CommandEmpty>
            )}
          </>
        )}
      </CommandList>
    </Command>
  );
}

registerOverlayRoute<{ cwd?: unknown; recentTabs?: unknown }>(
  FILE_SEARCH_OVERLAY_ROUTE_KEY,
  function FileSearchOverlayRoute({ message, controller }) {
    const cwd = typeof message.params.cwd === "string" ? message.params.cwd : message.context?.cwd;
    const recentTabs = readRecentTabsParam(message.params.recentTabs);
    const [query, setQuery] = useState("");

    useEffect(() => {
      if (!cwd) controller.fail(new Error("File search requires a workspace path."));
    }, [controller, cwd]);

    if (!cwd) return null;

    return (
      <OverlayRouteCommandDialog>
        <CommandDialogPopup>
          <FileSearchCommand
            cwd={cwd}
            query={query}
            recentTabs={recentTabs}
            onQueryChange={setQuery}
            onSelectFile={(relativePath) => controller.submit(relativePath)}
          />
        </CommandDialogPopup>
      </OverlayRouteCommandDialog>
    );
  },
);

function readRecentTabsParam(value: unknown): FileSearchRecentTab[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const tab = item as { id?: unknown; relativePath?: unknown };
    if (typeof tab.id !== "string" || typeof tab.relativePath !== "string") return [];
    return [{ id: tab.id, relativePath: tab.relativePath }];
  });
}

function FileResultItem({
  relativePath,
  name,
  parentDir,
  kind,
  onSelect,
}: {
  relativePath: string;
  name: string;
  parentDir: string;
  kind: "file" | "directory";
  onSelect: (relativePath: string) => void;
}) {
  const iconUrl = getVscodeIconUrlForEntry(name, kind, "dark");
  return (
    <CommandItem
      value={relativePath}
      className="cursor-pointer gap-2"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect(relativePath)}
    >
      <img src={iconUrl} alt="" aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate font-medium text-foreground">{name}</span>
      {parentDir && (
        <span className="ml-auto shrink-0 truncate text-xs text-muted-foreground/70">
          {parentDir}
        </span>
      )}
    </CommandItem>
  );
}
