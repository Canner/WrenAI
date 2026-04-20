import BookOutlined from '@ant-design/icons/BookOutlined';
import FundViewOutlined from '@ant-design/icons/FundViewOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import ScheduleOutlined from '@ant-design/icons/ScheduleOutlined';
import TeamOutlined from '@ant-design/icons/TeamOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import ApiOutlined from '@ant-design/icons/ApiOutlined';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import AuditOutlined from '@ant-design/icons/AuditOutlined';
import CodeOutlined from '@ant-design/icons/CodeOutlined';
import { Path } from '@/utils/enum';
import { peekPrefetchedFirstDashboardId } from '@/utils/runtimePagePrefetch';
import { DolaShellNavItem } from './DolaAppShell';

export type NovaShellNavKey =
  | 'home'
  | 'knowledge'
  | 'dashboard'
  | 'settingsProfile'
  | 'settingsWorkspace'
  | 'settingsConnectors'
  | 'settingsSkills'
  | 'settingsUsers'
  | 'settingsPermissions'
  | 'settingsIdentity'
  | 'settingsAutomation'
  | 'settingsAudit'
  | 'settingsDiagnostics'
  | 'settingsPlatform'
  | 'settingsSystemTasks';
type NovaNavParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export const resolveDashboardNavParams = () => {
  const firstDashboardId = peekPrefetchedFirstDashboardId();
  return firstDashboardId == null
    ? undefined
    : { dashboardId: firstDashboardId };
};

export const buildNovaShellNavItems = ({
  activeKey,
}: {
  activeKey?: NovaShellNavKey;
  onNavigate?: (path: string, params?: NovaNavParams) => void;
}): DolaShellNavItem[] => [
  {
    key: 'home',
    label: '新对话',
    icon: <PlusOutlined />,
    iconKey: 'home',
    active: activeKey === 'home',
    path: activeKey === 'home' ? undefined : Path.Home,
  },
  {
    key: 'knowledge',
    label: '知识库',
    icon: <BookOutlined />,
    iconKey: 'knowledge',
    active: activeKey === 'knowledge',
    path: activeKey === 'knowledge' ? undefined : Path.Knowledge,
  },
  {
    key: 'dashboard',
    label: '数据看板',
    icon: <FundViewOutlined />,
    iconKey: 'dashboard',
    active: activeKey === 'dashboard',
    path: activeKey === 'dashboard' ? undefined : Path.HomeDashboard,
    params: activeKey === 'dashboard' ? undefined : resolveDashboardNavParams(),
  },
];

export const buildNovaSettingsNavItems = ({
  activeKey,
  showPlatformAdmin = false,
}: {
  activeKey?: NovaShellNavKey;
  onNavigate?: (path: string, params?: NovaNavParams) => void;
  showPlatformAdmin?: boolean;
}): DolaShellNavItem[] => {
  const navItems: DolaShellNavItem[] = [
    {
      key: 'settingsProfile',
      label: '个人资料',
      icon: <SettingOutlined />,
      iconKey: 'settingsProfile',
      sectionLabel: '账户设置',
      active: activeKey === 'settingsProfile',
      path: activeKey === 'settingsProfile' ? undefined : Path.Settings,
    },
  ];

  if (showPlatformAdmin) {
    navItems.push(
      {
        key: 'settingsUsers',
        label: '用户管理',
        icon: <SafetyCertificateOutlined />,
        iconKey: 'settingsUsers',
        sectionLabel: '组织与安全',
        active: activeKey === 'settingsUsers',
        path:
          activeKey === 'settingsUsers'
            ? undefined
            : Path.SettingsPlatformUsers,
      },
      {
        key: 'settingsPermissions',
        label: '权限管理',
        icon: <SafetyCertificateOutlined />,
        iconKey: 'settingsPermissions',
        sectionLabel: '组织与安全',
        active: activeKey === 'settingsPermissions',
        path:
          activeKey === 'settingsPermissions'
            ? undefined
            : Path.SettingsPlatformPermissions,
      },
    );
  }

  navItems.push(
    {
      key: 'settingsWorkspace',
      label: '工作空间管理',
      icon: <TeamOutlined />,
      iconKey: 'settingsWorkspace',
      sectionLabel: '工作空间',
      active: activeKey === 'settingsWorkspace',
      path:
        activeKey === 'settingsWorkspace'
          ? undefined
          : Path.SettingsPlatformWorkspaces,
    },
    {
      key: 'settingsConnectors',
      label: '数据连接器',
      icon: <ApiOutlined />,
      iconKey: 'settingsConnectors',
      sectionLabel: '业务与配置',
      active: activeKey === 'settingsConnectors',
      path:
        activeKey === 'settingsConnectors'
          ? undefined
          : Path.SettingsConnectors,
    },
    {
      key: 'settingsSkills',
      label: '技能管理',
      icon: <CodeOutlined />,
      iconKey: 'settingsSkills',
      sectionLabel: '业务与配置',
      active: activeKey === 'settingsSkills',
      path: activeKey === 'settingsSkills' ? undefined : Path.SettingsSkills,
    },
    {
      key: 'settingsSystemTasks',
      label: '系统任务',
      icon: <ScheduleOutlined />,
      iconKey: 'settingsSystemTasks',
      sectionLabel: '业务与配置',
      active: activeKey === 'settingsSystemTasks',
      path:
        activeKey === 'settingsSystemTasks'
          ? undefined
          : Path.SettingsSystemTasks,
    },
    {
      key: 'settingsAudit',
      label: '审计日志',
      icon: <AuditOutlined />,
      iconKey: 'settingsAudit',
      sectionLabel: '观测与运维',
      active: activeKey === 'settingsAudit',
      path: activeKey === 'settingsAudit' ? undefined : Path.SettingsAudit,
    },
    {
      key: 'settingsDiagnostics',
      label: '调用诊断',
      icon: <ApiOutlined />,
      iconKey: 'settingsDiagnostics',
      sectionLabel: '观测与运维',
      active: activeKey === 'settingsDiagnostics',
      path:
        activeKey === 'settingsDiagnostics'
          ? undefined
          : Path.SettingsDiagnostics,
    },
  );

  return navItems;
};
