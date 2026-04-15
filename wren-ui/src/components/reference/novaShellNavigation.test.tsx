import {
  buildNovaShellNavItems,
  buildNovaSettingsNavItems,
  resolveDashboardNavParams,
} from './novaShellNavigation';

const mockPeekPrefetchedFirstDashboardId = jest.fn();

jest.mock('@/utils/runtimePagePrefetch', () => ({
  __esModule: true,
  peekPrefetchedFirstDashboardId: () => mockPeekPrefetchedFirstDashboardId(),
}));

describe('novaShellNavigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the prefetched first dashboard id when navigating to dashboard', () => {
    mockPeekPrefetchedFirstDashboardId.mockReturnValue(7);
    const onNavigate = jest.fn();

    const dashboardItem = buildNovaShellNavItems({
      onNavigate,
    }).find((item) => item.key === 'dashboard');

    dashboardItem?.onClick?.();

    expect(resolveDashboardNavParams()).toEqual({ dashboardId: 7 });
    expect(onNavigate).toHaveBeenCalledWith('/home/dashboard', {
      dashboardId: 7,
    });
  });

  it('falls back to the bare dashboard path when no prefetched dashboard exists', () => {
    mockPeekPrefetchedFirstDashboardId.mockReturnValue(null);
    const onNavigate = jest.fn();

    const dashboardItem = buildNovaShellNavItems({
      onNavigate,
    }).find((item) => item.key === 'dashboard');

    dashboardItem?.onClick?.();

    expect(resolveDashboardNavParams()).toBeUndefined();
    expect(onNavigate).toHaveBeenCalledWith('/home/dashboard', undefined);
  });

  it('builds grouped settings navigation with dedicated pages', () => {
    const onNavigate = jest.fn();

    const items = buildNovaSettingsNavItems({
      onNavigate,
      showPlatformAdmin: true,
    });

    expect(
      items.map((item) => ({
        key: item.key,
        label: item.label,
        sectionLabel: item.sectionLabel,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          key: 'settingsWorkspace',
          label: '工作空间管理',
          sectionLabel: '工作空间',
        },
        {
          key: 'settingsConnectors',
          label: '数据连接器',
          sectionLabel: '工作空间',
        },
        {
          key: 'settingsSkills',
          label: '技能管理',
          sectionLabel: '工作空间',
        },
        {
          key: 'settingsProfile',
          label: '个人资料',
          sectionLabel: '账户设置',
        },
        {
          key: 'settingsUsers',
          label: '用户管理',
          sectionLabel: '组织与安全',
        },
        {
          key: 'settingsPermissions',
          label: '权限管理',
          sectionLabel: '组织与安全',
        },
        {
          key: 'settingsIdentity',
          label: '身份与目录',
          sectionLabel: '组织与安全',
        },
        {
          key: 'settingsDiagnostics',
          label: '调用诊断',
          sectionLabel: '业务配置',
        },
        {
          key: 'settingsSystemTasks',
          label: '系统任务',
          sectionLabel: '业务配置',
        },
        {
          key: 'settingsPlatform',
          label: '平台治理',
          sectionLabel: '平台管理',
        },
      ]),
    );
  });

  it('keeps workspace management out of the primary shell navigation', () => {
    const onNavigate = jest.fn();

    expect(
      buildNovaShellNavItems({
        onNavigate,
      }).map((item) => item.key),
    ).toEqual(['home', 'knowledge', 'dashboard']);
  });
});
