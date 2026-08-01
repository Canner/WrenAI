import { describe, it, expect } from 'vitest';
import { computeErLayout, type ErLayoutEdge, type ErLayoutNode } from '../erLayout';

const OPTIONS = { nodeWidth: 200 };

/** Do two axis-aligned rects (given as {x, y, width, height}) overlap? */
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('computeErLayout', () => {
  it('is deterministic: the same input always produces the same output', () => {
    const nodes: ErLayoutNode[] = [
      { key: 'a', height: 60 },
      { key: 'b', height: 90 },
      { key: 'c', height: 60 },
    ];
    const edges: ErLayoutEdge[] = [
      { fromModel: 'a', toModel: 'b' },
      { fromModel: 'b', toModel: 'c' },
    ];

    const first = computeErLayout(nodes, edges, OPTIONS);
    const second = computeErLayout(nodes, edges, OPTIONS);

    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it('positions every node (a Map entry per input node)', () => {
    const nodes: ErLayoutNode[] = [
      { key: 'a', height: 60 },
      { key: 'b', height: 60 },
    ];
    const positions = computeErLayout(nodes, [], OPTIONS);
    expect(positions.size).toBe(2);
    expect(positions.get('a')).toBeDefined();
    expect(positions.get('b')).toBeDefined();
  });

  it('lines up directly related models in successive columns (BFS layer = x-column)', () => {
    const nodes: ErLayoutNode[] = [
      { key: 'orders', height: 60 },
      { key: 'customers', height: 60 },
      { key: 'products', height: 60 },
    ];
    const edges: ErLayoutEdge[] = [
      { fromModel: 'orders', toModel: 'customers' },
      { fromModel: 'orders', toModel: 'products' },
    ];
    const positions = computeErLayout(nodes, edges, OPTIONS);

    const orders = positions.get('orders')!;
    const customers = positions.get('customers')!;
    const products = positions.get('products')!;

    // orders is the BFS root (layer 0); customers/products are its direct
    // neighbors (layer 1) — same column, different rows.
    expect(customers.x).toBe(orders.x + 200 + 80);
    expect(products.x).toBe(orders.x + 200 + 80);
    expect(customers.y).not.toBe(products.y);
  });

  it('places disconnected (isolated) models each in their own single-node component, with no overlap', () => {
    const nodes: ErLayoutNode[] = [
      { key: 'iso1', height: 60 },
      { key: 'iso2', height: 60 },
      { key: 'iso3', height: 60 },
    ];
    const positions = computeErLayout(nodes, [], OPTIONS);

    const rects = nodes.map((n) => ({ ...positions.get(n.key)!, width: 200, height: n.height }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it('lays out a large (18-model) graph across multiple components with no two nodes overlapping', () => {
    // A chain of 10 connected models (0..9) plus 8 disconnected singletons (10..17).
    const nodes: ErLayoutNode[] = Array.from({ length: 18 }, (_, i) => ({
      key: `m${i}`,
      // Vary height by column count so row-stride math is actually exercised.
      height: 60 + (i % 4) * 26,
    }));
    const edges: ErLayoutEdge[] = Array.from({ length: 9 }, (_, i) => ({
      fromModel: `m${i}`,
      toModel: `m${i + 1}`,
    }));

    const positions = computeErLayout(nodes, edges, OPTIONS);
    expect(positions.size).toBe(18);

    const rects = nodes.map((n) => ({ ...positions.get(n.key)!, width: 200, height: n.height }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it('groups a graph with two separate connected components into two non-overlapping vertical bands', () => {
    const nodes: ErLayoutNode[] = [
      { key: 'a1', height: 60 },
      { key: 'a2', height: 60 },
      { key: 'b1', height: 60 },
      { key: 'b2', height: 60 },
    ];
    const edges: ErLayoutEdge[] = [
      { fromModel: 'a1', toModel: 'a2' },
      { fromModel: 'b1', toModel: 'b2' },
    ];
    const positions = computeErLayout(nodes, edges, OPTIONS);

    // Component A occupies a lower y-band than component B (input order),
    // and every node's row fits within its own component's band.
    const aYs = [positions.get('a1')!.y, positions.get('a2')!.y];
    const bYs = [positions.get('b1')!.y, positions.get('b2')!.y];
    expect(Math.max(...aYs)).toBeLessThan(Math.min(...bYs));
  });

  it('ignores edges that reference a model key not present in `nodes` (no crash, no phantom position)', () => {
    const nodes: ErLayoutNode[] = [{ key: 'a', height: 60 }];
    const edges: ErLayoutEdge[] = [{ fromModel: 'a', toModel: 'ghost' }];
    const positions = computeErLayout(nodes, edges, OPTIONS);
    expect(positions.size).toBe(1);
    expect(positions.has('ghost')).toBe(false);
  });

  it('ignores self-loop edges', () => {
    const nodes: ErLayoutNode[] = [
      { key: 'a', height: 60 },
      { key: 'b', height: 60 },
    ];
    const edges: ErLayoutEdge[] = [{ fromModel: 'a', toModel: 'a' }];
    const positions = computeErLayout(nodes, edges, OPTIONS);
    // 'a' does not treat itself as a neighbor, so 'a' and 'b' remain
    // isolated (no relationship) and land in the compact isolated-node grid
    // — same row, side by side (see the packing test below).
    expect(positions.get('a')).toEqual({ x: 0, y: 0 });
    expect(positions.get('b')).toEqual({ x: 280, y: 0 });
  });

  it('packs isolated (no-relationship) nodes of varying height into a compact grid, not one huge vertical column', () => {
    // Mirrors the reported bug: unrelated models whose card heights differ a
    // lot (driven by column count) — `land`/`land_build`/`normal`.
    const nodes: ErLayoutNode[] = [
      { key: 'land', height: 346 }, // 12 columns
      { key: 'land_build', height: 372 }, // 13 columns
      { key: 'normal', height: 60 },
    ];
    const positions = computeErLayout(nodes, [], OPTIONS);

    // Packed as a grid, not stacked in a single column: more than one x is used.
    const xs = new Set(nodes.map((n) => positions.get(n.key)!.x));
    expect(xs.size).toBeGreaterThan(1);

    // No overlaps between any pair.
    const rects = nodes.map((n) => ({ ...positions.get(n.key)!, width: 200, height: n.height }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    }

    // Total vertical span stays tied to the actual cards involved, not the
    // tallest card's height applied as a uniform stride to every row (the
    // bug: with 3 nodes that would have produced a much bigger gap even
    // though `normal` is a short card).
    const tops = rects.map((r) => r.y);
    const bottoms = rects.map((r) => r.y + r.height);
    const totalHeight = Math.max(...bottoms) - Math.min(...tops);
    expect(totalHeight).toBeLessThan(372 * 2);
  });
});
