import buildKnowledgeAssetWorkbenchInputs from './buildKnowledgeAssetWorkbenchInputs';
import buildKnowledgeWorkbenchNavigationStateInputs from './buildKnowledgeWorkbenchNavigationStateInputs';

describe('buildKnowledgeWorkbenchPresentationStateInputs', () => {
  const baseArgs = {
    activeKnowledgeBase: {
      id: 'kb-1',
      name: 'Demo KB',
      slug: 'demo-kb',
      workspaceId: 'ws-1',
    },
    activeKnowledgeBaseExecutable: true,
    assetDraft: { name: '', description: '', important: true },
    assets: [],
    buildKnowledgeRuntimeSelector: jest.fn(() => ({ workspaceId: 'ws-1' })),
    buildRuntimeScopeUrl: (path: string) => path,
    connectors: [],
    demoDatabaseOptions: [],
    demoTableOptions: [],
    detailAsset: null,
    detailFieldFilter: 'all',
    detailFieldKeyword: '',
    diagramData: { diagram: {} },
    diagramLoading: false,
    isDemoSource: false,
    knowledgeBases: [],
    knowledgeOwner: 'owner',
    knowledgeTab: 'workspace',
    openAssetWizard: jest.fn(),
    overviewPreviewAsset: null,
    pendingKnowledgeBaseId: null,
    replaceWorkspace: jest.fn(async () => undefined),
    resetDetailViewState: jest.fn(),
    routeRuntimeSyncing: false,
    routerQuery: { knowledgeBaseId: 'kb-1' },
    selectedConnectorId: undefined,
    selectedDemoKnowledge: null,
    selectedDemoTable: undefined,
    setAssetDraft: jest.fn(),
    setAssetWizardStep: jest.fn(),
    setDetailAsset: jest.fn(),
    setDraftAssets: jest.fn(),
  } as any;

  it('builds asset workbench inputs with derived active knowledge base id', () => {
    const inputs = buildKnowledgeAssetWorkbenchInputs(baseArgs);

    expect(inputs).toEqual(
      expect.objectContaining({
        activeKnowledgeBaseExecutable: true,
        activeKnowledgeBaseId: 'kb-1',
        knowledgeOwner: 'owner',
        setDraftAssets: baseArgs.setDraftAssets,
      }),
    );
    expect(inputs).not.toHaveProperty('buildKnowledgeRuntimeSelector');
    expect(inputs).not.toHaveProperty('replaceWorkspace');
  });

  it('builds navigation inputs with only routing/sidebar fields', () => {
    const inputs = buildKnowledgeWorkbenchNavigationStateInputs(baseArgs);

    expect(inputs).toEqual(
      expect.objectContaining({
        activeKnowledgeBase: baseArgs.activeKnowledgeBase,
        buildKnowledgeRuntimeSelector: baseArgs.buildKnowledgeRuntimeSelector,
        buildRuntimeScopeUrl: baseArgs.buildRuntimeScopeUrl,
        knowledgeTab: 'workspace',
      }),
    );
    expect(inputs).not.toHaveProperty('detailFieldKeyword');
    expect(inputs).not.toHaveProperty('knowledgeOwner');
  });
});
