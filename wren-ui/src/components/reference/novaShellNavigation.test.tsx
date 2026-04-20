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
    const dashboardItem = buildNovaShellNavItems({}).find(
      (item) => item.key === 'dashboard',
    );

    expect(resolveDashboardNavParams()).toEqual({ dashboardId: 7 });
    expect(dashboardItem?.path).toBe('/home/dashboard');
    expect(dashboardItem?.params).toEqual({
      dashboardId: 7,
    });
  });

  it('falls back to the bare dashboard path when no prefetched dashboard exists', () => {
    mockPeekPrefetchedFirstDashboardId.mockReturnValue(null);
    const dashboardItem = buildNovaShellNavItems({}).find(
      (item) => item.key === 'dashboard',
    );

    expect(resolveDashboardNavParams()).toBeUndefined();
    expect(dashboardItem?.path).toBe('/home/dashboard');
    expect(dashboardItem?.params).toBeUndefined();
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
    ).toEqual([
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
        key: 'settingsWorkspace',
        label: '工作空间管理',
        sectionLabel: '工作空间',
      },
      {
        key: 'settingsConnectors',
        label: '数据连接器',
        sectionLabel: '业务与配置',
      },
      {
        key: 'settingsSkills',
        label: '技能管理',
        sectionLabel: '业务与配置',
      },
      {
        key: 'settingsSystemTasks',
        label: '系统任务',
        sectionLabel: '业务与配置',
      },
      {
        key: 'settingsAudit',
        label: '审计日志',
        sectionLabel: '观测与运维',
      },
      {
        key: 'settingsDiagnostics',
        label: '调用诊断',
        sectionLabel: '观测与运维',
      },
    ]);
  });

  it('keeps workspace management out of the primary shell navigation', () => {
    const onNavigate = jest.fn();

    expect(
      buildNovaShellNavItems({
        onNavigate,
      }).map((item) => item.key),
    ).toEqual(['home', 'knowledge', 'dashboard']);
  });

  it('keeps knowledge navigation in the primary shell stack below dashboard', () => {
    const items = buildNovaShellNavItems({});
    const knowledgeItem = items.find((item) => item.key === 'knowledge');

    expect(knowledgeItem?.placement).toBeUndefined();
  });
});
