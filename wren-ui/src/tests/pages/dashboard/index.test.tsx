import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DashboardPage from '../../../pages/home/dashboard';
import {
  clearDashboardRestCache,
  primeDashboardDetailPayload,
  primeDashboardListPayload,
} from '@/utils/dashboardRest';

const mockUseRouter = jest.fn();
const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseDrawerAction = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  const Search = ({ allowClear: _allowClear, ...props }: any) =>
    React.createElement('input', props);
  const Input = Object.assign(
    (props: any) => React.createElement('input', props),
    {
      Search,
    },
  );

  return {
    Button: ({ children }: any) =>
      React.createElement('button', null, children),
    Input,
    Modal: ({ children }: any) => React.createElement('div', null, children),
    message: {
      success: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
      info: jest.fn(),
    },
  };
});

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('@/hooks/useDrawerAction', () => ({
  __esModule: true,
  default: () => mockUseDrawerAction(),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
}));

jest.mock('@/components/reference/ConsoleShellLayout', () => ({
  __esModule: true,
  default: ({ title, description, sections, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement(
      'div',
      null,
      title,
      description,
      React.createElement(
        'div',
        null,
        (sections || []).map((section: any) =>
          React.createElement('span', { key: section.key }, section.label),
        ),
      ),
      children,
    );
  },
}));

jest.mock('@/components/PageLoading', () => ({
  LoadingWrapper: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('@/components/pages/home/dashboardGrid', () => ({
  __esModule: true,
  default: React.forwardRef((_props: any, _ref: any) =>
    React.createElement('div', { 'data-kind': 'dashboard-grid' }),
  ),
}));

jest.mock('@/components/pages/home/dashboardGrid/DashboardHeader', () => ({
  __esModule: true,
  default: () => React.createElement('div', null, 'header'),
}));

jest.mock('@/components/pages/home/dashboardGrid/EmptyDashboard', () => ({
  __esModule: true,
  default: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('@/components/pages/home/dashboardGrid/CacheSettingsDrawer', () => ({
  __esModule: true,
  default: () => React.createElement('div', null, 'cache-drawer'),
}));

const selector = { workspaceId: 'ws-1' };

const renderPage = () =>
  renderToStaticMarkup(React.createElement(DashboardPage));

describe('dashboard page shell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearDashboardRestCache();

    mockUseRouter.mockReturnValue({
      query: {},
      isReady: true,
      asPath: '/home/dashboard?workspaceId=ws-1',
      replace: jest.fn().mockResolvedValue(true),
    });
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      pushWorkspace: jest.fn(),
      replace: jest.fn(),
      hasRuntimeScope: true,
      selector,
      hrefWorkspace: jest.fn((path: string) => path),
    });
    mockUseDrawerAction.mockReturnValue({
      openDrawer: jest.fn(),
      closeDrawer: jest.fn(),
      state: {},
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '默认知识库',
          defaultKbSnapshotId: 'snap-1',
        },
        currentKbSnapshot: {
          id: 'snap-1',
          displayName: '默认快照',
          deployHash: 'deploy-1',
          status: 'READY',
        },
      },
    });

    primeDashboardListPayload({
      selector,
      payload: [
        {
          id: 1,
          name: '默认看板',
          cacheEnabled: true,
          nextScheduledAt: null,
          scheduleFrequency: 'NEVER',
        },
      ],
    });
    primeDashboardDetailPayload({
      selector,
      dashboardId: 1,
      payload: {
        id: 1,
        name: '默认看板',
        cacheEnabled: true,
        nextScheduledAt: null,
        schedule: { frequency: 'NEVER' },
        items: [],
      },
    });
  });

  it('renders the simplified dashboard shell', () => {
    const markup = renderPage();

    expect(markup).toContain('数据看板');
    expect(markup).toContain('看板');
    expect(markup).toContain('新建看板');
    expect(markup).toContain('图表');
    expect(markup).toContain('选中图表');
    expect(markup).toContain('去新对话生成图表');
    expect(markup).not.toContain('看板列表');
    expect(markup).not.toContain('图表列表');
    expect(markup).not.toContain('当前选中卡片');
  });
});
