import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsUsersPage from '../../../pages/settings/users';

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
  renderToStaticMarkup(React.createElement(SettingsUsersPage));

describe('settings/users page', () => {
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
        user: {
          email: 'owner@example.com',
          displayName: 'Owner',
        },
        authorization: {
          actor: {
            workspaceRoleSource: 'role_binding',
            platformRoleSource: 'legacy',
          },
        },
      },
    });
  });

  it('renders the user management surface', () => {
    const markup = renderPage();

    expect(markup).toContain('用户管理');
    expect(markup).toContain('搜索姓名 / 账号 / 手机号');
    expect(markup).toContain('新增用户');
    expect(markup).toContain('已显示 0 / 0 名用户');
  });
});
