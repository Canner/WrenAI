import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsAutomationPage from '../../../pages/settings/automation';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseAuthSession = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
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

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
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

const renderPage = () => renderToStaticMarkup(<SettingsAutomationPage />);

describe('settings/automation page', () => {
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
    mockUseWorkspaceGovernanceOverview.mockReturnValue({
      workspaceOverview: {
        permissions: { actions: {} },
        serviceAccounts: [],
        apiTokens: [],
      },
      loading: false,
      refetchWorkspaceOverview: jest.fn(),
      error: null,
    });
  });

  it('renders the machine identity governance surface', () => {
    const markup = renderPage();

    expect(markup).toContain('自动化身份');
    expect(markup).toContain('服务账号');
    expect(markup).toContain('活跃 Token');
    expect(markup).toContain('API Token');
    expect(markup).toContain('当前为只读视图');
  });
});
