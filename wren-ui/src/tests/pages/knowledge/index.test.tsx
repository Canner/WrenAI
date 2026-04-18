import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import KnowledgeHomePage, {
  canShowKnowledgeLifecycleAction,
  getKnowledgeLifecycleActionLabel,
  resolveKnowledgeNavBadgeCount,
  resolveVisibleKnowledgeBaseId,
  shouldCommitPendingKnowledgeBaseSwitch,
  shouldSyncKnowledgeRuntimeScopeData,
  shouldRouteSwitchKnowledgeBase,
  shouldShowKnowledgeAssetsLoading,
} from '../../../pages/knowledge';

const mockUseRouter = jest.fn();
const mockBuildRuntimeScopeUrl = jest.fn();
const mockBuildRuntimeScopeHeaders = jest.fn();
const mockReadRuntimeScopeSelectorFromObject = jest.fn();
const mockResolveClientRuntimeScopeSelector = jest.fn();
const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRuntimeScopeTransition = jest.fn();
const mockUseHomeSidebar = jest.fn();
const mockUseAuthSession = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  const actual = jest.requireActual('antd');

  return {
    ...actual,
    Modal: ({ children }: any) => React.createElement('div', null, children),
  };
});

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('@/runtime/client/runtimeScope', () => ({
  buildRuntimeScopeUrl: (...args: any[]) => mockBuildRuntimeScopeUrl(...args),
  buildRuntimeScopeHeaders: (...args: any[]) =>
    mockBuildRuntimeScopeHeaders(...args),
  readRuntimeScopeSelectorFromObject: (...args: any[]) =>
    mockReadRuntimeScopeSelectorFromObject(...args),
  resolveClientRuntimeScopeSelector: (...args: any[]) =>
    mockResolveClientRuntimeScopeSelector(...args),
}));

jest.mock('@/components/reference/DolaAppShell', () => ({
  __esModule: true,
  default: ({ title, description, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, title, description, children);
  },
}));

jest.mock('@/hooks/useHomeSidebar', () => ({
  __esModule: true,
  default: () => mockUseHomeSidebar(),
}));

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: () => mockUseAuthSession(),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
}));

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('@/hooks/useRuntimeScopeTransition', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeTransition(),
}));

jest.mock('@/components/pages/modeling/ModelingWorkspace', () => ({
  __esModule: true,
  default: ({ embedded }: { embedded?: boolean }) => {
    const React = jest.requireActual('react');
    return React.createElement(
      'div',
      null,
      embedded ? 'EmbeddedModelingWorkspace' : 'ModelingWorkspace',
    );
  },
}));

const renderPage = () =>
  renderToStaticMarkup(React.createElement(KnowledgeHomePage));

describe('knowledge index page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildRuntimeScopeUrl.mockImplementation((path: string) => path);
    mockBuildRuntimeScopeHeaders.mockImplementation(() => ({}));
    mockReadRuntimeScopeSelectorFromObject.mockImplementation(() => ({}));
    mockResolveClientRuntimeScopeSelector.mockImplementation(() => ({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    }));
    mockUseRouter.mockReturnValue({
      query: {},
      replace: jest.fn(),
      push: jest.fn(),
      isReady: true,
    });
    mockUseHomeSidebar.mockReturnValue({
      data: { threads: [] },
      onSelect: jest.fn(),
      ensureLoaded: jest.fn(),
    });
    mockUseAuthSession.mockReturnValue({
      loading: false,
      authenticated: true,
      data: {
        authenticated: true,
        membership: {
          id: 'member-1',
          roleKey: 'owner',
        },
      },
      refresh: jest.fn(),
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      provided: true,
      loading: false,
      runtimeSelectorState: {
        currentWorkspace: { id: 'ws-1', name: '业务工作空间', kind: 'regular' },
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '订单分析知识库',
          kind: 'regular',
        },
        currentKbSnapshot: {
          id: 'snap-1',
          displayName: '默认快照',
          deployHash: 'deploy-1',
          status: 'READY',
        },
        knowledgeBases: [
          {
            id: 'kb-1',
            name: '订单分析知识库',
            defaultKbSnapshotId: 'snap-1',
          },
        ],
        kbSnapshots: [
          {
            id: 'snap-1',
            snapshotKey: 'snap-1',
            displayName: '默认快照',
            deployHash: 'deploy-1',
            status: 'READY',
          },
        ],
        workspaces: [{ id: 'ws-1', slug: 'ws-1', name: '业务工作空间' }],
      },
      refetch: jest.fn(),
    });
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      selector: {
        workspaceId: 'ws-1',
        runtimeScopeId: 'scope-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
    });
    mockUseRuntimeScopeTransition.mockReturnValue({
      transitioning: false,
      transitionTo: jest.fn(),
    });
  });

  it('renders the workbench primary action and section shortcuts', () => {
    const markup = renderPage();

    expect(markup).toContain('分析规则');
    expect(markup).toContain('SQL 模板');
    expect(markup).toContain('编辑知识库');
    expect(markup).toContain('资产数');
    expect(markup).not.toContain('knowledge-workbench-tab-assets');
    expect(markup).not.toContain('title="添加资产"');
    expect(markup).not.toContain('引入资产');
    expect(markup).not.toContain('知识配置');
    expect(markup).not.toContain('添加知识库');
  });

  it('renders the embedded modeling workspace when section=modeling', () => {
    mockUseRouter.mockReturnValue({
      query: { section: 'modeling' },
      replace: jest.fn(),
      push: jest.fn(),
      isReady: true,
    });

    const markup = renderPage();

    expect(markup).toContain('模型');
    expect(markup).not.toContain('查看资产');
    expect(markup).toContain('EmbeddedModelingWorkspace');
  });

  it('renders sql templates as list cards without inline editor panel', () => {
    mockUseRouter.mockReturnValue({
      query: { section: 'sqlTemplates' },
      replace: jest.fn(),
      push: jest.fn(),
      isReady: true,
    });

    const markup = renderPage();

    expect(markup).toContain('新建 SQL 模板');
    expect(markup).toContain('当前显示 0 / 0 条');
    expect(markup).not.toContain('新建 SQL 模板草稿');
  });

  it('renders instructions as list cards without inline editor panel', () => {
    mockUseRouter.mockReturnValue({
      query: { section: 'instructions' },
      replace: jest.fn(),
      push: jest.fn(),
      isReady: true,
    });

    const markup = renderPage();

    expect(markup).toContain('新建分析规则');
    expect(markup).toContain('当前显示 0 / 0 条');
    expect(markup).not.toContain('新建分析规则草稿');
  });

  it('does not render the legacy database modal by default', () => {
    const markup = renderPage();

    expect(markup).toContain('资产');
    expect(markup).not.toContain('添加数据库');
    expect(markup).not.toContain('连接信息');
    expect(markup).not.toContain('开启跨源查询');
  });

  it('falls back to overview when loading the legacy assets section route', () => {
    mockUseRouter.mockReturnValue({
      query: { section: 'assets' },
      replace: jest.fn(),
      push: jest.fn(),
      isReady: true,
    });

    const markup = renderPage();

    expect(markup).toContain('资产数');
    expect(markup).not.toContain('knowledge-workbench-tab-assets');
    expect(markup).not.toContain('前往工作区连接器');
    expect(markup).not.toContain('使用完整向导引入资产');
    expect(markup).not.toContain('资产新增方式');
    expect(markup).not.toContain('选择样例数据');
    expect(markup).not.toContain('选择数据库');
    expect(markup).not.toContain('人力资源数据');
    expect(markup).not.toContain('请选择样例数据');
    expect(markup).not.toContain('请选择主题表');
  });

  it('routes when switching to a different knowledge base', () => {
    expect(
      shouldRouteSwitchKnowledgeBase(
        {
          id: 'kb-2',
          defaultKbSnapshot: {
            id: 'snap-2',
            displayName: '默认快照',
            deployHash: 'deploy-2',
            status: 'READY',
          },
        },
        'kb-1',
      ),
    ).toBe(true);

    expect(
      shouldRouteSwitchKnowledgeBase(
        {
          id: 'kb-2',
          defaultKbSnapshot: null,
        },
        'kb-1',
      ),
    ).toBe(true);

    expect(
      shouldRouteSwitchKnowledgeBase(
        {
          id: 'kb-1',
          defaultKbSnapshot: null,
        },
        'kb-1',
      ),
    ).toBe(false);
  });

  it('prefers pending knowledge-base highlight while runtime switch is in flight', () => {
    expect(
      resolveVisibleKnowledgeBaseId({
        activeKnowledgeBaseId: 'kb-1',
        pendingKnowledgeBaseId: 'kb-2',
      }),
    ).toBe('kb-2');

    expect(
      resolveVisibleKnowledgeBaseId({
        activeKnowledgeBaseId: 'kb-1',
        pendingKnowledgeBaseId: null,
      }),
    ).toBe('kb-1');
  });

  it('only commits a pending knowledge-base switch after route-scoped data finishes syncing', () => {
    expect(
      shouldCommitPendingKnowledgeBaseSwitch({
        currentKnowledgeBaseId: 'kb-2',
        routeKnowledgeBaseId: null,
        pendingKnowledgeBaseId: 'kb-2',
        routeRuntimeSyncing: true,
      }),
    ).toBe(false);

    expect(
      shouldCommitPendingKnowledgeBaseSwitch({
        currentKnowledgeBaseId: 'kb-2',
        routeKnowledgeBaseId: null,
        pendingKnowledgeBaseId: 'kb-2',
        routeRuntimeSyncing: false,
      }),
    ).toBe(true);

    expect(
      shouldCommitPendingKnowledgeBaseSwitch({
        currentKnowledgeBaseId: 'kb-1',
        routeKnowledgeBaseId: null,
        pendingKnowledgeBaseId: 'kb-2',
        routeRuntimeSyncing: false,
      }),
    ).toBe(false);

    expect(
      shouldCommitPendingKnowledgeBaseSwitch({
        currentKnowledgeBaseId: 'kb-1',
        routeKnowledgeBaseId: 'kb-2',
        pendingKnowledgeBaseId: 'kb-2',
        routeRuntimeSyncing: false,
      }),
    ).toBe(true);
  });

  it('shows an asset loading overlay while runtime-backed knowledge content is still syncing', () => {
    expect(
      shouldShowKnowledgeAssetsLoading({
        activeKnowledgeBaseUsesRuntime: true,
        assetCount: 0,
        diagramLoading: true,
        hasDiagramData: false,
        routeRuntimeSyncing: false,
      }),
    ).toBe(true);

    expect(
      shouldShowKnowledgeAssetsLoading({
        activeKnowledgeBaseUsesRuntime: true,
        assetCount: 4,
        diagramLoading: false,
        hasDiagramData: true,
        routeRuntimeSyncing: true,
      }),
    ).toBe(true);

    expect(
      shouldShowKnowledgeAssetsLoading({
        activeKnowledgeBaseUsesRuntime: false,
        assetCount: 0,
        diagramLoading: true,
        hasDiagramData: false,
        routeRuntimeSyncing: true,
      }),
    ).toBe(false);
  });

  it('deduplicates runtime-scope sync requests for unchanged route keys', () => {
    expect(
      shouldSyncKnowledgeRuntimeScopeData({
        runtimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-1',
        lastSyncedRuntimeScopeKey: null,
      }),
    ).toBe(true);

    expect(
      shouldSyncKnowledgeRuntimeScopeData({
        runtimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-1',
        lastSyncedRuntimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-1',
      }),
    ).toBe(false);

    expect(
      shouldSyncKnowledgeRuntimeScopeData({
        runtimeScopeKey: null,
        lastSyncedRuntimeScopeKey: 'ws-1|kb-1|snap-1|deploy-1|scope-1',
      }),
    ).toBe(false);
  });

  it('prefers the active knowledge-base asset count for the left badge', () => {
    expect(
      resolveKnowledgeNavBadgeCount({
        navKnowledgeBaseId: 'kb-1',
        activeKnowledgeBaseId: 'kb-1',
        activeAssetCount: 7,
        fallbackCount: 1,
      }),
    ).toBe(7);

    expect(
      resolveKnowledgeNavBadgeCount({
        navKnowledgeBaseId: 'kb-2',
        activeKnowledgeBaseId: 'kb-1',
        activeAssetCount: 7,
        fallbackCount: 1,
      }),
    ).toBe(1);
  });

  it('only exposes lifecycle actions for mutable business knowledge bases', () => {
    expect(
      canShowKnowledgeLifecycleAction({
        workspaceKind: 'regular',
        knowledgeBaseKind: 'regular',
        roleKey: 'owner',
        snapshotReadonly: false,
      }),
    ).toBe(true);

    expect(
      canShowKnowledgeLifecycleAction({
        workspaceKind: 'default',
        knowledgeBaseKind: 'regular',
        roleKey: 'owner',
        snapshotReadonly: false,
      }),
    ).toBe(false);

    expect(
      canShowKnowledgeLifecycleAction({
        workspaceKind: 'regular',
        knowledgeBaseKind: 'system_sample',
        roleKey: 'admin',
        snapshotReadonly: false,
      }),
    ).toBe(false);

    expect(getKnowledgeLifecycleActionLabel(null)).toBe('归档知识库');
    expect(getKnowledgeLifecycleActionLabel('2026-04-13T00:00:00.000Z')).toBe(
      '恢复知识库',
    );
  });
});
