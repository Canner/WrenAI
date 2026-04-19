import buildKnowledgeWorkbenchPageInteractionInputs from './buildKnowledgeWorkbenchPageInteractionInputs';

describe('buildKnowledgeWorkbenchPageInteractionInputs', () => {
  it('maps page-level local/runtime/controller-data state into controller-interaction inputs', () => {
    const args = {
      buildRuntimeScopeUrl: (path: string) => path,
      controllerDataState: {
        contentData: {
          assets: [],
          connectors: [],
          demoDatabaseOptions: [],
          demoTableOptions: [],
          diagramData: { diagram: {} },
          diagramLoading: false,
          isDemoSource: false,
          overviewPreviewAsset: null,
          routeRuntimeSyncing: false,
          selectedConnectorId: undefined,
          selectedDemoKnowledge: null,
          selectedDemoTable: undefined,
          setSelectedConnectorId: jest.fn(),
          setSelectedDemoTable: jest.fn(),
        },
        knowledgeState: {
          activeKnowledgeBase: {
            id: 'kb-1',
            name: 'Demo KB',
            slug: 'demo-kb',
            workspaceId: 'ws-1',
          },
          activeKnowledgeBaseExecutable: true,
          activeKnowledgeRuntimeSelector: { workspaceId: 'ws-1' },
          activeKnowledgeSnapshotId: 'snap-1',
          canCreateKnowledgeBase: true,
          createKnowledgeBaseBlockedReason: null,
          currentKnowledgeBaseId: 'kb-1',
          isKnowledgeMutationDisabled: false,
          isReadonlyKnowledgeBase: false,
          isSnapshotReadonlyKnowledgeBase: false,
          knowledgeBases: [],
          knowledgeOwner: 'owner',
          loadKnowledgeBases: jest.fn(async () => undefined),
          pendingKnowledgeBaseId: null,
          refetchRuntimeSelector: jest.fn(async () => undefined),
          routeKnowledgeBaseId: 'kb-1',
          ruleSqlCacheScopeKey: 'scope-1',
          setPendingKnowledgeBaseId: jest.fn(),
          setSelectedKnowledgeBaseId: jest.fn(),
        },
        modelingState: {
          committedModelingWorkspaceKey: 'ws-1:kb-1',
          modelingSummary: [],
        },
      },
      hasRuntimeScope: true,
      localState: {
        assetDraft: { name: '', description: '', important: true },
        detailAsset: null,
        detailFieldFilter: 'all',
        detailFieldKeyword: '',
        kbForm: {} as any,
        knowledgeTab: 'workspace',
        resetAssetDraft: jest.fn(),
        resetDetailViewState: jest.fn(),
        ruleForm: {} as any,
        setAssetDraft: jest.fn(),
        setAssetModalOpen: jest.fn(),
        setAssetWizardStep: jest.fn(),
        setDetailAsset: jest.fn(),
        setDraftAssets: jest.fn(),
        sqlTemplateForm: {} as any,
      },
      pushRoute: jest.fn(async () => true),
      replaceWorkspace: jest.fn(async () => undefined),
      router: {
        push: jest.fn(),
        replace: jest.fn(),
        query: {},
        asPath: '/knowledge',
      } as any,
      routerAsPath: '/knowledge',
      routerQuery: { knowledgeBaseId: 'kb-1' },
      snapshotReadonlyHint: 'readonly',
      runtimeNavigationSelector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      } as any,
    } as const;

    const inputs = buildKnowledgeWorkbenchPageInteractionInputs(args as any);

    expect(inputs).toEqual(
      expect.objectContaining({
        activeKnowledgeSnapshotId: 'snap-1',
        hasRuntimeScope: true,
        knowledgeTab: 'workspace',
        overviewPreviewAsset: null,
        snapshotReadonlyHint: 'readonly',
      }),
    );
  });
});
