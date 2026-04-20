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

describe('settings/platform page', () => {
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
    mockUseRuntimeSelectorState.mockReturnValue({
      runtimeSelectorState: {
        currentWorkspace: {
          id: 'workspace-1',
          name: 'Demo Workspace',
        },
      },
    });
  });

  it('renders the platform permission guard state', () => {
    const markup = renderToStaticMarkup(<PlatformManagementPage />);

    expect(markup).toContain('平台治理');
    expect(markup).toContain('当前账号没有平台治理权限');
    expect(markup).not.toContain('platform_admin');
  });

  it('shows a platform admin fallback label only when the session still carries the legacy admin flag', () => {
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      loading: false,
      data: {
        isPlatformAdmin: true,
        authorization: {
          actor: {
            platformRoleKeys: [],
            isPlatformAdmin: true,
          },
        },
      },
    });

    const markup = renderToStaticMarkup(<PlatformManagementPage />);

    expect(markup).toContain('平台治理总览');
    expect(markup).toContain('平台管理员');
  });

  it('renders support role labels when the actor carries the new default support roles', () => {
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      loading: false,
      data: {
        authorization: {
          actor: {
            platformRoleKeys: ['support_readonly', 'support_impersonator'],
            isPlatformAdmin: false,
          },
        },
      },
    });

    const markup = renderToStaticMarkup(<PlatformManagementPage />);

    expect(markup).toContain('平台治理总览');
    expect(markup).toContain('支持只读');
    expect(markup).toContain('支持代理员');
  });
});
