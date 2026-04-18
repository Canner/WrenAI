import {
  getKnowledgeLifecycleActionLabel,
  resolveKnowledgeNavBadgeCount,
  resolveVisibleKnowledgeBaseId,
  shouldCommitPendingKnowledgeBaseSwitch,
  shouldRouteSwitchKnowledgeBase,
  shouldShowKnowledgeAssetsLoading,
} from './useKnowledgePageHelpers';

describe('useKnowledgePageHelpers', () => {
  it('routes when switching to a different knowledge base', () => {
    expect(
      shouldRouteSwitchKnowledgeBase(
        {
          id: 'kb-2',
          defaultKbSnapshot: { id: 'snap-2', deployHash: 'deploy-2' },
        },
        'kb-1',
      ),
    ).toBe(true);
    expect(
      shouldRouteSwitchKnowledgeBase(
        {
          id: 'kb-1',
          defaultKbSnapshot: { id: 'snap-1', deployHash: 'deploy-1' },
        },
        'kb-1',
      ),
    ).toBe(false);
  });

  it('resolves visible kb id preferring pending', () => {
    expect(
      resolveVisibleKnowledgeBaseId({
        activeKnowledgeBaseId: 'kb-active',
        pendingKnowledgeBaseId: 'kb-pending',
      }),
    ).toBe('kb-pending');
  });

  it('computes pending-switch commit gate and loading gate', () => {
    expect(
      shouldCommitPendingKnowledgeBaseSwitch({
        currentKnowledgeBaseId: 'kb-1',
        routeKnowledgeBaseId: 'kb-1',
        pendingKnowledgeBaseId: 'kb-1',
        routeRuntimeSyncing: false,
      }),
    ).toBe(true);

    expect(
      shouldShowKnowledgeAssetsLoading({
        activeKnowledgeBaseUsesRuntime: true,
        assetCount: 0,
        diagramLoading: true,
        hasDiagramData: false,
        routeRuntimeSyncing: false,
      }),
    ).toBe(true);

    expect(
      shouldShowKnowledgeAssetsLoading({
        activeKnowledgeBaseUsesRuntime: true,
        assetCount: 3,
        diagramLoading: false,
        hasDiagramData: true,
        routeRuntimeSyncing: true,
      }),
    ).toBe(true);
  });

  it('resolves badge count and lifecycle action label', () => {
    expect(
      resolveKnowledgeNavBadgeCount({
        navKnowledgeBaseId: 'kb-1',
        activeKnowledgeBaseId: 'kb-1',
        activeAssetCount: 5,
        fallbackCount: 1,
      }),
    ).toBe(5);

    expect(getKnowledgeLifecycleActionLabel(null)).toBe('归档知识库');
    expect(getKnowledgeLifecycleActionLabel('2026-04-14T00:00:00.000Z')).toBe(
      '恢复知识库',
    );
  });
});
