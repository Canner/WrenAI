import buildKnowledgeWorkbenchPresentationStateInputs from './buildKnowledgeWorkbenchPresentationStateInputs';
import buildKnowledgeWorkbenchSyncEffectsInputs from './buildKnowledgeWorkbenchSyncEffectsInputs';

describe('buildKnowledgeWorkbenchViewStateInputs', () => {
  const baseArgs = {
    activeKnowledgeBase: {
      id: 'kb-1',
      name: 'Demo KB',
      slug: 'demo-kb',
      workspaceId: 'ws-1',
    },
    activeKnowledgeBaseExecutable: true,
    activeKnowledgeSnapshotId: 'snap-1',
    assetDraft: { name: '', description: '', important: true },
    assets: [],
    buildKnowledgeRuntimeSelector: jest.fn(() => ({ workspaceId: 'ws-1' })),
    buildRuntimeScopeUrl: (path: string) => path,
    connectors: [],
    currentKnowledgeBaseId: 'kb-1',
    demoDatabaseOptions: [],
    demoTableOptions: [],
    detailAsset: null,
    detailFieldFilter: 'all',
    detailFieldKeyword: '',
    diagramData: { diagram: {} },
    diagramLoading: false,
    hasRuntimeScope: true,
    isDemoSource: false,
    knowledgeBases: [],
    knowledgeOwner: 'owner',
    knowledgeTab: 'workspace',
    loadRuleList: jest.fn(async () => undefined),
    loadSqlList: jest.fn(async () => undefined),
    openAssetWizard: jest.fn(),
    overviewPreviewAsset: null,
    pendingKnowledgeBaseId: null,
    refetchReady: true,
    replaceWorkspace: jest.fn(async () => undefined),
    resetAssetDraft: jest.fn(),
    resetDetailViewState: jest.fn(),
    resetRuleSqlManagerState: jest.fn(),
    routeKnowledgeBaseId: 'kb-1',
    routeRuntimeSyncing: false,
    routerQuery: { knowledgeBaseId: 'kb-1' },
    selectedConnectorId: undefined,
    selectedDemoKnowledge: null,
    selectedDemoTable: undefined,
    setAssetDraft: jest.fn(),
    setAssetModalOpen: jest.fn(),
    setAssetWizardStep: jest.fn(),
    setDetailAsset: jest.fn(),
    setDraftAssets: jest.fn(),
    setPendingKnowledgeBaseId: jest.fn(),
    setSelectedConnectorId: jest.fn(),
    setSelectedDemoTable: jest.fn(),
    setSelectedKnowledgeBaseId: jest.fn(),
  } as any;

  it('builds presentation-state inputs without sync-only fields', () => {
    const inputs = buildKnowledgeWorkbenchPresentationStateInputs(baseArgs);

    expect(inputs).toEqual(
      expect.objectContaining({
        activeKnowledgeBase: baseArgs.activeKnowledgeBase,
        buildKnowledgeRuntimeSelector: baseArgs.buildKnowledgeRuntimeSelector,
        openAssetWizard: baseArgs.openAssetWizard,
        setDraftAssets: baseArgs.setDraftAssets,
      }),
    );
    expect(inputs).not.toHaveProperty('activeKnowledgeSnapshotId');
    expect(inputs).not.toHaveProperty('loadRuleList');
  });

  it('builds sync-effects inputs with derived active knowledge base id', () => {
    const inputs = buildKnowledgeWorkbenchSyncEffectsInputs(baseArgs);

    expect(inputs).toEqual(
      expect.objectContaining({
        activeKnowledgeBaseId: 'kb-1',
        activeKnowledgeSnapshotId: 'snap-1',
        currentKnowledgeBaseId: 'kb-1',
        loadRuleList: baseArgs.loadRuleList,
        setSelectedKnowledgeBaseId: baseArgs.setSelectedKnowledgeBaseId,
      }),
    );
    expect(inputs).not.toHaveProperty('buildKnowledgeRuntimeSelector');
    expect(inputs).not.toHaveProperty('knowledgeTab');
  });
});
