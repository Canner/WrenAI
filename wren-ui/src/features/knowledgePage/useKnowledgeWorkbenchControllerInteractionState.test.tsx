import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchControllerInteractionState from './useKnowledgeWorkbenchControllerInteractionState';

const mockBuildKnowledgeWorkbenchControllerOperationsInputs = jest.fn();
const mockBuildKnowledgeWorkbenchControllerViewStateInputs = jest.fn();
const mockUseKnowledgeWorkbenchControllerOperations = jest.fn();
const mockUseKnowledgeWorkbenchControllerViewState = jest.fn();

jest.mock(
  './buildKnowledgeWorkbenchControllerInteractionOperationInputs',
  () => ({
    __esModule: true,
    buildKnowledgeWorkbenchControllerOperationsInputs: (...args: any[]) =>
      mockBuildKnowledgeWorkbenchControllerOperationsInputs(...args),
  }),
);

jest.mock('./buildKnowledgeWorkbenchControllerInteractionViewInputs', () => ({
  __esModule: true,
  buildKnowledgeWorkbenchControllerViewStateInputs: (...args: any[]) =>
    mockBuildKnowledgeWorkbenchControllerViewStateInputs(...args),
}));

jest.mock('./useKnowledgeWorkbenchControllerOperations', () => ({
  __esModule: true,
  default: (...args: any[]) =>
    mockUseKnowledgeWorkbenchControllerOperations(...args),
}));

jest.mock('./useKnowledgeWorkbenchControllerViewState', () => ({
  __esModule: true,
  default: (...args: any[]) =>
    mockUseKnowledgeWorkbenchControllerViewState(...args),
}));

describe('useKnowledgeWorkbenchControllerInteractionState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildKnowledgeWorkbenchControllerOperationsInputs.mockReturnValue({
      activeKnowledgeRuntimeSelector: { workspaceId: 'ws-1' },
      snapshotReadonlyHint: 'readonly',
    });
    mockBuildKnowledgeWorkbenchControllerViewStateInputs.mockReturnValue({
      actions: {
        buildKnowledgeRuntimeSelector: jest.fn(() => ({ workspaceId: 'ws-1' })),
        openAssetWizard: jest.fn(),
      },
      ruleSqlState: {
        loadRuleList: jest.fn(async () => []),
        loadSqlList: jest.fn(async () => []),
        resetRuleSqlManagerState: jest.fn(),
      },
      activeKnowledgeSnapshotId: 'snap-1',
    });
    mockUseKnowledgeWorkbenchControllerOperations.mockReturnValue({
      actions: {
        buildKnowledgeRuntimeSelector: jest.fn(() => ({ workspaceId: 'ws-1' })),
        openAssetWizard: jest.fn(),
      },
      ruleSqlState: {
        loadRuleList: jest.fn(async () => []),
        loadSqlList: jest.fn(async () => []),
        resetRuleSqlManagerState: jest.fn(),
      },
    });
    mockUseKnowledgeWorkbenchControllerViewState.mockReturnValue({
      activeWorkbenchSection: 'overview',
      visibleKnowledgeItems: [],
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<
      typeof useKnowledgeWorkbenchControllerInteractionState
    >;

    const Harness = () => {
      current = useKnowledgeWorkbenchControllerInteractionState({
        activeKnowledgeBase: {
          id: 'kb-1',
          name: 'Demo KB',
          slug: 'demo-kb',
          workspaceId: 'ws-1',
        },
        activeKnowledgeBaseExecutable: true,
        activeKnowledgeRuntimeSelector: { workspaceId: 'ws-1' },
        activeKnowledgeSnapshotId: 'snap-1',
        assetDraft: { name: '', description: '', important: true },
        assets: [],
        buildRuntimeScopeUrl: (path) => path,
        canCreateKnowledgeBase: true,
        createKnowledgeBaseBlockedReason: '',
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
        isKnowledgeMutationDisabled: false,
        isReadonlyKnowledgeBase: false,
        isSnapshotReadonlyKnowledgeBase: false,
        kbForm: {} as any,
        knowledgeBases: [],
        knowledgeOwner: 'owner',
        knowledgeTab: 'workspace',
        loadKnowledgeBases: jest.fn(async () => []),
        overviewPreviewAsset: null,
        pendingKnowledgeBaseId: null,
        pushRoute: jest.fn(),
        refetchRuntimeSelector: jest.fn(async () => undefined),
        replaceWorkspace: jest.fn(async () => undefined),
        resetAssetDraft: jest.fn(),
        resetDetailViewState: jest.fn(),
        routeKnowledgeBaseId: 'kb-1',
        routeRuntimeSyncing: false,
        router: { push: jest.fn() } as any,
        routerAsPath: '/knowledge',
        routerQuery: { knowledgeBaseId: 'kb-1' },
        ruleForm: {} as any,
        ruleSqlCacheScopeKey: 'ws-1|kb-1',
        runtimeNavigationSelector: { workspaceId: 'ws-1' } as any,
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
        snapshotReadonlyHint: 'readonly',
        sqlTemplateForm: {} as any,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes controller operations and controller view state', () => {
    const hookValue = renderHookHarness();

    expect(hookValue.viewState.activeWorkbenchSection).toBe('overview');
    expect(
      mockBuildKnowledgeWorkbenchControllerOperationsInputs,
    ).toHaveBeenCalled();
    expect(
      mockBuildKnowledgeWorkbenchControllerViewStateInputs,
    ).toHaveBeenCalled();
    expect(mockUseKnowledgeWorkbenchControllerOperations).toHaveBeenCalled();
    expect(mockUseKnowledgeWorkbenchControllerViewState).toHaveBeenCalled();
  });
});
