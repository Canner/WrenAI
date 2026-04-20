import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeAssetWorkbench from './useKnowledgeAssetWorkbench';

const mockRouterReplace = jest.fn().mockResolvedValue(true);
const mockRouterPush = jest.fn().mockResolvedValue(true);
const mockUseKnowledgeAssetSelectOptions = jest.fn();
const mockUseKnowledgeConnectorTables = jest.fn();
const mockUseKnowledgeDerivedCollections = jest.fn();
const mockUseKnowledgeAssetWizard = jest.fn();
const mockUseKnowledgeAssetInteractions = jest.fn();
const mockUseKnowledgeAssetDetail = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();

jest.mock('@/hooks/useKnowledgeAssetSelectOptions', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeAssetSelectOptions(...args),
}));

jest.mock('@/hooks/useKnowledgeConnectorTables', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeConnectorTables(...args),
}));

jest.mock('@/hooks/useKnowledgeDerivedCollections', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeDerivedCollections(...args),
}));

jest.mock('@/hooks/useKnowledgeAssetWizard', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeAssetWizard(...args),
}));

jest.mock('@/hooks/useKnowledgeAssetInteractions', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeAssetInteractions(...args),
}));

jest.mock('@/hooks/useKnowledgeAssetDetail', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeAssetDetail(...args),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRuntimeSelectorState(...args),
}));

jest.mock('next/router', () => ({
  useRouter: () => ({
    pathname: '/knowledge',
    query: {
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    },
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
}));

describe('useKnowledgeAssetWorkbench', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouterPush.mockResolvedValue(true);
    mockRouterReplace.mockResolvedValue(true);
    mockUseKnowledgeAssetSelectOptions.mockReturnValue({
      assetDatabaseOptions: [{ label: 'Warehouse', value: 'c1' }],
      assetTableOptions: [{ label: 'orders', value: 'orders' }],
    });
    mockUseKnowledgeConnectorTables.mockReturnValue({
      connectorTables: [{ name: 'orders', columns: [] }],
      connectorTablesLoading: false,
    });
    mockUseKnowledgeDerivedCollections.mockReturnValue({
      wizardPreviewAssets: [{ id: 'asset-1', name: 'orders' }],
      visibleKnowledgeBaseId: 'kb-1',
      detailAssets: [{ id: 'asset-1', name: 'orders' }],
      showKnowledgeAssetsLoading: false,
    });
    mockUseKnowledgeAssetWizard.mockReturnValue({
      assetDraftPreview: { id: 'draft-1', name: 'draft orders' },
      assetDraftPreviews: [{ id: 'draft-1', name: 'draft orders' }],
      canContinueAssetConfiguration: true,
      moveAssetWizardToConfig: jest.fn(),
      saveAssetDraftToOverview: jest.fn(() => ({ id: 'asset-2' })),
    });
    mockUseKnowledgeAssetInteractions.mockReturnValue({
      commitAssetDraftToOverview: jest.fn(),
      openAssetDetail: jest.fn(),
      savingAssetDraft: false,
    });
    mockUseKnowledgeAssetDetail.mockReturnValue({
      activeDetailAsset: { id: 'asset-1', name: 'orders' },
      detailAssetFields: [{ fieldName: 'order_id' }],
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      refetch: jest.fn().mockResolvedValue({}),
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeAssetWorkbench>;

    const Harness = () => {
      current = useKnowledgeAssetWorkbench({
        activeKnowledgeBaseExecutable: true,
        activeKnowledgeBaseId: 'kb-1',
        activeKnowledgeRuntimeSelector: {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
        },
        assetDraft: {
          name: '',
          description: '',
          important: true,
        },
        assets: [],
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
        knowledgeOwner: 'owner',
        openModalSafely: (action) => action(),
        overviewPreviewAsset: null,
        pendingKnowledgeBaseId: null,
        resetDetailViewState: jest.fn(),
        routeRuntimeSyncing: false,
        refetchDiagram: jest.fn(async () => null),
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

  it('composes asset workbench hooks and returns their aggregated outputs', () => {
    const hookValue = renderHookHarness();

    expect(hookValue.assetDatabaseOptions).toEqual([
      { label: 'Warehouse', value: 'c1' },
    ]);
    expect(hookValue.visibleKnowledgeBaseId).toBe('kb-1');
    expect(hookValue.assetDraftPreview).toEqual({
      id: 'draft-1',
      name: 'draft orders',
    });
    expect(hookValue.assetDraftPreviews).toEqual([
      {
        id: 'draft-1',
        name: 'draft orders',
      },
    ]);
    expect(hookValue.activeDetailAsset).toEqual({
      id: 'asset-1',
      name: 'orders',
    });
    expect(mockUseKnowledgeAssetSelectOptions).toHaveBeenCalled();
    expect(mockUseKnowledgeConnectorTables).toHaveBeenCalled();
    expect(mockUseKnowledgeDerivedCollections).toHaveBeenCalled();
    expect(mockUseKnowledgeAssetWizard).toHaveBeenCalled();
    expect(mockUseKnowledgeAssetInteractions).toHaveBeenCalled();
    expect(mockUseKnowledgeAssetDetail).toHaveBeenCalled();
  });

  it('replaces runtime scope with shallow routing during connector imports', async () => {
    renderHookHarness();

    const wizardArgs = mockUseKnowledgeAssetWizard.mock.calls[0]?.[0];
    expect(wizardArgs?.replaceRuntimeScope).toBeInstanceOf(Function);

    await wizardArgs.replaceRuntimeScope({
      workspaceId: 'ws-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snapshot-2',
      deployHash: 'deploy-2',
    });

    expect(mockRouterReplace).toHaveBeenCalledWith('/knowledge', undefined, {
      scroll: false,
      shallow: true,
    });
  });
});
