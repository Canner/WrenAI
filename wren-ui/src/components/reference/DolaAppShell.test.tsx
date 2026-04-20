import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DolaAppShell, {
  resolveBackgroundHistoryPrefetchIds,
  getCachedShellUiState,
  resolveBackgroundNavPrefetchKeys,
  resolveHistoryThreadHref,
  resolveHistoryThreadNavigationSelector,
  resolveShellPrefetchUrls,
  resolveShellUiScopeKey,
  shouldPrefetchShellIntent,
} from './DolaAppShell';

const mockUseAuthSession = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
const mockUseRuntimeScopeTransition = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => ({
    pathname: '/home',
    push: jest.fn(),
  }),
}));

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseAuthSession(...args),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
}));

jest.mock('@/hooks/useRuntimeScopeTransition', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeTransition(),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => ({
    push: jest.fn(),
    href: (
      path: string,
      _params?: Record<string, string | number | boolean | null | undefined>,
      selector?: {
        workspaceId?: string;
        knowledgeBaseId?: string;
        kbSnapshotId?: string;
        deployHash?: string;
      },
    ) => {
      const query = new URLSearchParams();
      if (selector?.workspaceId) query.set('workspaceId', selector.workspaceId);
      if (selector?.knowledgeBaseId)
        query.set('knowledgeBaseId', selector.knowledgeBaseId);
      if (selector?.kbSnapshotId)
        query.set('kbSnapshotId', selector.kbSnapshotId);
      if (selector?.deployHash) query.set('deployHash', selector.deployHash);
      return `${path}${query.toString() ? `?${query.toString()}` : ''}`;
    },
    selector: {
      workspaceId: 'ws-1',
      runtimeScopeId: 'scope-1',
    },
    workspaceSelector: {
      workspaceId: 'ws-1',
    },
    hasRuntimeScope: true,
  }),
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  const passthrough =
    (tag: string, extraProps: Record<string, any> = {}) =>
    ({ children, ...props }: any) =>
      React.createElement(tag, { ...extraProps, ...props }, children);

  const Button = ({ children, icon, block: _block, ...props }: any) =>
    React.createElement('button', props, icon, children);
  const Input = ({ prefix, ...props }: any) =>
    React.createElement('div', { ...props, 'data-kind': 'input' }, prefix);
  const Dropdown = ({ children }: any) =>
    React.createElement('div', { 'data-kind': 'dropdown' }, children);
  const Popover = ({ children }: any) =>
    React.createElement('div', { 'data-kind': 'popover' }, children);
  const Avatar = ({ children, ...props }: any) =>
    React.createElement('div', { ...props, 'data-kind': 'avatar' }, children);
  const Menu = Object.assign(
    ({ items }: any) =>
      React.createElement(
        'div',
        { 'data-kind': 'menu' },
        items?.map((item: any) =>
          React.createElement('div', { key: item.key }, item.label),
        ),
      ),
    {
      Item: ({ children, ...props }: any) =>
        React.createElement('div', props, children),
    },
  );
  const Space = ({ children }: any) =>
    React.createElement('div', null, children);
  const Layout = Object.assign(passthrough('div'), {
    Sider: ({
      children,
      collapsed: _collapsed,
      collapsedWidth: _collapsedWidth,
      breakpoint: _breakpoint,
      trigger: _trigger,
      ...props
    }: any) => React.createElement('aside', props, children),
    Content: passthrough('main'),
  });
  const Typography = {
    Text: ({ children }: any) => React.createElement('span', null, children),
  };

  return {
    Avatar,
    Button,
    Divider: passthrough('hr'),
    Dropdown,
    Input,
    Layout,
    Menu,
    Popover,
    Space,
    Typography,
  };
});

describe('DolaAppShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthSession.mockReturnValue({
      loading: false,
      authenticated: true,
      data: {
        user: {
          displayName: 'admin',
          email: 'admin',
        },
      },
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      initialLoading: false,
      runtimeSelectorState: {
        currentWorkspace: {
          id: 'ws-1',
          slug: 'workspace-1',
          name: 'Workspace 1',
        },
        workspaces: [
          { id: 'ws-1', slug: 'workspace-1', name: 'Workspace 1' },
          { id: 'ws-2', slug: 'workspace-2', name: 'Workspace 2' },
        ],
      },
    });
    mockUseRuntimeScopeTransition.mockReturnValue({
      transitioning: false,
      transitionTo: jest.fn(),
    });
  });

  it('renders brand, navigation, history and account entry', () => {
    const html = renderToStaticMarkup(
      <DolaAppShell
        navItems={[
          {
            key: 'knowledge',
            label: '知识库',
            icon: <span>📚</span>,
          },
        ]}
        historyItems={[
          {
            id: 'thread-1',
            title: '最近一次对话',
          },
        ]}
        sidebarMeta={<div>scope-card</div>}
      >
        <div>main-content</div>
      </DolaAppShell>,
    );

    expect(html).toContain('Nova');
    expect(html).toContain('知识库');
    expect(html).toContain('最近一次对话');
    expect(html).toContain('admin');
    expect(html).toContain('Workspace 1');
    expect(html).toContain('main-content');
    expect(html).not.toContain('scope-card');
    expect(html).not.toContain('当前账号');
    expect(html).not.toContain('安全可信的数据知识库AI助手');
    expect(mockUseAuthSession).toHaveBeenCalledWith({
      includeWorkspaceQuery: false,
    });
  });

  it('renders loading copy instead of empty history text while history is fetching', () => {
    const html = renderToStaticMarkup(
      <DolaAppShell
        navItems={[
          {
            key: 'knowledge',
            label: '知识库',
            icon: <span>📚</span>,
          },
        ]}
        historyItems={[]}
        historyLoading
      >
        <div>main-content</div>
      </DolaAppShell>,
    );

    expect(html).toContain('加载历史对话中');
    expect(html).not.toContain('暂无历史对话');
  });

  it('can hide sidebar branding and footer controls for focused settings pages', () => {
    const html = renderToStaticMarkup(
      <DolaAppShell
        navItems={[
          {
            key: 'settingsProfile',
            label: '个人资料',
            icon: <span>👤</span>,
          },
        ]}
        hideHistorySection
        hideSidebarBranding
        hideSidebarFooterPanel
        hideSidebarCollapseToggle
        sidebarBackAction={{
          label: '返回主菜单',
          onClick: jest.fn(),
        }}
      >
        <div>settings-content</div>
      </DolaAppShell>,
    );

    expect(html).toContain('返回主菜单');
    expect(html).toContain('个人资料');
    expect(html).toContain('settings-content');
    expect(html).not.toContain('Nova');
    expect(html).not.toContain('Workspace 1');
    expect(html).not.toContain('admin');
    expect(html).not.toContain('收起侧边栏');
  });

  it('builds scope-aware prefetch urls for primary shell routes', () => {
    expect(
      resolveShellPrefetchUrls((path) => `${path}?workspaceId=ws-1`),
    ).toEqual([
      '/home?workspaceId=ws-1',
      '/home/dashboard?workspaceId=ws-1',
      '/knowledge?workspaceId=ws-1',
    ]);
  });

  it('resolves shell ui scope and history thread href helpers', () => {
    expect(
      resolveShellUiScopeKey({
        workspaceId: 'ws-1',
        runtimeScopeId: 'scope-1',
      }),
    ).toBe('ws-1');
    expect(resolveShellUiScopeKey({ runtimeScopeId: 'scope-1' })).toBe(
      'scope-1',
    );
    expect(resolveShellUiScopeKey({})).toBe('__default__');

    expect(
      resolveHistoryThreadHref(
        (
          path,
          _params,
          selector = {
            workspaceId: 'ws-1',
          },
        ) =>
          `${path}?workspaceId=${selector.workspaceId}${
            selector.knowledgeBaseId
              ? `&knowledgeBaseId=${selector.knowledgeBaseId}`
              : ''
          }`,
        'thread-1',
        {
          workspaceId: 'ws-1',
          knowledgeBaseId: 'kb-1',
        },
      ),
    ).toBe('/home/thread-1?workspaceId=ws-1&knowledgeBaseId=kb-1');

    expect(
      resolveHistoryThreadNavigationSelector({
        item: {
          id: 'thread-1',
          title: '最近一次对话',
          selector: {
            workspaceId: 'ws-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snap-1',
            deployHash: 'deploy-1',
          },
        },
        fallbackSelector: {
          workspaceId: 'ws-1',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });

    expect(getCachedShellUiState('fresh-scope')).toEqual({
      collapsed: false,
      historyScrollTop: 0,
    });
  });

  it('only prefetches shell intents for inactive actionable entries', () => {
    expect(
      shouldPrefetchShellIntent({
        active: false,
        hasAction: true,
      }),
    ).toBe(true);
    expect(
      shouldPrefetchShellIntent({
        active: true,
        hasAction: true,
      }),
    ).toBe(false);
    expect(
      shouldPrefetchShellIntent({
        active: false,
        hasAction: false,
      }),
    ).toBe(false);

    expect(
      resolveBackgroundNavPrefetchKeys(
        [
          {
            key: 'dashboard',
            label: '数据看板',
            icon: <span>📈</span>,
            iconKey: 'dashboard',
            path: '/home/dashboard',
            active: false,
          },
        ],
        '/home',
      ),
    ).toEqual(['dashboard']);
  });

  it('only schedules background nav prefetch for inactive dashboard entries', () => {
    expect(
      resolveBackgroundNavPrefetchKeys(
        [
          {
            key: 'home',
            label: '新对话',
            icon: <span>🏠</span>,
            active: true,
            onClick: jest.fn(),
          },
          {
            key: 'knowledge',
            label: '知识库',
            icon: <span>📚</span>,
            onClick: jest.fn(),
          },
          {
            key: 'dashboard',
            label: '数据看板',
            icon: <span>📊</span>,
            onClick: jest.fn(),
          },
        ],
        '/home',
      ),
    ).toEqual(['dashboard']);
  });

  it('skips background nav prefetch outside the home/thread shell routes', () => {
    expect(
      resolveBackgroundNavPrefetchKeys(
        [
          {
            key: 'dashboard',
            label: '数据看板',
            icon: <span>📊</span>,
            onClick: jest.fn(),
          },
        ],
        '/knowledge',
      ),
    ).toEqual([]);
  });

  it('prefetches the first inactive history thread in the background', () => {
    expect(
      resolveBackgroundHistoryPrefetchIds([
        {
          id: '22',
          title: '首条历史刷新复现-2',
          active: false,
        },
        {
          id: '21',
          title: '首条历史刷新复现-1',
          active: false,
        },
        {
          id: '19',
          title: '订单总数是多少？',
          active: true,
        },
      ]),
    ).toEqual(['22']);

    expect(
      resolveBackgroundHistoryPrefetchIds(
        [
          {
            id: '19',
            title: '订单总数是多少？',
            active: true,
          },
        ],
        2,
      ),
    ).toEqual([]);
  });
});
