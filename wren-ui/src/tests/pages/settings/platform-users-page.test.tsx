import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ManagePlatformUsersPage from '@/features/settings/platform-users/ManagePlatformUsersPage';

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
  default: ({ title, description, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, title, description, children);
  },
}));

describe('platform users feature page', () => {
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
            grantedActions: [],
          },
          actions: {},
        },
      },
    });
  });

  it('renders the platform user directory guard state when platform.user.read is missing', () => {
    const markup = renderToStaticMarkup(<ManagePlatformUsersPage />);

    expect(markup).toContain('用户管理');
    expect(markup).toContain('当前账号没有平台治理权限');
    expect(markup).toContain(
      '平台用户管理仅对具备平台用户目录权限的角色开放。',
    );
  });
});
