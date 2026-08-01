import { describe, it, expect } from 'vitest';
import { buildEditPrompt } from '../editPrompt';

describe('buildEditPrompt', () => {
  it('includes the file path and project name', () => {
    const prompt = buildEditPrompt({
      filePath: 'wren_project/models/orders.model.yaml',
      projectName: 'acme-genbi',
      downstream: [],
      verifiedPairCount: 18,
    });

    expect(prompt).toContain('wren_project/models/orders.model.yaml');
    expect(prompt).toContain('acme-genbi');
  });

  it('lists downstream dependents with their kind', () => {
    const prompt = buildEditPrompt({
      filePath: 'wren_project/models/orders.model.yaml',
      projectName: 'acme-genbi',
      downstream: [
        { key: 'measure.revenue', name: 'revenue', kind: 'measure' },
        { key: 'view.top_customers', name: 'top_customers', kind: 'view' },
      ],
      verifiedPairCount: 18,
    });

    expect(prompt).toContain('revenue (measure)');
    expect(prompt).toContain('top_customers (view)');
  });

  it('states there are no downstream dependents when the list is empty', () => {
    const prompt = buildEditPrompt({
      filePath: 'wren_project/knowledge/business-context.md',
      projectName: 'acme-genbi',
      downstream: [],
      verifiedPairCount: 18,
    });

    expect(prompt).toMatch(/none known/i);
  });

  it('always includes a verify-gate note referencing the verified pair count', () => {
    const prompt = buildEditPrompt({
      filePath: 'wren_project/cubes/revenue.cube.yaml',
      projectName: 'acme-genbi',
      downstream: [],
      verifiedPairCount: 18,
    });

    expect(prompt).toMatch(/verify/i);
    expect(prompt).toContain('18');
    expect(prompt.toLowerCase()).toContain('deploy');
  });
});
