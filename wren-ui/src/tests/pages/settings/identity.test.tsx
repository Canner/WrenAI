import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsIdentityPage from '../../../pages/settings/identity';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseAuthSession = jest.fn();
const mockUseWorkspaceGovernanceOverview = jest.fn();

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

jest.mock('@/features/settings/useWorkspaceGovernanceOverview', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseWorkspaceGovernanceOverview(...args),
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

const renderPage = () => renderToStaticMarkup(<SettingsIdentityPage />);

describe('settings/identity page', () => {
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
    mockUseWorkspaceGovernanceOverview.mockReturnValue({
      workspaceOverview: {
        permissions: { actions: {} },
        members: [],
        identityProviders: [],
        directoryGroups: [],
      },
      loading: false,
      refetchWorkspaceOverview: jest.fn(),
      error: null,
    });
  });

  it('renders the identity provider and directory governance surface', () => {
    const markup = renderPage();

    expect(markup).toContain('身份与目录');
    expect(markup).toContain('身份源');
    expect(markup).toContain('SCIM 0 个');
    expect(markup).toContain('目录组');
    expect(markup).toContain('当前为只读视图');
  });
});
