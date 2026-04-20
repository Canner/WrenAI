import {
  hasSelectedAssetTableValues,
  normalizeSelectedAssetTableValues,
  resolveSelectedDemoKnowledge,
} from './useKnowledgeAssetSource';

describe('useKnowledgeAssetSource helpers', () => {
  it('resolves built-in demo source mapping', () => {
    expect(resolveSelectedDemoKnowledge('demo_ecommerce')?.id).toBe(
      'demo-kb-ecommerce',
    );
    expect(resolveSelectedDemoKnowledge('demo_hr')?.id).toBe('demo-kb-hr');
    expect(resolveSelectedDemoKnowledge('database')).toBeNull();
  });

  it('normalizes selected table values for single and batch modes', () => {
    expect(normalizeSelectedAssetTableValues('sales.orders')).toEqual([
      'sales.orders',
    ]);
    expect(
      normalizeSelectedAssetTableValues([
        'sales.orders',
        '',
        'sales.customers',
      ]),
    ).toEqual(['sales.orders', 'sales.customers']);
    expect(hasSelectedAssetTableValues(['sales.orders'])).toBe(true);
    expect(hasSelectedAssetTableValues([])).toBe(false);
  });
});
