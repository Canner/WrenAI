import { resolveSelectedDemoKnowledge } from './useKnowledgeAssetSource';

describe('useKnowledgeAssetSource helpers', () => {
  it('resolves built-in demo source mapping', () => {
    expect(resolveSelectedDemoKnowledge('demo_ecommerce')?.id).toBe(
      'demo-kb-ecommerce',
    );
    expect(resolveSelectedDemoKnowledge('demo_hr')?.id).toBe('demo-kb-hr');
    expect(resolveSelectedDemoKnowledge('database')).toBeNull();
  });
});
