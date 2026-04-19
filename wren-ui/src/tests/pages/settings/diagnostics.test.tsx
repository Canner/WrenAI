import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsDiagnosticsPage from '../../../pages/settings/diagnostics';

const mockUseRouter = jest.fn();
const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseAuthSession = jest.fn();
const mockUseDrawerAction = jest.fn();
const mockUseApiHistoryList = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

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

jest.mock('@/hooks/useDrawerAction', () => ({
  __esModule: true,
  default: () => mockUseDrawerAction(),
}));

jest.mock('@/hooks/useApiHistoryList', () => ({
  __esModule: true,
  default: (...args: any[]) => mockUseApiHistoryList(...args),
}));

jest.mock('@/components/pages/apiManagement/DetailsDrawer', () => ({
  __esModule: true,
  default: () => <div>DetailsDrawer</div>,
}));

jest.mock('@/components/pages/apiManagement/AskDiagnosticsSummary', () => ({
  __esModule: true,
  default: () => <div>AskDiagnosticsSummary</div>,
}));

jest.mock('@/components/code/SQLCodeBlock', () => ({
  __esModule: true,
  default: () => <div>SQLCodeBlock</div>,
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

describe('settings/diagnostics page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue({
      pathname: '/settings/diagnostics',
      asPath: '/settings/diagnostics',
      query: {},
      isReady: true,
      replace: jest.fn(),
    });
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
    mockUseDrawerAction.mockReturnValue({
      open: false,
      openDrawer: jest.fn(),
      closeDrawer: jest.fn(),
    });
    mockUseApiHistoryList.mockReturnValue({
      data: {
        items: [],
        total: 0,
        hasMore: false,
      },
      loading: false,
    });
  });

  it('renders the diagnostics surface', () => {
    const markup = renderToStaticMarkup(<SettingsDiagnosticsPage />);

    expect(markup).toContain('调用诊断');
    expect(markup).toContain('查看 API History 与 Ask 诊断。');
    expect(markup).toContain('时间范围');
    expect(markup).toContain('调用明细');
  });
});
