import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ManageSkills from '../../../pages/settings/skills';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRuntimeSelectorState = jest.fn();
const mockUseAuthSession = jest.fn();
const mockUseSkillsControlPlaneData = jest.fn();
const mockUseSkillConnectors = jest.fn();

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('@/hooks/useRuntimeSelectorState', () => ({
  __esModule: true,
  default: () => mockUseRuntimeSelectorState(),
}));

jest.mock('@/hooks/useAuthSession', () => ({
  __esModule: true,
  default: () => mockUseAuthSession(),
}));

jest.mock('@/hooks/useSkillsControlPlaneData', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseSkillsControlPlaneData(...args),
}));

jest.mock('@/features/settings/skills/useSkillConnectors', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseSkillConnectors(...args),
}));

jest.mock('@/components/reference/ConsoleShellLayout', () => ({
  __esModule: true,
  default: ({ title, description, children, navItems }: any) => {
    const React = jest.requireActual('react');
    return React.createElement(
      'div',
      null,
      typeof title === 'string' ? title : '技能管理',
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

describe('settings/skills page', () => {
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
      hrefWorkspace: jest.fn((path: string) => path),
      hasRuntimeScope: true,
      selector: { workspaceId: 'workspace-1' },
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
        currentKbSnapshot: {
          id: 'snap-1',
        },
        kbSnapshots: [],
      },
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
          actions: {},
        },
      },
    });
    mockUseSkillsControlPlaneData.mockReturnValue({
      data: {
        marketplaceCatalogSkills: [],
        skillDefinitions: [],
      },
      loading: false,
      refetch: jest.fn(),
    });
    mockUseSkillConnectors.mockReturnValue({
      connectors: [],
      loading: false,
    });
  });

  it('renders the workspace skills management surface', () => {
    const markup = renderToStaticMarkup(<ManageSkills />);

    expect(markup).toContain('技能管理');
    expect(markup).toContain('workspace runtime skill');
    expect(markup).toContain('已启用');
    expect(markup).toContain('连接器');
  });
});
