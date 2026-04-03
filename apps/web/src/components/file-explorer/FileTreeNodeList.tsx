import { FileTreeNode, type TreeNode } from "./FileTreeNode";

interface FileTreeNodeListProps {
  nodes: TreeNode[];
  activeTabPath: string | null;
  cwd: string;
  onNodeClick: (node: TreeNode) => void;
}

export function FileTreeNodeList({
  nodes,
  activeTabPath,
  cwd,
  onNodeClick,
}: FileTreeNodeListProps) {
  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1 py-1">
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
