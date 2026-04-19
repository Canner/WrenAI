import buildKnowledgeWorkbenchControllerViewInputs from './buildKnowledgeWorkbenchControllerViewInputs';

describe('buildKnowledgeWorkbenchControllerViewInputs', () => {
  it('derives view-state inputs from actions and rule/sql state', () => {
    const inputs = buildKnowledgeWorkbenchControllerViewInputs({
      actions: {
        buildKnowledgeRuntimeSelector: jest.fn(() => ({
          workspaceId: 'ws-1',
        })),
        openAssetWizard: jest.fn(),
      } as any,
      ruleSqlState: {
        loadRuleList: jest.fn(async () => []),
        loadSqlList: jest.fn(async () => []),
        resetRuleSqlManagerState: jest.fn(),
      } as any,
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
      overviewPreviewAsset: null,
      pendingKnowledgeBaseId: null,
      replaceWorkspace: jest.fn(async () => undefined),
      resetAssetDraft: jest.fn(),
      resetDetailViewState: jest.fn(),
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
    } as any);

    expect(inputs).toEqual(
      expect.objectContaining({
        loadRuleList: expect.any(Function),
        loadSqlList: expect.any(Function),
        openAssetWizard: expect.any(Function),
        refetchReady: true,
      }),
    );
  });
});
