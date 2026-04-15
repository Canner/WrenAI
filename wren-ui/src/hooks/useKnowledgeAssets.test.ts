import { resolveKnowledgePreviewFieldCount } from './useKnowledgeAssets';

describe('useKnowledgeAssets helpers', () => {
  it('prefers runtime total field count when present', () => {
    expect(
      resolveKnowledgePreviewFieldCount({
        totalFieldCount: 12,
        demoFieldCount: 8,
      }),
    ).toBe(12);
  });

  it('falls back to demo field count when runtime count is empty', () => {
    expect(
      resolveKnowledgePreviewFieldCount({
        totalFieldCount: 0,
        demoFieldCount: 8,
      }),
    ).toBe(8);
    expect(
      resolveKnowledgePreviewFieldCount({
        totalFieldCount: 0,
        demoFieldCount: undefined,
      }),
    ).toBe(0);
  });
});
