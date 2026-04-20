import buildKnowledgeWorkbenchAssetsInputs from './buildKnowledgeWorkbenchAssetsInputs';
import buildKnowledgeWorkbenchConnectorsInputs from './buildKnowledgeWorkbenchConnectorsInputs';
import buildKnowledgeWorkbenchDiagramInputs from './buildKnowledgeWorkbenchDiagramInputs';
import buildKnowledgeWorkbenchRuntimeDataSyncInputs from './buildKnowledgeWorkbenchRuntimeDataSyncInputs';

describe('buildKnowledgeWorkbenchContentDataHookInputs', () => {
  const baseArgs = {
    activeKnowledgeBase: {
      id: 'kb-1',
      name: 'Demo KB',
      slug: 'demo-kb',
      workspaceId: 'ws-1',
    },
    activeKnowledgeBaseExecutable: true,
    activeKnowledgeRuntimeSelector: {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
    },
    activeKnowledgeSnapshotId: 'snapshot-1',
    assetModalOpen: true,
    draftAssets: [{ id: 'draft-1', name: 'orders' }],
    fetchConnectors: jest.fn(async () => []),
    handleConnectorLoadError: jest.fn(),
    hasRuntimeScope: true,
    initialKnowledgeSourceType: 'database',
    knowledgeOwner: 'owner',
    knowledgeSourceOptions: [
      {
        key: 'database',
        category: 'connector',
        label: 'Database',
        icon: 'db',
        meta: 'connector',
      },
    ],
    matchedDemoKnowledge: {
      id: 'demo-1',
      assetName: 'orders',
      description: 'Orders demo',
      fields: [],
      suggestedQuestions: [],
    },
    refetchRuntimeSelector: jest.fn(async () => undefined),
    runtimeSyncScopeKey: 'sync-key',
    runtimeTransitioning: false,
  } as any;

  it('builds connector inputs from active knowledge runtime state', () => {
    const inputs = buildKnowledgeWorkbenchConnectorsInputs(baseArgs);

    expect(inputs).toEqual(
      expect.objectContaining({
        hasRuntimeScope: true,
        activeWorkspaceId: 'ws-1',
        connectorRuntimeSelector: { workspaceId: 'ws-1' },
        assetModalOpen: true,
        fetchConnectors: baseArgs.fetchConnectors,
        onLoadError: baseArgs.handleConnectorLoadError,
      }),
    );
  });

  it('builds diagram inputs from the selected knowledge base and snapshot', () => {
    const inputs = buildKnowledgeWorkbenchDiagramInputs(baseArgs);

    expect(inputs).toEqual({
      hasRuntimeScope: true,
      routeKnowledgeBaseId: 'kb-1',
      routeKbSnapshotId: 'snapshot-1',
      effectiveRuntimeSelector: baseArgs.activeKnowledgeRuntimeSelector,
    });
  });

  it('builds runtime-data sync inputs from selector and diagram refetch callbacks', () => {
    const refetchDiagram = jest.fn(async () => null);

    const inputs = buildKnowledgeWorkbenchRuntimeDataSyncInputs(baseArgs, {
      refetchDiagram,
    });

    expect(inputs).toEqual({
      runtimeSyncScopeKey: 'sync-key',
      refetchRuntimeSelector: baseArgs.refetchRuntimeSelector,
      refetchDiagram,
    });
  });

  it('builds asset inputs with derived active knowledge metadata', () => {
    const inputs = buildKnowledgeWorkbenchAssetsInputs(baseArgs, {
      diagramData: { diagram: { models: [] } } as any,
    });

    expect(inputs).toEqual({
      activeKnowledgeBaseName: 'Demo KB',
      hasActiveKnowledgeBase: true,
      activeKnowledgeBaseUsesRuntime: true,
      diagramData: { diagram: { models: [] } },
      draftAssets: baseArgs.draftAssets,
      knowledgeOwner: 'owner',
      matchedDemoKnowledge: baseArgs.matchedDemoKnowledge,
    });
  });
});
