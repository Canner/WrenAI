/**
 * Deterministic ER-diagram layout: assigns every model an `{x, y}` position
 * purely from the relationship graph, for the live/real-project path where
 * the BFF sends no `SemanticModel.position` (see `types.ts`). No randomness
 * and no physics/force simulation — the same `models`/`relationships` input
 * always produces the same output, so a page reload never reshuffles the
 * diagram.
 *
 * Algorithm: BFS layering per connected component, with isolated nodes
 * packed into a compact grid.
 * - Models are grouped into connected components using the undirected
 *   adjacency implied by `relationships` (an edge connects `fromModel` and
 *   `toModel`; self-loops and edges pointing at a model not in `nodes` are
 *   ignored).
 * - A component with two or more nodes gets a BFS from its first-encountered
 *   node (in input order, so the result doesn't depend on iteration order of
 *   a Set/Map); each node's hop distance from that root becomes its "layer",
 *   which becomes the column index, so related models line up left-to-right
 *   along the shortest join path — a "layered" ER layout. Rows within a
 *   layer stack using each node's OWN height (running offset, not a fixed
 *   stride), so one tall card never inflates the spacing used by shorter
 *   cards elsewhere in the same component.
 * - A model with NO relationships at all (a single-node component) is
 *   "isolated". Isolated nodes are not given their own vertical band —
 *   stacking one per row, as if each were a full component, produces huge
 *   empty gaps once any other node in the graph happens to be tall (see
 *   below). Instead all isolated nodes are collected and packed together
 *   into one compact, roughly-square grid (columns ≈ sqrt(count)), placed
 *   below the connected components. Each grid row's height is the max
 *   height of only the nodes actually placed in that row, so spacing always
 *   tracks real card sizes instead of a fixed constant.
 * - Connected (>=2-node) components are stacked as non-overlapping vertical
 *   bands: each starts a fresh band at column 0 and a running `y` offset
 *   advanced by the previous band's height, so bands never share a row and
 *   can't overlap horizontally either (each restarts its own column count
 *   from 0). The isolated-node grid, if any, forms one final band the same
 *   way.
 *
 * Prior to this, row spacing used a single stride derived from the tallest
 * node across the WHOLE graph, applied uniformly to every row of every
 * component. For a sparse/disconnected graph — the common case, e.g. three
 * unrelated models — that meant even small cards were spaced apart as if
 * they were all as tall as the single tallest card anywhere, producing
 * exaggerated vertical gaps. Per-row/per-component sizing plus grid-packing
 * isolated nodes fixes that without touching how connected graphs lay out.
 */

export interface ErLayoutNode {
  readonly key: string;
  /** Rendered card height (px), used only for row spacing — see module doc. */
  readonly height: number;
}

export interface ErLayoutEdge {
  readonly fromModel: string;
  readonly toModel: string;
}

export interface ErLayoutPosition {
  readonly x: number;
  readonly y: number;
}

export interface ErLayoutOptions {
  /** Rendered card width (px), used for column spacing. */
  readonly nodeWidth: number;
  /** Horizontal gap between columns (layers). Default 80. */
  readonly columnGap?: number;
  /** Vertical gap between rows within a component or the isolated-node grid. Default 40. */
  readonly rowGap?: number;
  /** Extra vertical gap between one band (component or the isolated-node grid) and the next. Default 60. */
  readonly componentGap?: number;
}

/**
 * Computes a deterministic `{x, y}` position for every node in `nodes`, laid
 * out left-to-right by BFS layer and top-to-bottom by connected component,
 * with isolated (no-relationship) nodes packed into a compact grid instead
 * of one per vertical band. Pure function — no DOM/React dependency — so
 * it's unit-testable on its own.
 */
export function computeErLayout(
  nodes: readonly ErLayoutNode[],
  edges: readonly ErLayoutEdge[],
  options: ErLayoutOptions,
): Map<string, ErLayoutPosition> {
  const { nodeWidth, columnGap = 80, rowGap = 40, componentGap = 60 } = options;

  const heightByKey = new Map(nodes.map((n) => [n.key, n.height] as const));
  const nodeKeys = new Set(nodes.map((n) => n.key));
  const adjacency = new Map<string, Set<string>>();
  for (const key of nodeKeys) adjacency.set(key, new Set());
  for (const edge of edges) {
    if (edge.fromModel === edge.toModel) continue;
    if (!nodeKeys.has(edge.fromModel) || !nodeKeys.has(edge.toModel)) continue;
    adjacency.get(edge.fromModel)!.add(edge.toModel);
    adjacency.get(edge.toModel)!.add(edge.fromModel);
  }

  const columnStride = nodeWidth + columnGap;

  const positions = new Map<string, ErLayoutPosition>();
  const visited = new Set<string>();
  const isolatedKeys: string[] = [];
  let componentTop = 0;

  for (const startNode of nodes) {
    if (visited.has(startNode.key)) continue;

    // BFS from `startNode`, grouping discovered keys by hop-distance (layer).
    const layerOf = new Map<string, number>([[startNode.key, 0]]);
    const layers: string[][] = [[startNode.key]];
    visited.add(startNode.key);
    const queue = [startNode.key];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLayer = layerOf.get(current)!;
      const neighbors = adjacency.get(current) ?? new Set<string>();
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        const nextLayer = currentLayer + 1;
        layerOf.set(neighbor, nextLayer);
        (layers[nextLayer] ??= []).push(neighbor);
        queue.push(neighbor);
      }
    }

    // A lone node with no relationships — defer to the compact grid pass
    // below instead of giving it its own vertical band (see module doc).
    if (layers.length === 1 && layers[0].length === 1) {
      isolatedKeys.push(startNode.key);
      continue;
    }

    // Lay out this (actually connected, >=2-node) component: BFS layer =
    // column. Rows within a layer stack using each node's OWN height via a
    // running offset, so a tall node in one component never inflates
    // spacing for shorter nodes in another.
    let bandHeight = 0;
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layerNodes = layers[layerIndex] ?? [];
      let rowTop = 0;
      for (const key of layerNodes) {
        positions.set(key, { x: layerIndex * columnStride, y: componentTop + rowTop });
        rowTop += heightByKey.get(key)! + rowGap;
      }
      bandHeight = Math.max(bandHeight, rowTop - rowGap);
    }
    componentTop += bandHeight + componentGap;
  }

  // Isolated (no-relationship) nodes: pack into a compact, roughly-square
  // grid instead of one node per row, so a sparse/disconnected graph
  // doesn't sprawl with oversized gaps between small cards.
  if (isolatedKeys.length > 0) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(isolatedKeys.length)));
    let rowTop = componentTop;
    for (let i = 0; i < isolatedKeys.length; i += columns) {
      const rowKeys = isolatedKeys.slice(i, i + columns);
      const rowHeight = Math.max(...rowKeys.map((key) => heightByKey.get(key)!));
      rowKeys.forEach((key, columnIndex) => {
        positions.set(key, { x: columnIndex * columnStride, y: rowTop });
      });
      rowTop += rowHeight + rowGap;
    }
  }

  return positions;
}
