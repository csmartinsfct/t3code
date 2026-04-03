import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";

import { useFileExplorerStore, selectWorkspaceState } from "~/fileExplorerStore";
import type { PaneId } from "~/fileExplorerStore";
import { TabItem } from "./TabItem";

interface TabBarProps {
  cwd: string;
  paneId: PaneId;
  modifiedPaths: Set<string>;
}

export function TabBar({ cwd, paneId, modifiedPaths }: TabBarProps) {
  const ws = useFileExplorerStore((s) => selectWorkspaceState(s, cwd));
  const { setActiveTab } = useFileExplorerStore();
  const pane = ws.panes[paneId];
  const tabs = pane.tabIds.map((id) => ws.tabsById[id]).filter(Boolean);
  const runtime = useFileExplorerStore((s) => s.runtimeTabStateByTabId);

  const { setNodeRef, isOver } = useDroppable({ id: `tab-bar-${paneId}` });

  return (
    <div
      ref={setNodeRef}
      className="flex min-h-8 overflow-x-auto border-b border-border bg-card/50"
      style={{
        background: isOver ? "color-mix(in srgb, var(--primary) 8%, var(--card))" : undefined,
      }}
    >
      <SortableContext items={pane.tabIds} strategy={horizontalListSortingStrategy}>
        {tabs.map((tab) => {
          if (!tab) return null;
          const runtimeState = runtime[tab.id];
          return (
            <TabItem
              key={tab.id}
              tab={tab}
              paneId={paneId}
              isActive={pane.activeTabId === tab.id}
              isDirty={runtimeState?.isDirty ?? false}
              isGitModified={modifiedPaths.has(tab.relativePath)}
              cwd={cwd}
              onClick={() => setActiveTab(paneId, tab.id, cwd)}
            />
          );
        })}
      </SortableContext>
    </div>
  );
}
