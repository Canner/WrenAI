import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchPageInteractionState from './useKnowledgeWorkbenchPageInteractionState';

const mockBuildKnowledgeWorkbenchPageInteractionInputs = jest.fn();
const mockUseKnowledgeWorkbenchControllerInteractionState = jest.fn();

jest.mock('./buildKnowledgeWorkbenchPageInteractionInputs', () => ({
  __esModule: true,
  default: (...args: any[]) =>
    mockBuildKnowledgeWorkbenchPageInteractionInputs(...args),
}));

jest.mock('./useKnowledgeWorkbenchControllerInteractionState', () => ({
  __esModule: true,
  default: (...args: any[]) =>
    mockUseKnowledgeWorkbenchControllerInteractionState(...args),
}));

describe('useKnowledgeWorkbenchPageInteractionState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildKnowledgeWorkbenchPageInteractionInputs.mockReturnValue({
      activeKnowledgeSnapshotId: 'snap-1',
      hasRuntimeScope: true,
      knowledgeTab: 'workspace',
      snapshotReadonlyHint: 'readonly',
    });
    mockUseKnowledgeWorkbenchControllerInteractionState.mockReturnValue({
      actions: { openAssetWizard: jest.fn() },
      ruleSqlState: { loadRuleList: jest.fn() },
      viewState: { activeWorkbenchSection: 'overview' },
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchPageInteractionState>;

    const Harness = () => {
      current = useKnowledgeWorkbenchPageInteractionState({
        buildRuntimeScopeUrl: (path) => path,
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
        } as any,
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
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('maps page-level local/runtime state into controller interaction inputs', () => {
    const hookValue = renderHookHarness();

    expect(hookValue.viewState.activeWorkbenchSection).toBe('overview');
    expect(mockBuildKnowledgeWorkbenchPageInteractionInputs).toHaveBeenCalled();
    expect(
      mockUseKnowledgeWorkbenchControllerInteractionState,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        activeKnowledgeSnapshotId: 'snap-1',
        hasRuntimeScope: true,
        knowledgeTab: 'workspace',
        snapshotReadonlyHint: 'readonly',
      }),
    );
  });
});
