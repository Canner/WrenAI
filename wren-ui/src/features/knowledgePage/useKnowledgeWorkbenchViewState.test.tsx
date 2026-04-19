import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchViewState from './useKnowledgeWorkbenchViewState';

const mockUseKnowledgeWorkbenchPresentationState = jest.fn();
const mockUseKnowledgeWorkbenchSyncEffects = jest.fn();

jest.mock('./useKnowledgeWorkbenchPresentationState', () => ({
  __esModule: true,
  default: (...args: any[]) =>
    mockUseKnowledgeWorkbenchPresentationState(...args),
}));

jest.mock('./useKnowledgeWorkbenchSyncEffects', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeWorkbenchSyncEffects(...args),
}));

describe('useKnowledgeWorkbenchViewState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKnowledgeWorkbenchPresentationState.mockReturnValue({
      detailAssets: [{ id: 'asset-1', name: 'orders' }],
      activeWorkbenchSection: 'overview',
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchViewState>;

    const Harness = () => {
      current = useKnowledgeWorkbenchViewState({
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
        buildRuntimeScopeUrl: (path) => path,
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
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes asset workbench, navigation state and sync effects', () => {
    const hookValue = renderHookHarness();

    expect(hookValue.detailAssets).toEqual([{ id: 'asset-1', name: 'orders' }]);
    expect(hookValue.activeWorkbenchSection).toBe('overview');
    expect(mockUseKnowledgeWorkbenchPresentationState).toHaveBeenCalled();
    expect(mockUseKnowledgeWorkbenchSyncEffects).toHaveBeenCalled();
  });
});
