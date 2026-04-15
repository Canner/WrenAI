import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PlatformManagementPage from '../../../pages/settings/platform';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseAuthSession = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();

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

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
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

const renderPage = () =>
  renderToStaticMarkup(React.createElement(PlatformManagementPage));

describe('platform management page', () => {
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
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentWorkspace: {
          id: 'workspace-1',
          name: 'Demo Workspace',
        },
        currentKnowledgeBase: {
          id: 'kb-1',
          name: 'Sales KB',
        },
      },
    });
  });

  it('shows platform management navigation for platform admins', () => {
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      loading: false,
      data: {
        user: {
          id: 'user-1',
          email: 'admin@example.com',
          displayName: 'Admin',
          isPlatformAdmin: true,
        },
        workspaces: [
          { id: 'workspace-1', name: 'Demo Workspace' },
          { id: 'workspace-2', name: 'Ops Workspace' },
        ],
        authorization: {
          actor: {
            platformRoleKeys: ['platform_admin'],
            isPlatformAdmin: true,
          },
        },
      },
    });

    const markup = renderPage();

    expect(markup).toContain('平台治理');
    expect(markup).toContain('个人资料');
    expect(markup).toContain('用户管理');
    expect(markup).toContain('权限管理');
    expect(markup).toContain('审计日志');
    expect(markup).toContain('平台治理');
    expect(markup).toContain('平台管理员');
    expect(markup).toContain('高风险动作请前往权限管理 / 审计日志');
  });

  it('shows a forbidden message for non-platform admins', () => {
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      loading: false,
      data: {
        user: {
          id: 'user-2',
          email: 'member@example.com',
          displayName: 'Member',
          isPlatformAdmin: false,
        },
        authorization: {
          actor: {
            platformRoleKeys: [],
            isPlatformAdmin: false,
          },
        },
      },
    });

    const markup = renderPage();

    expect(markup).toContain('当前账号没有平台治理权限');
    expect(markup).toContain('平台治理');
  });
});
