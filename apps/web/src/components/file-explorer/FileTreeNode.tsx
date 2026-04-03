import { useDraggable } from "@dnd-kit/core";
import { ChevronRightIcon } from "lucide-react";
import { memo } from "react";

import { getVscodeIconUrlForEntry } from "~/vscode-icons";
import { cn } from "~/lib/utils";

export interface TreeNode {
  id: string; // relative path from workspace root
  kind: "file" | "directory";
  name: string;
  depth: number;
  isExpanded?: boolean;
  isGitModified?: boolean;
}

interface FileTreeNodeProps {
  node: TreeNode;
  isActive: boolean;
  cwd: string;
  onClick: (node: TreeNode) => void;
  style?: React.CSSProperties;
}

export const FileTreeNode = memo(function FileTreeNode({
  node,
  isActive,
  cwd,
  onClick,
  style,
}: FileTreeNodeProps) {
  const iconUrl = getVscodeIconUrlForEntry(node.name, node.kind, "dark");
  const indentPx = node.depth * 12 + 6;

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tree-node-${node.id}`,
    data: { type: "file-tree-node", cwd, relativePath: node.id },
    disabled: node.kind === "directory",
  });

  return (
    <div
      ref={node.kind === "file" ? setNodeRef : undefined}
      {...(node.kind === "file" ? { ...attributes, ...listeners } : {})}
      role="button"
      tabIndex={0}
      aria-selected={isActive}
      style={{
        ...style,
        paddingLeft: `${indentPx}px`,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={cn(
        "flex h-[22px] min-w-0 cursor-pointer select-none items-center gap-1.5 rounded-md pr-2 transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
      )}
      onClick={() => onClick(node)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(node);
        }
      }}
    >
      {/* Expand/collapse chevron for directories */}
      {node.kind === "directory" ? (
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground/60 transition-transform duration-120",
            node.isExpanded && "rotate-90",
          )}
          aria-hidden
        />
      ) : (
        <span className="size-3 shrink-0" aria-hidden />
      )}

      {/* File/folder icon */}
      <img src={iconUrl} alt="" aria-hidden className="size-3.5 shrink-0" />

      {/* Name + git badge */}
      <span className={cn("min-w-0 truncate text-xs", node.isGitModified && "text-success")}>
        {node.name}
      </span>
      {node.isGitModified && (
        <span
          className="ml-auto shrink-0 text-[10px] font-medium text-success"
          aria-label="Modified"
        >
          M
        </span>
      )}
    </div>
  );
});
