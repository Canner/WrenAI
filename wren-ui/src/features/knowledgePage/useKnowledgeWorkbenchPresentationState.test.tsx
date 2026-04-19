import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchPresentationState from './useKnowledgeWorkbenchPresentationState';

const mockUseKnowledgeAssetWorkbench = jest.fn();
const mockUseKnowledgeWorkbenchNavigationState = jest.fn();

jest.mock('./useKnowledgeAssetWorkbench', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeAssetWorkbench(...args),
}));

jest.mock('./useKnowledgeWorkbenchNavigationState', () => ({
  __esModule: true,
  default: (...args: any[]) =>
    mockUseKnowledgeWorkbenchNavigationState(...args),
}));

describe('useKnowledgeWorkbenchPresentationState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKnowledgeAssetWorkbench.mockReturnValue({
      detailAssets: [{ id: 'asset-1', name: 'orders' }],
      visibleKnowledgeBaseId: 'kb-1',
    });
    mockUseKnowledgeWorkbenchNavigationState.mockReturnValue({
      activeWorkbenchSection: 'overview',
      visibleKnowledgeItems: [{ id: 'kb-1' }],
      handleChangeWorkbenchSection: jest.fn(),
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchPresentationState>;

    const Harness = () => {
      current = useKnowledgeWorkbenchPresentationState({
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
        buildRuntimeScopeUrl: (path) => path,
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
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes asset workbench and navigation state', () => {
    const hookValue = renderHookHarness();

    expect(hookValue.detailAssets).toEqual([{ id: 'asset-1', name: 'orders' }]);
    expect(hookValue.activeWorkbenchSection).toBe('overview');
    expect(mockUseKnowledgeAssetWorkbench).toHaveBeenCalled();
    expect(mockUseKnowledgeWorkbenchNavigationState).toHaveBeenCalled();
  });
});
