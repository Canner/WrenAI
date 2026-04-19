import buildKnowledgeWorkbenchContentDataInputs from './buildKnowledgeWorkbenchContentDataInputs';
import buildKnowledgeWorkbenchKnowledgeStateInputs from './buildKnowledgeWorkbenchKnowledgeStateInputs';
import buildKnowledgeWorkbenchModelingStateInputs from './buildKnowledgeWorkbenchModelingStateInputs';

describe('buildKnowledgeWorkbenchControllerDataStateInputs', () => {
  const baseArgs = {
    assetModalOpen: false,
    buildRuntimeScopeUrl: (path: string) => path,
    draftAssets: [],
    hasRuntimeScope: true,
    routerAsPath: '/knowledge',
    routerQuery: { knowledgeBaseId: 'kb-1' },
    routerReady: true,
    runtimeNavigationWorkspaceId: 'ws-1',
    runtimeTransitioning: false,
    transitionTo: jest.fn(async () => undefined),
  } as any;

  const knowledgeState = {
    activeKnowledgeBase: {
      id: 'kb-1',
      name: 'Demo KB',
      slug: 'demo-kb',
      workspaceId: 'ws-1',
    },
    activeKnowledgeBaseExecutable: true,
    activeKnowledgeRuntimeSelector: { workspaceId: 'ws-1' },
    activeKnowledgeSnapshotId: 'snap-1',
    fetchConnectors: jest.fn(),
    handleConnectorLoadError: jest.fn(),
    initialKnowledgeSourceType: 'database',
    knowledgeOwner: 'owner',
    knowledgeSourceOptions: [],
    matchedDemoKnowledge: null,
    refetchRuntimeSelector: jest.fn(async () => undefined),
    runtimeSyncScopeKey: 'ws-1|kb-1',
    runtimeSelectorState: { currentKbSnapshot: { deployHash: 'deploy-1' } },
  } as any;

  const contentData = {
    diagramData: { diagram: {} },
    routeRuntimeSyncing: false,
  } as any;

  it('builds knowledge-state inputs with the readonly hint injected', () => {
    const inputs = buildKnowledgeWorkbenchKnowledgeStateInputs(baseArgs);

    expect(inputs).toEqual(
      expect.objectContaining({
        buildRuntimeScopeUrl: baseArgs.buildRuntimeScopeUrl,
        routerAsPath: '/knowledge',
        runtimeNavigationWorkspaceId: 'ws-1',
        snapshotReadonlyHint: expect.any(String),
      }),
    );
  });

  it('builds content-data inputs from base args and knowledge state', () => {
    const inputs = buildKnowledgeWorkbenchContentDataInputs(
      baseArgs,
      knowledgeState,
    );

    expect(inputs).toEqual(
      expect.objectContaining({
        activeKnowledgeBaseExecutable: true,
        activeKnowledgeSnapshotId: 'snap-1',
        runtimeTransitioning: false,
        refetchRuntimeSelector: knowledgeState.refetchRuntimeSelector,
      }),
    );
  });

  it('builds modeling-state inputs from knowledge/content state', () => {
    const inputs = buildKnowledgeWorkbenchModelingStateInputs(
      knowledgeState,
      contentData,
    );

    expect(inputs).toEqual({
      activeKnowledgeBaseId: 'kb-1',
      activeKnowledgeSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      diagramData: { diagram: {} },
      routeRuntimeSyncing: false,
    });
  });
});
