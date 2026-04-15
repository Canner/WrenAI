import BookOutlined from '@ant-design/icons/BookOutlined';
import FundViewOutlined from '@ant-design/icons/FundViewOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import ScheduleOutlined from '@ant-design/icons/ScheduleOutlined';
import TeamOutlined from '@ant-design/icons/TeamOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import ApiOutlined from '@ant-design/icons/ApiOutlined';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import ApartmentOutlined from '@ant-design/icons/ApartmentOutlined';
import LockOutlined from '@ant-design/icons/LockOutlined';
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
  onNavigate,
}: {
  activeKey?: NovaShellNavKey;
  onNavigate: (path: string, params?: NovaNavParams) => void;
}): DolaShellNavItem[] => [
  {
    key: 'home',
    label: '新对话',
    icon: <PlusOutlined />,
    active: activeKey === 'home',
    onClick: activeKey === 'home' ? undefined : () => onNavigate(Path.Home),
  },
  {
    key: 'knowledge',
    label: '我的知识库',
    icon: <BookOutlined />,
    placement: 'bottom',
    active: activeKey === 'knowledge',
    onClick:
      activeKey === 'knowledge' ? undefined : () => onNavigate(Path.Knowledge),
  },
  {
    key: 'dashboard',
    label: '数据看板',
    icon: <FundViewOutlined />,
    active: activeKey === 'dashboard',
    onClick:
      activeKey === 'dashboard'
        ? undefined
        : () => onNavigate(Path.HomeDashboard, resolveDashboardNavParams()),
  },
];

export const buildNovaSettingsNavItems = ({
  activeKey,
  onNavigate,
  showPlatformAdmin = false,
}: {
  activeKey?: NovaShellNavKey;
  onNavigate: (path: string, params?: NovaNavParams) => void;
  showPlatformAdmin?: boolean;
}): DolaShellNavItem[] => [
  {
    key: 'settingsWorkspace',
    label: '工作空间管理',
    icon: <TeamOutlined />,
    sectionLabel: '工作空间',
    active: activeKey === 'settingsWorkspace',
    onClick:
      activeKey === 'settingsWorkspace'
        ? undefined
        : () => onNavigate(Path.SettingsWorkspace),
  },
  {
    key: 'settingsConnectors',
    label: '数据连接器',
    icon: <ApiOutlined />,
    sectionLabel: '工作空间',
    active: activeKey === 'settingsConnectors',
    onClick:
      activeKey === 'settingsConnectors'
        ? undefined
        : () => onNavigate(Path.SettingsConnectors),
  },
  {
    key: 'settingsSkills',
    label: '技能管理',
    icon: <CodeOutlined />,
    sectionLabel: '工作空间',
    active: activeKey === 'settingsSkills',
    onClick:
      activeKey === 'settingsSkills'
        ? undefined
        : () => onNavigate(Path.SettingsSkills),
  },
  {
    key: 'settingsProfile',
    label: '个人资料',
    icon: <SettingOutlined />,
    sectionLabel: '账户设置',
    active: activeKey === 'settingsProfile',
    onClick:
      activeKey === 'settingsProfile'
        ? undefined
        : () => onNavigate(Path.Settings),
  },
  {
    key: 'settingsUsers',
    label: '用户管理',
    icon: <SafetyCertificateOutlined />,
    sectionLabel: '组织与安全',
    active: activeKey === 'settingsUsers',
    onClick:
      activeKey === 'settingsUsers'
        ? undefined
        : () => onNavigate(Path.SettingsUsers),
  },
  {
    key: 'settingsPermissions',
    label: '权限管理',
    icon: <SafetyCertificateOutlined />,
    sectionLabel: '组织与安全',
    active: activeKey === 'settingsPermissions',
    onClick:
      activeKey === 'settingsPermissions'
        ? undefined
        : () => onNavigate(Path.SettingsPermissions),
  },
  {
    key: 'settingsIdentity',
    label: '身份与目录',
    icon: <LockOutlined />,
    sectionLabel: '组织与安全',
    active: activeKey === 'settingsIdentity',
    onClick:
      activeKey === 'settingsIdentity'
        ? undefined
        : () => onNavigate(Path.SettingsIdentity),
  },
  {
    key: 'settingsAudit',
    label: '审计日志',
    icon: <AuditOutlined />,
    sectionLabel: '组织与安全',
    active: activeKey === 'settingsAudit',
    onClick:
      activeKey === 'settingsAudit'
        ? undefined
        : () => onNavigate(Path.SettingsAudit),
  },
  {
    key: 'settingsDiagnostics',
    label: '调用诊断',
    icon: <ApiOutlined />,
    sectionLabel: '业务配置',
    active: activeKey === 'settingsDiagnostics',
    onClick:
      activeKey === 'settingsDiagnostics'
        ? undefined
        : () => onNavigate(Path.SettingsDiagnostics),
  },
  ...(showPlatformAdmin
    ? [
        {
          key: 'settingsPlatform' as const,
          label: '平台治理',
          icon: <ApartmentOutlined />,
          sectionLabel: '平台管理',
          active: activeKey === 'settingsPlatform',
          onClick:
            activeKey === 'settingsPlatform'
              ? undefined
              : () => onNavigate(Path.SettingsPlatform),
        },
      ]
    : []),
  {
    key: 'settingsSystemTasks',
    label: '系统任务',
    icon: <ScheduleOutlined />,
    sectionLabel: '业务配置',
    active: activeKey === 'settingsSystemTasks',
    onClick:
      activeKey === 'settingsSystemTasks'
        ? undefined
        : () => onNavigate(Path.SettingsSystemTasks),
  },
];
