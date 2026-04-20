import {
  shouldPrimeKnowledgeRuntimeScopeData,
  shouldSyncKnowledgeRuntimeScopeData,
} from './useKnowledgeRuntimeSync';

describe('useKnowledgeRuntimeSync helpers', () => {
  it('primes the first runtime scope key without triggering a sync loop', () => {
    expect(
      shouldPrimeKnowledgeRuntimeScopeData({
        runtimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-1',
        lastSyncedRuntimeScopeKey: null,
      }),
    ).toBe(true);

    expect(
      shouldPrimeKnowledgeRuntimeScopeData({
        runtimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-1',
        lastSyncedRuntimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-1',
      }),
    ).toBe(false);
  });

  it('only syncs when the runtime scope actually changes after priming', () => {
    expect(
      shouldSyncKnowledgeRuntimeScopeData({
        runtimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-2',
        lastSyncedRuntimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-1',
      }),
    ).toBe(true);

    expect(
      shouldSyncKnowledgeRuntimeScopeData({
        runtimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-1',
        lastSyncedRuntimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-1',
      }),
    ).toBe(false);
  });
});
