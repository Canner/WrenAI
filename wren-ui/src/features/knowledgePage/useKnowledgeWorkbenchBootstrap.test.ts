import { shouldBootstrapKnowledgeRuleSqlLists } from './useKnowledgeWorkbenchBootstrap';

describe('useKnowledgeWorkbenchBootstrap helpers', () => {
  it('requires an active knowledge base id before bootstrapping', () => {
    expect(
      shouldBootstrapKnowledgeRuleSqlLists({
        activeKnowledgeBaseId: null,
        hasRuntimeScope: true,
        routeRuntimeSyncing: false,
      }),
    ).toBe(false);
  });

  it('requires runtime scope to be available', () => {
    expect(
      shouldBootstrapKnowledgeRuleSqlLists({
        activeKnowledgeBaseId: 'kb-1',
        hasRuntimeScope: false,
        routeRuntimeSyncing: false,
      }),
    ).toBe(false);
  });

  it('waits until runtime syncing finishes', () => {
    expect(
      shouldBootstrapKnowledgeRuleSqlLists({
        activeKnowledgeBaseId: 'kb-1',
        hasRuntimeScope: true,
        routeRuntimeSyncing: true,
      }),
    ).toBe(false);
  });

  it('allows bootstrapping when kb/runtime are ready and syncing is idle', () => {
    expect(
      shouldBootstrapKnowledgeRuleSqlLists({
        activeKnowledgeBaseId: 'kb-1',
        hasRuntimeScope: true,
        routeRuntimeSyncing: false,
      }),
    ).toBe(true);
  });
});
