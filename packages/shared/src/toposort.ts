/**
 * Generic topological sort using Kahn's algorithm (BFS).
 *
 * Produces a stable ordering: nodes with no remaining dependency constraints
 * are emitted in the order they appear in the input `nodes` array, which lets
 * callers control tie-breaking (e.g. board sort order).
 */

export interface ToposortResult<T> {
  /** Nodes in dependency order (dependencies before dependents). */
  sorted: T[];
  /** Groups of nodes that form cycles (empty when the graph is a DAG). */
  cycles: T[][];
}

/**
 * Topologically sort `nodes` given directed `edges`.
 *
 * Each edge `{ from, to }` means "from depends on to" — so `to` will appear
 * before `from` in the output.
 *
 * @param nodes  The full set of nodes to sort.
 * @param edges  Dependency edges among the nodes. Edges referencing nodes not
 *               in `nodes` are silently ignored.
 * @param getId  Extract a unique string key from a node.
 */
export function toposort<T>(
  nodes: readonly T[],
  edges: readonly { from: T; to: T }[],
  getId: (node: T) => string,
): ToposortResult<T> {
  if (nodes.length === 0) return { sorted: [], cycles: [] };

  const nodeById = new Map<string, T>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>(); // to -> [from, ...]

  for (const node of nodes) {
    const id = getId(node);
    nodeById.set(id, node);
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  // Build graph — only consider edges where both endpoints are in the node set.
  for (const edge of edges) {
    const fromId = getId(edge.from);
    const toId = getId(edge.to);
    if (!nodeById.has(fromId) || !nodeById.has(toId)) continue;
    // toId -> fromId means "fromId depends on toId"
    adjacency.get(toId)!.push(fromId);
    inDegree.set(fromId, (inDegree.get(fromId) ?? 0) + 1);
  }

  // Seed queue with zero-indegree nodes in input order (stable tie-breaking).
  const queue: string[] = [];
  for (const node of nodes) {
    const id = getId(node);
    if (inDegree.get(id) === 0) queue.push(id);
  }

  const sorted: T[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(nodeById.get(id)!);

    for (const dependentId of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(dependentId) ?? 1) - 1;
      inDegree.set(dependentId, newDegree);
      if (newDegree === 0) queue.push(dependentId);
    }
  }

  // Any nodes not emitted are part of cycles.
  const cycles: T[][] = [];
  if (sorted.length < nodes.length) {
    const sortedIds = new Set(sorted.map(getId));
    const remaining = new Map<string, T>();
    for (const node of nodes) {
      const id = getId(node);
      if (!sortedIds.has(id)) remaining.set(id, node);
    }

    // Extract individual cycles via DFS on the remaining subgraph.
    const visited = new Set<string>();
    for (const startId of remaining.keys()) {
      if (visited.has(startId)) continue;
      const cycle: T[] = [];
      const stack = [startId];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        if (remaining.has(current)) {
          cycle.push(remaining.get(current)!);
          for (const dep of adjacency.get(current) ?? []) {
            if (remaining.has(dep) && !visited.has(dep)) stack.push(dep);
          }
        }
      }
      if (cycle.length > 0) cycles.push(cycle);
    }
  }

  return { sorted, cycles };
}
