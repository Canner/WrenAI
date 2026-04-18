import { Path } from '@/utils/enum';

export const NOVA_APP_NAME = 'Nova';
export const NOVA_DEFAULT_TITLE = 'Nova · 数据知识库 AI 助手';
export const NOVA_DEFAULT_DESCRIPTION =
  '统一工作空间、知识库治理与结构化数据问答体验。';
export const NOVA_SOCIAL_IMAGE_PATH = '/social-card.png';

export const resolveNovaPageTitle = (pathname?: string | null) => {
  switch (pathname) {
    case Path.Auth:
    case Path.Register:
      return '登录 · Nova';
    case Path.Home:
      return '新对话 · Nova';
    case Path.Thread:
      return '对话详情 · Nova';
    case Path.HomeDashboard:
      return '数据看板 · Nova';
    case Path.Knowledge:
      return '知识库 · Nova';
    case Path.Modeling:
      return '建模 · Nova';
    case Path.Onboarding:
    case Path.OnboardingConnection:
    case Path.OnboardingModels:
    case Path.OnboardingRelationships:
      return '初始化设置 · Nova';
    case Path.Settings:
      return '设置 · Nova';
    case Path.SettingsWorkspace:
      return '工作空间管理 · Nova';
    case Path.SettingsConnectors:
      return '数据连接器 · Nova';
    case Path.SettingsSkills:
      return '技能管理 · Nova';
    case Path.SettingsUsers:
      return '用户管理 · Nova';
    case Path.SettingsPermissions:
      return '权限管理 · Nova';
    case Path.SettingsAccess:
      return '访问控制 · Nova';
    case Path.SettingsIdentity:
      return '身份与目录 · Nova';
    case Path.SettingsAutomation:
      return '自动化 · Nova';
    case Path.SettingsAudit:
      return '审计日志 · Nova';
    case Path.SettingsDiagnostics:
      return '调用诊断 · Nova';
    case Path.SettingsSystemTasks:
      return '系统任务 · Nova';
    case Path.SettingsPlatform:
      return '平台设置 · Nova';
    case Path.APIManagement:
    case Path.APIManagementHistory:
      return 'API 管理 · Nova';
    case Path.Workspace:
      return '工作空间 · Nova';
    case Path.WorkspaceSchedules:
      return '调度任务 · Nova';
    default:
      return NOVA_DEFAULT_TITLE;
  }
};
