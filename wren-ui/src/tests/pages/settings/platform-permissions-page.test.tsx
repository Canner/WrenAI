import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ManagePlatformPermissionsPage from '@/features/settings/platform-permissions/ManagePlatformPermissionsPage';

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
  default: ({ title, children }: any) => {
    const React = jest.requireActual('react');
    return React.createElement('div', null, title, children);
  },
}));

describe('settings/platform-permissions page', () => {
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
  });

  it('renders the permission guard state when actor lacks platform role read access', () => {
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      loading: false,
      data: {
        authenticated: true,
        authorization: {
          actor: {
            platformRoleKeys: [],
            isPlatformAdmin: false,
          },
        },
      },
    });

    const markup = renderToStaticMarkup(<ManagePlatformPermissionsPage />);

    expect(markup).toContain('权限管理');
    expect(markup).toContain('当前账号没有平台治理权限');
  });

  it('renders the canonical role catalog shell for authorized actors', () => {
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      loading: false,
      data: {
        authenticated: true,
        authorization: {
          actor: {
            platformRoleKeys: ['platform_iam_admin'],
            isPlatformAdmin: false,
            grantedActions: ['platform.role.read'],
          },
        },
      },
    });

    const markup = renderToStaticMarkup(<ManagePlatformPermissionsPage />);

    expect(markup).toContain('权限管理');
    expect(markup).toContain('搜索角色');
    expect(markup).toContain('暂无匹配角色');
    expect(markup).toContain('请选择左侧角色查看详情');
  });
});
