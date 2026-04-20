import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsPage from '../../../pages/settings';

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
  renderToStaticMarkup(React.createElement(SettingsPage));

describe('settings/profile page', () => {
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
          name: 'Nova 工作空间',
        },
      },
    });
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      loading: false,
      data: {
        user: {
          email: 'owner@example.com',
          displayName: 'Nova Owner',
        },
        membership: {
          roleKey: 'admin',
        },
        workspace: {
          name: 'Nova 工作空间',
        },
        workspaces: [
          {
            id: 'ws-1',
            name: 'Nova 工作空间',
          },
        ],
        defaultWorkspaceId: 'ws-1',
        authorization: {
          actor: {
            workspaceRoleKeys: ['admin'],
            platformRoleKeys: [],
          },
        },
      },
    });
  });

  it('renders the refreshed profile summary layout', () => {
    const markup = renderPage();

    expect(markup).toContain('个人资料');
    expect(markup).not.toContain('基本资料');
    expect(markup).toContain('默认工作空间');
    expect(markup).toContain('平台角色');
    expect(markup).toContain('修改密码');
    expect(markup).toContain('安全建议');
    expect(markup).not.toContain('当前空间 · Nova 工作空间');
    expect(markup).not.toContain(
      '更新当前账号的登录凭据，建议使用独立且可恢复的密码。',
    );
  });

  it('renders the new support role labels in the profile summary', () => {
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      loading: false,
      data: {
        user: {
          email: 'support@example.com',
          displayName: 'Support Agent',
        },
        membership: {
          roleKey: 'viewer',
        },
        workspace: {
          name: 'Nova 工作空间',
        },
        workspaces: [
          {
            id: 'ws-1',
            name: 'Nova 工作空间',
          },
        ],
        defaultWorkspaceId: 'ws-1',
        authorization: {
          actor: {
            workspaceRoleKeys: ['viewer'],
            platformRoleKeys: ['support_readonly', 'support_impersonator'],
          },
        },
      },
    });

    const markup = renderPage();

    expect(markup).toContain('支持只读');
    expect(markup).toContain('支持代理员');
  });
});
