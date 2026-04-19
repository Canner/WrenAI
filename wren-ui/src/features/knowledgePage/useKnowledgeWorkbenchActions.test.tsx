import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchActions from './useKnowledgeWorkbenchActions';

const mockUseKnowledgeBaseModal = jest.fn();
const mockUseKnowledgePageActions = jest.fn();
const mockUseKnowledgeRouteActions = jest.fn();
const mockUseKnowledgeBaseLifecycle = jest.fn();

jest.mock('@/hooks/useKnowledgeBaseModal', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeBaseModal(...args),
}));

jest.mock('@/hooks/useKnowledgePageActions', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgePageActions(...args),
}));

jest.mock('@/hooks/useKnowledgeRouteActions', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeRouteActions(...args),
}));

jest.mock('@/hooks/useKnowledgeBaseLifecycle', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeBaseLifecycle(...args),
}));

describe('useKnowledgeWorkbenchActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKnowledgeBaseModal.mockReturnValue({
      kbModalOpen: true,
      editingKnowledgeBase: { id: 'kb-1' },
      closeKnowledgeBaseModal: jest.fn(),
      openCreateKnowledgeBaseModal: jest.fn(),
      openEditKnowledgeBaseModal: jest.fn(),
    });
    mockUseKnowledgePageActions.mockReturnValue({
      closeAssetModal: jest.fn(),
      openConnectorConsole: jest.fn(),
      openAssetWizard: jest.fn(),
      buildKnowledgeRuntimeSelector: jest.fn(() => ({ workspaceId: 'ws-1' })),
    });
    mockUseKnowledgeRouteActions.mockReturnValue({
      replaceKnowledgeRoute: jest.fn(),
      clearDetailAsset: jest.fn(),
    });
    mockUseKnowledgeBaseLifecycle.mockReturnValue({
      creatingKnowledgeBase: false,
      handleSaveKnowledgeBase: jest.fn(),
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchActions>;

    const Harness = () => {
      current = useKnowledgeWorkbenchActions({
        activeKnowledgeBase: {
          id: 'kb-1',
          name: 'Demo KB',
          slug: 'demo-kb',
          workspaceId: 'ws-1',
        },
        buildRuntimeScopeUrl: (path) => path,
        canCreateKnowledgeBase: true,
        createKnowledgeBaseBlockedReason: '',
        currentKnowledgeBaseId: 'kb-1',
        isKnowledgeMutationDisabled: false,
        isReadonlyKnowledgeBase: false,
        isSnapshotReadonlyKnowledgeBase: false,
        kbForm: {
          resetFields: jest.fn(),
          setFieldsValue: jest.fn(),
          validateFields: jest.fn(),
        },
        loadKnowledgeBases: jest.fn(async () => []),
        openModalSafely: (action) => action(),
        pushRoute: jest.fn(async () => undefined),
        refetchRuntimeSelector: jest.fn(async () => undefined),
        resolveLifecycleActionLabel: () => '归档',
        resetAssetDraft: jest.fn(),
        router: { replace: jest.fn(async () => true) },
        routerAsPath: '/knowledge',
        runtimeNavigationSelector: { workspaceId: 'ws-1' },
        setAssetModalOpen: jest.fn(),
        setAssetWizardStep: jest.fn(),
        setDetailAsset: jest.fn(),
        setSelectedKnowledgeBaseId: jest.fn(),
        snapshotReadonlyHint: 'readonly',
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes modal, route and lifecycle hooks into a unified workbench action surface', () => {
    const hookValue = renderHookHarness();

    expect(hookValue.kbModalOpen).toBe(true);
    expect(hookValue.editingKnowledgeBase).toEqual({ id: 'kb-1' });
    expect(hookValue.creatingKnowledgeBase).toBe(false);
    expect(mockUseKnowledgeBaseModal).toHaveBeenCalled();
    expect(mockUseKnowledgePageActions).toHaveBeenCalled();
    expect(mockUseKnowledgeRouteActions).toHaveBeenCalled();
    expect(mockUseKnowledgeBaseLifecycle).toHaveBeenCalled();
  });
});
