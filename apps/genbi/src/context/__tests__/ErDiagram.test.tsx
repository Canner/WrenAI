import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ErDiagram } from '../ErDiagram';
import type { SemanticModel, SemanticRelationship } from '../types';

function buildPositionlessModels(n: number): SemanticModel[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `model.m${i}`,
    name: `m${i}`,
    columns: [
      { name: 'id', type: 'varchar', key: 'pk' as const },
      { name: 'value', type: 'varchar' },
    ],
    // No `position` — mirrors the real BFF DTO (live project, no ER layout source).
  }));
}

describe('ErDiagram — positionless (real project) data', () => {
  it('computes a layout and renders every model, none sharing a position, when no model carries `position`', () => {
    const models = buildPositionlessModels(18);
    const relationships: SemanticRelationship[] = Array.from({ length: 9 }, (_, i) => ({
      key: `rel.m${i}_m${i + 1}`,
      name: `m${i}_m${i + 1}`,
      fromModel: `model.m${i}`,
      toModel: `model.m${i + 1}`,
      type: 'one-to-many' as const,
    }));

    const { container } = render(<ErDiagram models={models} relationships={relationships} />);

    const seen = new Set<string>();
    for (const model of models) {
      const el = container.querySelector(`[data-testid="er-node-${model.key}"]`) as HTMLElement | null;
      expect(el).not.toBeNull();
      const key = `${el!.style.left},${el!.style.top}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('does not crash when a model has no relationships at all (isolated node)', () => {
    const models = buildPositionlessModels(1);
    const { container } = render(<ErDiagram models={models} relationships={[]} />);
    const el = container.querySelector('[data-testid="er-node-model.m0"]') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el!.style.left).toBe('20px'); // PAD only — computed x is 0.
    expect(el!.style.top).toBe('20px');
  });
});

describe('ErDiagram — position-present (fixture) data', () => {
  it('uses the given `position` as-is instead of computing one', () => {
    const models: SemanticModel[] = [
      { key: 'model.a', name: 'a', position: { x: 100, y: 50 }, columns: [] },
      { key: 'model.b', name: 'b', position: { x: 400, y: 50 }, columns: [] },
    ];
    const relationships: SemanticRelationship[] = [
      { key: 'rel.a_b', name: 'a_b', fromModel: 'model.a', toModel: 'model.b', type: 'one-to-many' },
    ];

    const { container } = render(<ErDiagram models={models} relationships={relationships} />);

    const a = container.querySelector('[data-testid="er-node-model.a"]') as HTMLElement;
    const b = container.querySelector('[data-testid="er-node-model.b"]') as HTMLElement;
    // PAD (20) + the given position, unchanged by the computed-layout path.
    expect(a.style.left).toBe('120px');
    expect(a.style.top).toBe('70px');
    expect(b.style.left).toBe('420px');
    expect(b.style.top).toBe('70px');
  });
});
