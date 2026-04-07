import { useEffect, useRef } from "react";

import { FileTreeNode, type TreeNode } from "./FileTreeNode";

interface FileTreeNodeListProps {
  nodes: TreeNode[];
  activeTabPath: string | null;
  cwd: string;
  onNodeClick: (node: TreeNode) => void;
  revealPath?: string | null;
}

export function FileTreeNodeList({
  nodes,
  activeTabPath,
  cwd,
  onNodeClick,
  revealPath,
}: FileTreeNodeListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!revealPath || !containerRef.current) return;

    // Retry until the node appears in the DOM (dirs may still be loading)
    let attempts = 0;
    const maxAttempts = 20;

    const tryScroll = () => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-tree-path="${CSS.escape(revealPath)}"]`,
      );
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return true;
      }
      return false;
    };

    if (tryScroll()) return;

    const interval = setInterval(() => {
      attempts++;
      if (tryScroll() || attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [revealPath]);

  return (
    <div ref={containerRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 py-1">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.id}
          node={node}
          isActive={activeTabPath === node.id}
          cwd={cwd}
          onClick={onNodeClick}
        />
      ))}
    </div>
  );
}
