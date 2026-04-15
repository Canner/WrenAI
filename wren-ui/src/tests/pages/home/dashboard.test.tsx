import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DashboardPage from '../../../pages/home/dashboard';
import {
  clearDashboardRestCache,
  primeDashboardDetailPayload,
  primeDashboardListPayload,
} from '@/utils/dashboardRest';

const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRouter = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();

let capturedDashboardGridProps: any = null;
let capturedDashboardHeaderProps: any = null;

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  const Input = (props: any) => React.createElement('input', props);
  Input.Search = ({ allowClear: _allowClear, ...props }: any) =>
    React.createElement('input', props);
  return {
    Button: ({ children, danger: _danger, ...props }: any) =>
      React.createElement('button', props, children),
    Input,
    Modal: ({ title, children }: any) =>
      React.createElement('div', null, title, children),
    message: {
      success: jest.fn(),
      error: jest.fn(),
      warning: jest.fn(),
      info: jest.fn(),
    },
  };
});

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
}));

jest.mock('@/components/PageLoading', () => ({
  LoadingWrapper: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('@/components/reference/ConsoleShellLayout', () => ({
  __esModule: true,
  default: ({ title, description, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, title, description, children);
  },
}));

jest.mock('@/components/pages/home/dashboardGrid', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: any, ref: any) => {
      capturedDashboardGridProps = props;
      React.useImperativeHandle(ref, () => ({
        onRefreshAll: jest.fn(),
        focusItem: jest.fn(),
      }));
      return React.createElement(
        'div',
        { 'data-kind': 'dashboard-grid' },
        (props.items || []).map((item: any) =>
          React.createElement(
            'span',
            { key: item.id },
            item.displayName || item.id,
          ),
        ),
      );
    }),
  };
});

jest.mock('@/components/pages/home/dashboardGrid/EmptyDashboard', () => ({
  __esModule: true,
  default: ({ children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, children);
  },
}));

jest.mock('@/components/pages/home/dashboardGrid/DashboardHeader', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedDashboardHeaderProps = props;
    const React = jest.requireActual('react');
    return React.createElement(
      'div',
      null,
      props.readOnly ? 'DashboardHeaderReadonly' : 'DashboardHeader',
    );
  },
}));

jest.mock('@/components/pages/home/dashboardGrid/CacheSettingsDrawer', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, 'CacheSettingsDrawer');
  },
}));

const selector = {
  workspaceId: 'ws-1',
  runtimeScopeId: 'scope-1',
  kbSnapshotId: 'snap-1',
  deployHash: 'deploy-1',
};

const renderPage = () =>
  renderToStaticMarkup(React.createElement(DashboardPage));

describe('home/dashboard page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearDashboardRestCache();
    capturedDashboardGridProps = null;
    capturedDashboardHeaderProps = null;

    mockUseRouter.mockReturnValue({
      query: { dashboardId: '11' },
      isReady: true,
      asPath: '/home/dashboard?dashboardId=11&workspaceId=ws-1',
      replace: jest.fn().mockResolvedValue(true),
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      pushWorkspace: jest.fn(),
      replace: jest.fn(),
      hrefWorkspace: jest.fn(
        (path: string, params?: Record<string, unknown>) =>
          path === '/home/dashboard'
            ? `/home/dashboard?dashboardId=${params?.dashboardId}`
            : path,
      ),
      selector,
      hasRuntimeScope: true,
    });
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '订单分析知识库',
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
          id: 11,
          name: '经营总览',
          cacheEnabled: true,
          nextScheduledAt: null,
          scheduleFrequency: 'DAILY',
        },
        {
          id: 12,
          name: '销售看板',
          cacheEnabled: false,
          nextScheduledAt: null,
          scheduleFrequency: null,
        },
      ],
    });
    primeDashboardDetailPayload({
      selector,
      dashboardId: 11,
      payload: {
        id: 11,
        name: '经营总览',
        description: null,
        cacheEnabled: true,
        nextScheduledAt: null,
        schedule: {
          frequency: 'DAILY',
          hour: 9,
          minute: 0,
          day: 'MON',
          timezone: 'Asia/Shanghai',
          cron: '0 9 * * *',
        },
        items: [
          {
            id: 1,
            dashboardId: 11,
            type: 'BAR',
            displayName: '销售趋势',
            layout: { x: 0, y: 0, w: 3, h: 2 },
            detail: {
              sql: 'select 1',
              chartSchema: null,
              sourceResponseId: 91,
              sourceThreadId: 21,
              sourceQuestion: '近 30 天销售趋势',
            },
          },
        ],
      },
    });
  });

  it('renders the simplified multi-dashboard workbench shell', () => {
    const markup = renderPage();

    expect(markup).toContain('数据看板');
    expect(markup).toContain('看板');
    expect(markup).toContain('新建看板');
    expect(markup).toContain('去新对话生成图表');
    expect(markup).toContain('经营总览');
    expect(markup).toContain('销售看板');
    expect(markup).toContain('销售趋势');
    expect(markup).toContain('图表');
    expect(markup).toContain('选中图表');
    expect(markup).toContain('回到来源线程');
    expect(markup).toContain('近 30 天销售趋势');
    expect(markup).toContain('#21');
    expect(markup).toContain('#91');
    expect(markup).not.toContain('看板列表');
    expect(markup).not.toContain('图表列表');
    expect(markup).not.toContain('当前选中卡片');
    expect(capturedDashboardGridProps?.readOnly).toBe(false);
    expect(capturedDashboardHeaderProps?.readOnly).toBe(false);
  });

  it('marks dashboard canvas as readonly on historical snapshots', () => {
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentKnowledgeBase: {
          id: 'kb-1',
          name: '订单分析知识库',
          defaultKbSnapshotId: 'snap-latest',
        },
        currentKbSnapshot: {
          id: 'snap-old',
          displayName: '旧快照',
          deployHash: 'deploy-old',
          status: 'READY',
        },
      },
    });

    const markup = renderPage();

    expect(markup).toContain('历史快照只读');
    expect(capturedDashboardGridProps?.readOnly).toBe(true);
    expect(capturedDashboardHeaderProps?.readOnly).toBe(true);
    expect(markup).toContain('DashboardHeaderReadonly');
  });
});
