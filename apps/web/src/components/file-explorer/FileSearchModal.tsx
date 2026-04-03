/**
 * FileSearchModal — Cmd+P quick-open palette for the file explorer.
 *
 * Shows recently opened tabs when query is empty, fuzzy search results
 * when the user types. Renders inside a CommandDialog overlay.
 */
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { projectSearchEntriesQueryOptions } from "~/lib/projectReactQuery";
import { basenameOfPath, getVscodeIconUrlForEntry } from "~/vscode-icons";
import { useFileExplorerStore, selectWorkspaceState } from "~/fileExplorerStore";
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

interface FileSearchModalProps {
  cwd: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectFile: (relativePath: string) => void;
}

export function FileSearchModal({ cwd, open, onOpenChange, onSelectFile }: FileSearchModalProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebouncedValue(query, { wait: FILE_SEARCH_DEBOUNCE_MS });

  // Recent files: all tabs currently open for this workspace
  const ws = useFileExplorerStore((s) => selectWorkspaceState(s, cwd));
  const recentTabs = [...ws.panes.primary.tabIds, ...ws.panes.secondary.tabIds]
    .filter((id, idx, arr) => arr.indexOf(id) === idx) // deduplicate
    .map((id) => ws.tabsById[id])
    .filter(Boolean);

  // Fuzzy search
  const searchQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd,
      query: debouncedQuery,
      enabled: debouncedQuery.length > 0,
      limit: FILE_SEARCH_LIMIT,
    }),
  );

  const handleSelect = (relativePath: string) => {
    onSelectFile(relativePath);
    onOpenChange(false);
    setQuery("");
  };

  const showRecent = query.length === 0;
  const searchResults = searchQuery.data?.entries ?? [];

  return (
    <CommandDialog
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) setQuery("");
      }}
    >
      <CommandDialogPopup>
        <Command autoHighlight="always" mode="none">
          <CommandInput
            placeholder="Search files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <CommandList>
            {showRecent ? (
              recentTabs.length > 0 ? (
                <CommandGroup>
                  <CommandGroupLabel>Recently Opened</CommandGroupLabel>
                  {recentTabs.map((tab) => {
                    if (!tab) return null;
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
                        onSelect={handleSelect}
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
                          onSelect={handleSelect}
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
      </CommandDialogPopup>
    </CommandDialog>
  );
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
