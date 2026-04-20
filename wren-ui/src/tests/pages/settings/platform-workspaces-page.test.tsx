import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ManagePlatformWorkspacesPage from '@/features/settings/platform-workspaces/ManagePlatformWorkspacesPage';

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

describe('platform workspaces feature page', () => {
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

  it('renders the workspace governance guard state when platform.workspace.read is missing', () => {
    const markup = renderToStaticMarkup(<ManagePlatformWorkspacesPage />);

    expect(markup).toContain('工作空间管理');
    expect(markup).toContain('当前账号没有平台治理权限');
    expect(markup).toContain(
      '平台工作空间管理仅对具备工作空间治理查看权限的角色开放。',
    );
  });
});
