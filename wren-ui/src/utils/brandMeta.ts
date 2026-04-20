import { Path } from '@/utils/enum';
import {
  isKnowledgeWorkbenchRoute,
  isModelingSurfaceRoute,
} from '@/utils/knowledgeWorkbench';
import type { ParsedUrlQuery } from 'querystring';

export const NOVA_APP_NAME = 'Nova';
export const NOVA_DEFAULT_TITLE = 'Nova · 数据知识库 AI 助手';
export const NOVA_DEFAULT_DESCRIPTION =
  '统一工作空间、知识库治理与结构化数据问答体验。';
export const NOVA_SOCIAL_IMAGE_PATH = '/social-card.png';

export const resolveNovaPageTitle = ({
  pathname,
  query,
}: {
  pathname?: string | null;
  query?: ParsedUrlQuery | Record<string, unknown>;
} = {}) => {
  if (
    pathname &&
    isModelingSurfaceRoute({
      pathname,
      query,
    })
  ) {
    return '建模 · Nova';
  }

  if (pathname && isKnowledgeWorkbenchRoute(pathname)) {
    return '知识库 · Nova';
  }

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
    case Path.Onboarding:
    case Path.OnboardingConnection:
    case Path.OnboardingModels:
    case Path.OnboardingRelationships:
      return '初始化设置 · Nova';
    case Path.Settings:
      return '设置 · Nova';
    case Path.SettingsWorkspace:
      return '工作空间 · Nova';
    case Path.SettingsConnectors:
      return '数据连接器 · Nova';
    case Path.SettingsSkills:
      return '技能管理 · Nova';
    case Path.SettingsUsers:
    case Path.SettingsPlatformUsers:
      return '用户管理 · Nova';
    case Path.SettingsPermissions:
    case Path.SettingsPlatformPermissions:
      return '权限管理 · Nova';
    case Path.SettingsAccess:
      return '用户管理 · Nova';
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
    case Path.SettingsPlatformWorkspaces:
      return '工作空间 · Nova';
    case Path.APIManagement:
    case Path.APIManagementHistory:
      return '调用诊断 · Nova';
    case Path.Workspace:
      return '工作空间 · Nova';
    case Path.WorkspaceSchedules:
      return '系统任务 · Nova';
    default:
      return NOVA_DEFAULT_TITLE;
  }
};
