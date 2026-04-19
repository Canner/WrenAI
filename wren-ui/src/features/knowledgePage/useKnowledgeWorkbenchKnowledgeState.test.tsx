import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import useKnowledgeWorkbenchKnowledgeState from './useKnowledgeWorkbenchKnowledgeState';

const mockUseAuthSession = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
const mockUseKnowledgeRuntimeContext = jest.fn();
const mockUseKnowledgeBaseListCache = jest.fn();
const mockUseKnowledgeSelectorFallback = jest.fn();
const mockUseKnowledgeDataLoaders = jest.fn();
const mockUseKnowledgeBaseSelection = jest.fn();
const mockUseKnowledgeBaseMeta = jest.fn();
const mockUseKnowledgeRuntimeBindings = jest.fn();

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseAuthSession(...args),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseRuntimeSelectorState(...args),
}));

jest.mock('@/hooks/useKnowledgeRuntimeContext', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeRuntimeContext(...args),
}));

jest.mock('@/hooks/useKnowledgeBaseListCache', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeBaseListCache(...args),
}));

jest.mock('@/hooks/useKnowledgeSelectorFallback', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeSelectorFallback(...args),
}));

jest.mock('@/hooks/useKnowledgeDataLoaders', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeDataLoaders(...args),
}));

jest.mock('@/hooks/useKnowledgeBaseSelection', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeBaseSelection(...args),
}));

jest.mock('@/hooks/useKnowledgeBaseMeta', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeBaseMeta(...args),
}));

jest.mock('./useKnowledgeRuntimeBindings', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseKnowledgeRuntimeBindings(...args),
}));

describe('useKnowledgeWorkbenchKnowledgeState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthSession.mockReturnValue({
      data: {
        workspace: { kind: 'custom' },
        membership: { roleKey: 'admin' },
        authorization: { actions: { 'knowledge_base.create': true } },
      },
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      refetch: jest.fn(async () => undefined),
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', kind: 'custom' },
        currentKbSnapshot: { id: 'snapshot-1', deployHash: 'deploy-1' },
      },
    });
    mockUseKnowledgeRuntimeContext.mockReturnValue({
      effectiveRuntimeSelector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      },
      currentKnowledgeBaseId: 'kb-1',
      currentKbSnapshotId: 'snapshot-1',
      routeKnowledgeBaseId: 'kb-1',
      routeKbSnapshotId: 'snapshot-1',
      runtimeSyncScopeKey: 'sync-key',
    });
    mockUseKnowledgeBaseListCache.mockReturnValue({
      knowledgeBasesUrl: '/api/v1/knowledge/bases?workspaceId=ws-1',
      cachedKnowledgeBaseList: [
        { id: 'kb-1', workspaceId: 'ws-1', slug: 'demo' },
      ],
    });
    mockUseKnowledgeSelectorFallback.mockReturnValue({ id: 'kb-fallback' });
    mockUseKnowledgeDataLoaders.mockReturnValue({
      fetchKnowledgeBaseList: jest.fn(async () => []),
      handleKnowledgeBaseLoadError: jest.fn(),
      fetchConnectors: jest.fn(async () => []),
      handleConnectorLoadError: jest.fn(),
    });
    mockUseKnowledgeBaseSelection.mockReturnValue({
      knowledgeBases: [{ id: 'kb-1', workspaceId: 'ws-1', slug: 'demo' }],
      selectedKnowledgeBaseId: 'kb-1',
      pendingKnowledgeBaseId: null,
      setSelectedKnowledgeBaseId: jest.fn(),
      setPendingKnowledgeBaseId: jest.fn(),
      loadKnowledgeBases: jest.fn(async () => []),
      switchKnowledgeBase: jest.fn(),
    });
    mockUseKnowledgeBaseMeta.mockReturnValue({
      activeKnowledgeBase: { id: 'kb-1', workspaceId: 'ws-1', slug: 'demo' },
      activeKnowledgeBaseExecutable: true,
      canCreateKnowledgeBase: true,
      createKnowledgeBaseBlockedReason: '',
      isReadonlyKnowledgeBase: false,
      isSnapshotReadonlyKnowledgeBase: false,
      isKnowledgeMutationDisabled: false,
      knowledgeMutationHint: null,
      matchedDemoKnowledge: null,
      knowledgeDescription: 'desc',
      knowledgeOwner: 'owner',
      displayKnowledgeName: 'Demo KB',
    });
    mockUseKnowledgeRuntimeBindings.mockReturnValue({
      activeKnowledgeRuntimeSelector: {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
      },
      activeKnowledgeSnapshotId: 'snapshot-1',
      initialKnowledgeSourceType: 'database',
      knowledgeSourceOptions: [{ key: 'database' }],
      ruleSqlCacheScopeKey: 'scope-key',
    });
  });

  const renderHookHarness = () => {
    let current!: ReturnType<typeof useKnowledgeWorkbenchKnowledgeState>;

    const Harness = () => {
      current = useKnowledgeWorkbenchKnowledgeState({
        buildRuntimeScopeUrl: (path) => path,
        hasRuntimeScope: true,
        routerAsPath: '/knowledge',
        routerQuery: { workspaceId: 'ws-1', knowledgeBaseId: 'kb-1' },
        routerReady: true,
        runtimeNavigationWorkspaceId: 'ws-1',
        transitionTo: jest.fn(async () => undefined),
        snapshotReadonlyHint: 'readonly',
      });
      return null;
    };

    renderToStaticMarkup(React.createElement(Harness));
    return current;
  };

  it('composes knowledge selection, meta and runtime binding hooks into one state surface', () => {
    const hookValue = renderHookHarness();

    expect(hookValue.currentKnowledgeBaseId).toBe('kb-1');
    expect(hookValue.routeKnowledgeBaseId).toBe('kb-1');
    expect(hookValue.activeKnowledgeBase).toEqual({
      id: 'kb-1',
      workspaceId: 'ws-1',
      slug: 'demo',
    });
    expect(hookValue.ruleSqlCacheScopeKey).toBe('scope-key');
    expect(mockUseAuthSession).toHaveBeenCalled();
    expect(mockUseRuntimeSelectorState).toHaveBeenCalled();
    expect(mockUseKnowledgeRuntimeContext).toHaveBeenCalled();
    expect(mockUseKnowledgeBaseSelection).toHaveBeenCalled();
    expect(mockUseKnowledgeBaseMeta).toHaveBeenCalled();
    expect(mockUseKnowledgeRuntimeBindings).toHaveBeenCalled();
  });
});
