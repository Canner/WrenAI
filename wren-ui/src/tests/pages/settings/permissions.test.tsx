import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsPermissionsPage from '../../../pages/settings/permissions';

const mockUseAuthSession = jest.fn();
const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseWorkspaceGovernanceOverview = jest.fn();
const mockUsePermissionsRoleManagement = jest.fn();
const mockResolvePlatformManagementFromAuthSession = jest.fn();

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: () => mockUseAuthSession(),
}));

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('@/features/settings/useWorkspaceGovernanceOverview', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseWorkspaceGovernanceOverview(...args),
}));

jest.mock(
  '@/features/settings/permissions/usePermissionsRoleManagement',
  () => ({
    __esModule: true,
    default: (...args: any[]) => mockUsePermissionsRoleManagement(...args),
  }),
);

jest.mock('@/features/settings/settingsPageCapabilities', () => ({
  __esModule: true,
  resolvePlatformManagementFromAuthSession: (...args: any[]) =>
    mockResolvePlatformManagementFromAuthSession(...args),
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
  renderToStaticMarkup(React.createElement(SettingsPermissionsPage));

describe('settings/permissions page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuthSession.mockReturnValue({
      authenticated: true,
      loading: false,
      data: {},
    });
    mockUseProtectedRuntimeScopePage.mockReturnValue({
      guarding: false,
      hasRuntimeScope: true,
    });
    mockUseRuntimeScopeNavigation.mockReturnValue({
      pushWorkspace: jest.fn(),
    });
    mockResolvePlatformManagementFromAuthSession.mockReturnValue(false);
    mockUseWorkspaceGovernanceOverview.mockReturnValue({
      workspaceOverview: {
        permissions: {
          actions: {
            'role.read': true,
            'role.manage': true,
          },
        },
      },
    });
    mockUsePermissionsRoleManagement.mockReturnValue({
      roleCatalog: [
        {
          id: 'role-1',
          name: 'admin',
          displayName: '系统管理员',
          description: '管理系统设置',
          scopeType: 'workspace',
          scopeId: 'workspace-1',
          isSystem: true,
          isActive: true,
          permissionNames: ['workspace.read'],
          bindingCount: 2,
        },
      ],
      roleCatalogLoading: false,
      permissionCatalog: [
        {
          name: 'workspace.read',
          description: '查看工作空间信息',
          assignable: false,
        },
      ],
      roleActionLoading: null,
      handleCreateCustomRole: jest.fn(),
      handleUpdateCustomRole: jest.fn(),
      handleDeleteCustomRole: jest.fn(),
    });
  });

  it('renders the refreshed role management layout', () => {
    const markup = renderPage();

    expect(markup).toContain('权限管理');
    expect(markup).toContain('角色列表');
    expect(markup).toContain('请选择左侧角色查看详情');
    expect(markup).toContain('搜索角色');
    expect(markup).toContain('系统管理员');
    expect(markup).not.toContain('访问复核与高风险流程');
  });

  it('shows the signed-out alert when the session is unavailable', () => {
    mockUseAuthSession.mockReturnValue({
      authenticated: false,
      loading: false,
      data: null,
    });

    const markup = renderPage();

    expect(markup).toContain('当前未登录');
    expect(markup).toContain('请先登录后再查看权限管理。');
  });
});
