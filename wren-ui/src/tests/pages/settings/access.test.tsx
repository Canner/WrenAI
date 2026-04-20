import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AccessCompatibilityPage from '../../../pages/settings/access';

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
  renderToStaticMarkup(React.createElement(AccessCompatibilityPage));

describe('settings/access compatibility route', () => {
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
            workspaceSourceDetails: [
              {
                kind: 'direct_binding',
                label: '直接绑定 · 所有者',
              },
            ],
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
        currentKnowledgeBase: {
          id: 'kb-1',
          name: 'Sales KB',
        },
      },
    });
  });

  it('keeps /settings/access pointing to the dedicated users page shell', () => {
    const markup = renderPage();

    expect(markup).toContain('用户管理');
    expect(markup).toContain('个人资料');
    expect(markup).toContain('审计日志');
    expect(markup).toContain('调用诊断');
    expect(markup).toContain('系统任务');
    expect(markup).toContain('当前账号没有平台治理权限');
    expect(markup).toContain('平台用户管理仅对具备平台用户目录权限的角色开放。');
  });
});
