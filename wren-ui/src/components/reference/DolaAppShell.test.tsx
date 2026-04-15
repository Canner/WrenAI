import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DolaAppShell, {
  resolveBackgroundHistoryPrefetchIds,
  getCachedShellUiState,
  resolveBackgroundNavPrefetchKeys,
  resolveHistoryThreadHref,
  resolveShellPrefetchUrls,
  resolveShellUiScopeKey,
  shouldPrefetchShellIntent,
} from './DolaAppShell';

const mockUseAuthSession = jest.fn();
const mockUsePersistentShellEmbedded = jest.fn();

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

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => ({
    push: jest.fn(),
    href: (path: string) => `${path}?workspaceId=ws-1`,
    selector: {
      workspaceId: 'ws-1',
      runtimeScopeId: 'scope-1',
    },
  }),
}));

jest.mock('./PersistentShellContext', () => ({
  __esModule: true,
  usePersistentShellEmbedded: () => mockUsePersistentShellEmbedded(),
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
    Space,
    Typography,
  };
});

describe('DolaAppShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePersistentShellEmbedded.mockReturnValue(false);
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

  it('short-circuits when already embedded in the persistent shell', () => {
    mockUsePersistentShellEmbedded.mockReturnValue(true);

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
      >
        <div>main-content</div>
      </DolaAppShell>,
    );

    expect(html).toContain('main-content');
    expect(html).not.toContain('Nova');
    expect(html).not.toContain('最近一次对话');
    expect(mockUseAuthSession).not.toHaveBeenCalled();
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
        (path) => `${path}?workspaceId=ws-1`,
        'thread-1',
      ),
    ).toBe('/home/thread-1?workspaceId=ws-1');

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
            label: '我的知识库',
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
