import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WorkspaceSchedulesPage from '../../../pages/workspace/schedules';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseAuthSession = jest.fn();

let capturedTableProps: any[] = [];

jest.mock('antd', () => {
  const React = jest.requireActual('react');

  return {
    Alert: ({ message, title, description }: any) =>
      React.createElement('div', null, title || message, description),
    Button: ({ children }: any) =>
      React.createElement('button', null, children),
    Card: ({ children, title, extra }: any) =>
      React.createElement('section', null, title, extra, children),
    Col: ({ children }: any) => React.createElement('div', null, children),
    Row: ({ children }: any) => React.createElement('div', null, children),
    Select: ({ value, options }: any) =>
      React.createElement(
        'select',
        { 'data-value': value },
        (options || []).map((option: any) =>
          React.createElement(
            'option',
            { key: option.value, value: option.value },
            option.label,
          ),
        ),
      ),
    Space: ({ children }: any) => React.createElement('div', null, children),
    Statistic: ({ title, value, prefix }: any) =>
      React.createElement('div', null, title, prefix, value),
    Tabs: ({ items }: any) =>
      React.createElement(
        'div',
        { 'data-kind': 'tabs' },
        (items || []).map((item: any) =>
          React.createElement(
            'section',
            { key: item.key, 'data-tab-key': item.key },
            React.createElement('h3', null, item.label),
            item.children,
          ),
        ),
      ),
    Table: (props: any) => {
      capturedTableProps.push(props);
      return React.createElement('div', { 'data-kind': 'table' });
    },
    Tag: ({ children }: any) => React.createElement('span', null, children),
    Typography: {
      Text: ({ children, strong, type }: any) =>
        React.createElement(
          strong ? 'strong' : type === 'secondary' ? 'small' : 'span',
          null,
          children,
        ),
      Title: ({ children }: any) => React.createElement('h4', null, children),
    },
    message: {
      success: jest.fn(),
      error: jest.fn(),
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

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: () => mockUseAuthSession(),
}));

jest.mock('@/components/reference/ConsoleShellLayout', () => ({
  __esModule: true,
  default: ({ title, description, children, navItems }: any) => {
    const React = jest.requireActual('react');
    return React.createElement(
      'div',
      null,
      title,
      description,
      React.createElement(
        'div',
        null,
        (navItems || []).map((item: any) =>
          React.createElement('span', { key: item.key }, item.label),
        ),
      ),
      children,
    );
  },
}));

jest.mock('@/features/settings/systemTasks/SystemTaskScheduleDrawer', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', {
      'data-kind': 'system-task-schedule-drawer',
    });
  },
}));

jest.mock('@/features/settings/systemTasks/SystemTaskRunDetailsDrawer', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', {
      'data-kind': 'system-task-run-details-drawer',
    });
  },
}));

const renderPage = () =>
  renderToStaticMarkup(React.createElement(WorkspaceSchedulesPage));

describe('workspace/schedules page', () => {
  beforeEach(() => {
    capturedTableProps = [];
    jest.clearAllMocks();
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
      pushWorkspace: jest.fn(),
      hasRuntimeScope: true,
    });
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      loading: false,
      data: {
        authorization: {
          actions: {
            'workspace.schedule.manage': true,
          },
          actor: {
            platformRoleKeys: [],
            isPlatformAdmin: false,
            grantedActions: ['workspace.schedule.manage'],
          },
        },
        isPlatformAdmin: false,
      },
    });
  });

  it('renders schedule control plane shell with overview sections', () => {
    const markup = renderPage();

    expect(markup).toContain('定时任务');
    expect(markup).not.toContain('工作区概览');
    expect(markup).not.toContain('当前工作区');
    expect(markup).not.toContain('当前知识库');
    expect(markup).toContain('任务列表');
    expect(markup).toContain('运行记录');
    expect(markup).toContain('任务状态');
    expect(markup).toContain('运行状态');
    expect(markup).not.toContain('按最近一次运行结果聚合展示。');
    expect(capturedTableProps).toHaveLength(2);
  });

  it('exposes run/edit/manual action buttons in the schedule table', () => {
    renderPage();

    const actionColumn = capturedTableProps[0].columns.find(
      (column: any) => column.key === 'actions',
    );
    const actionMarkup = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        actionColumn.render(null, {
          id: 'job-1',
          status: 'active',
        }),
      ),
    );

    expect(actionMarkup).toContain('立即刷新');
    expect(actionMarkup).toContain('编辑计划');
    expect(actionMarkup).toContain('切为仅手动刷新');
  });

  it('exposes recent run details action in the runs table', () => {
    renderPage();

    const actionColumn = capturedTableProps[1].columns.find(
      (column: any) => column.key === 'actions',
    );
    const actionMarkup = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        actionColumn.render(null, {
          id: 'run-1',
          status: 'failed',
          targetName: '库存概览',
        }),
      ),
    );

    expect(actionMarkup).toContain('查看详情');
  });
});
