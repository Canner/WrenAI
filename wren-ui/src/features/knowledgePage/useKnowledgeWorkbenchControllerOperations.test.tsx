import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchControllerOperations from './useKnowledgeWorkbenchControllerOperations';

const mockBuildKnowledgeWorkbenchActionsInputs = jest.fn();
const mockBuildKnowledgeWorkbenchRuleSqlInputs = jest.fn();
const mockUseKnowledgeWorkbenchActions = jest.fn();
const mockUseKnowledgeWorkbenchRuleSql = jest.fn();

jest.mock('./buildKnowledgeWorkbenchControllerActionsInputs', () => ({
  __esModule: true,
  buildKnowledgeWorkbenchActionsInputs: (...args: any[]) =>
    mockBuildKnowledgeWorkbenchActionsInputs(...args),
}));

jest.mock('./buildKnowledgeWorkbenchControllerRuleSqlInputs', () => ({
  __esModule: true,
  buildKnowledgeWorkbenchRuleSqlInputs: (...args: any[]) =>
    mockBuildKnowledgeWorkbenchRuleSqlInputs(...args),
}));

jest.mock('./useKnowledgeWorkbenchActions', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeWorkbenchActions(...args),
}));

jest.mock('./useKnowledgeWorkbenchRuleSql', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeWorkbenchRuleSql(...args),
}));

describe('useKnowledgeWorkbenchControllerOperations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildKnowledgeWorkbenchActionsInputs.mockReturnValue({
      currentKnowledgeBaseId: 'kb-1',
      snapshotReadonlyHint: 'readonly',
    });
    mockBuildKnowledgeWorkbenchRuleSqlInputs.mockReturnValue({
      cacheScopeKey: 'ws-1|kb-1',
      runtimeSelector: { workspaceId: 'ws-1' },
      ruleForm: {},
      sqlTemplateForm: {},
    });
    mockUseKnowledgeWorkbenchActions.mockReturnValue({
      openAssetWizard: jest.fn(),
      buildKnowledgeRuntimeSelector: jest.fn(() => ({ workspaceId: 'ws-1' })),
    });
    mockUseKnowledgeWorkbenchRuleSql.mockReturnValue({
      loadRuleList: jest.fn(async () => []),
      loadSqlList: jest.fn(async () => []),
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchControllerOperations>;

    const Harness = () => {
      current = useKnowledgeWorkbenchControllerOperations({
        activeKnowledgeBase: {
          id: 'kb-1',
          name: 'Demo KB',
          slug: 'demo-kb',
          workspaceId: 'ws-1',
        },
        activeKnowledgeRuntimeSelector: { workspaceId: 'ws-1' },
        buildRuntimeScopeUrl: (path) => path,
        canCreateKnowledgeBase: true,
        createKnowledgeBaseBlockedReason: '',
        currentKnowledgeBaseId: 'kb-1',
        isKnowledgeMutationDisabled: false,
        isReadonlyKnowledgeBase: false,
        isSnapshotReadonlyKnowledgeBase: false,
        kbForm: {} as any,
        loadKnowledgeBases: jest.fn(async () => []),
        pushRoute: jest.fn(),
        refetchRuntimeSelector: jest.fn(async () => undefined),
        resetAssetDraft: jest.fn(),
        router: { push: jest.fn() } as any,
        routerAsPath: '/knowledge',
        ruleForm: {} as any,
        ruleSqlCacheScopeKey: 'ws-1|kb-1',
        runtimeNavigationSelector: { workspaceId: 'ws-1' } as any,
        setAssetModalOpen: jest.fn(),
        setAssetWizardStep: jest.fn(),
        setDetailAsset: jest.fn(),
        setSelectedKnowledgeBaseId: jest.fn(),
        snapshotReadonlyHint: 'readonly',
        sqlTemplateForm: {} as any,
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes workbench actions and rule/sql state', () => {
    const hookValue = renderHookHarness();

    expect(mockBuildKnowledgeWorkbenchActionsInputs).toHaveBeenCalled();
    expect(mockBuildKnowledgeWorkbenchRuleSqlInputs).toHaveBeenCalled();
    expect(mockUseKnowledgeWorkbenchActions).toHaveBeenCalled();
    expect(mockUseKnowledgeWorkbenchRuleSql).toHaveBeenCalledWith({
      cacheScopeKey: 'ws-1|kb-1',
      runtimeSelector: { workspaceId: 'ws-1' },
      ruleForm: {},
      sqlTemplateForm: {},
    });
    expect(hookValue.actions.buildKnowledgeRuntimeSelector).toBeDefined();
    expect(hookValue.ruleSqlState.loadRuleList).toBeDefined();
  });
});
