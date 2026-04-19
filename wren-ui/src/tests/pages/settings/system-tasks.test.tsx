import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsSystemTasksPage from '../../../pages/settings/system-tasks';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseAuthSession = jest.fn();

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

jest.mock('@/components/pages/home/dashboardGrid/CacheSettingsDrawer', () => ({
  __esModule: true,
  default: () => <div>CacheSettingsDrawer</div>,
}));

jest.mock('@/components/pages/workspace/ScheduleRunDetailsDrawer', () => ({
  __esModule: true,
  default: () => <div>ScheduleRunDetailsDrawer</div>,
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

describe('settings/system-tasks page', () => {
  beforeEach(() => {
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
          actor: {
            platformRoleKeys: [],
            isPlatformAdmin: false,
          },
        },
      },
    });
  });

  it('renders the scheduled tasks operations surface', () => {
    const markup = renderToStaticMarkup(<SettingsSystemTasksPage />);

    expect(markup).toContain('系统任务');
    expect(markup).toContain('查看当前 Workspace 的调度任务');
    expect(markup).toContain('任务列表');
    expect(markup).toContain('最近运行');
  });
});
