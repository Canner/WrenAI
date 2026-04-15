import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WorkspacePage from '../../../pages/workspace';

const mockUseProtectedRuntimeScopePage = jest.fn();
const mockUseRuntimeScopeNavigation = jest.fn();
const mockUseRouter = jest.fn();
const mockBuildRuntimeScopeUrl = jest.fn();
const mockPeekWorkspaceOverview = jest.fn();
let capturedConsoleShellLayoutProps: any = null;

jest.mock('next/router', () => ({
  useRouter: () => mockUseRouter(),
}));

jest.mock('@/apollo/client/runtimeScope', () => ({
  buildRuntimeScopeUrl: (...args: any[]) => mockBuildRuntimeScopeUrl(...args),
}));

jest.mock('@/utils/runtimePagePrefetch', () => ({
  loadWorkspaceOverview: jest.fn(),
  peekWorkspaceOverview: (...args: any[]) => mockPeekWorkspaceOverview(...args),
}));

jest.mock('@/hooks/useProtectedRuntimeScopePage', () => ({
  __esModule: true,
  default: () => mockUseProtectedRuntimeScopePage(),
}));

jest.mock('@/hooks/useRuntimeScopeNavigation', () => ({
  __esModule: true,
  default: () => mockUseRuntimeScopeNavigation(),
}));

jest.mock('@/components/reference/ConsoleShellLayout', () => ({
  __esModule: true,
  default: ({ title, description, sections, navItems, children }: any) => {
    capturedConsoleShellLayoutProps = {
      title,
      description,
      sections,
      navItems,
    };
    const React = jest.requireActual('react');
    return React.createElement(
      'div',
      null,
      title,
      description,
      React.createElement(
        'div',
        null,
        (sections || []).map((section: any) =>
          React.createElement('span', { key: section.key }, section.label),
        ),
      ),
      children,
    );
  },
}));

const renderPage = () =>
  renderToStaticMarkup(React.createElement(WorkspacePage));

describe('workspace page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedConsoleShellLayoutProps = null;
    mockBuildRuntimeScopeUrl.mockImplementation((path: string) => path);
    mockPeekWorkspaceOverview.mockReturnValue({
      workspace: {
        id: 'workspace-1',
        name: 'Demo Workspace',
        kind: 'regular',
      },
      membership: {
        id: 'member-1',
        roleKey: 'owner',
      },
      authorization: {
        actor: {
          workspaceRoleKeys: ['owner'],
          platformRoleKeys: ['platform_admin'],
        },
      },
      permissions: {
        canManageMembers: true,
        canCreateWorkspace: true,
        actions: {
          'workspace.member.status.update': true,
          'workspace.member.invite': true,
          'workspace.create': true,
          'service_account.read': true,
          'service_account.create': true,
          'api_token.read': true,
          'api_token.create': true,
          'identity_provider.read': true,
          'identity_provider.manage': true,
          'access_review.read': true,
          'access_review.manage': true,
          'group.read': true,
          'group.manage': true,
          'break_glass.manage': true,
          'impersonation.start': true,
        },
      },
      workspaces: [],
      discoverableWorkspaces: [],
      applications: [],
      members: [],
      reviewQueue: [],
      serviceAccounts: [],
      apiTokens: [],
      identityProviders: [
        {
          id: 'idp-1',
          providerType: 'saml',
          name: 'Enterprise SAML',
          enabled: true,
          configJson: {
            metadataUrl: 'https://idp.example.com/metadata.xml',
            metadataFetchedAt: '2026-04-14T04:40:00.000Z',
            signingCertificateSummaries: [
              {
                subject: 'CN=wrenai-test',
                issuer: 'CN=wrenai-test',
                validTo: '2036-04-11T04:36:18.000Z',
                status: 'valid',
              },
            ],
            signingCertificateCount: 1,
            earliestCertificateExpiryAt: '2036-04-11T04:36:18.000Z',
          },
        },
        {
          id: 'idp-2',
          providerType: 'saml',
          name: 'Legacy SAML',
          enabled: true,
          configJson: {
            metadataUrl: 'https://legacy.example.com/metadata.xml',
            metadataFetchedAt: '2026-04-14T04:41:00.000Z',
            signingCertificateSummaries: [
              {
                subject: 'CN=legacy-test',
                issuer: 'CN=legacy-test',
                validTo: '2000-01-01T00:00:00.000Z',
                status: 'expired',
              },
            ],
            signingCertificateCount: 1,
            earliestCertificateExpiryAt: '2000-01-01T00:00:00.000Z',
          },
        },
      ],
      directoryGroups: [],
      breakGlassGrants: [],
      accessReviews: [],
      impersonation: {
        active: false,
      },
      stats: {
        workspaceCount: 1,
        knowledgeBaseCount: 0,
        memberCount: 1,
        directoryGroupCount: 0,
        breakGlassGrantCount: 0,
      },
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
    mockUseRouter.mockReturnValue({
      replace: jest.fn(),
    });
  });

  it('shrinks governance blocks into summary and jump actions', () => {
    const markup = renderPage();

    expect(markup).toContain('工作空间');
    expect(markup).toContain('我的工作空间');
    expect(markup).toContain('发现工作空间');
    expect(markup).toContain('申请记录');
    expect(markup).not.toContain('当前工作区');
    expect(markup).not.toContain('系统工作空间');
    expect(markup).toContain('工作空间运营摘要');
    expect(markup).toContain('设置快捷入口');
    expect(markup).toContain('打开用户管理');
    expect(markup).toContain('打开权限管理');
    expect(markup).toContain('打开身份与目录');
    expect(markup).toContain('打开审计日志');
    expect(markup).toContain('打开平台治理');
    expect(markup).toContain('身份与目录');
    expect(markup).toContain('审计与高风险动作');
    expect(markup).toContain('企业 SSO / OIDC / SAML / SCIM');
    expect(markup).toContain('SAML 证书健康告警');

    expect(markup).not.toContain('创建服务账号');
    expect(markup).not.toContain('创建 Token');
    expect(markup).not.toContain('刷新 metadata');
    expect(markup).not.toContain('创建紧急授权');
    expect(markup).not.toContain('开始代理登录');
  });

  it('renders from the settings navigation tree instead of the primary workspace tab', () => {
    renderPage();

    expect(
      capturedConsoleShellLayoutProps?.navItems?.some(
        (item: any) => item.key === 'settingsWorkspace' && item.active,
      ),
    ).toBe(true);
  });
});
