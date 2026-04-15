import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Alert, Button, Input, Space, Tag, Typography, message } from 'antd';
import styled from 'styled-components';
import { buildRuntimeScopeUrl } from '@/apollo/client/runtimeScope';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';
import {
  loadWorkspaceOverview,
  peekWorkspaceOverview,
} from '@/utils/runtimePagePrefetch';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';

const { Text } = Typography;

type WorkspaceMemberView = {
  id: string;
  userId: string;
  roleKey: string;
  status: string;
  user?: {
    id: string;
    email: string;
    displayName?: string | null;
    status: string;
  } | null;
};

type WorkspaceListItem = {
  id: string;
  name: string;
  slug?: string | null;
  status?: string | null;
  kind?: 'regular' | 'default';
};

type WorkspaceOverviewPayload = {
  user?: {
    id: string;
    email: string;
    displayName?: string | null;
    isPlatformAdmin?: boolean;
    defaultWorkspaceId?: string | null;
  } | null;
  isPlatformAdmin?: boolean;
  defaultWorkspaceId?: string | null;
  workspace: WorkspaceListItem;
  membership?: {
    id: string;
    roleKey: string;
  } | null;
  permissions?: {
    canManageMembers?: boolean;
    canInviteMembers?: boolean;
    canApproveMembers?: boolean;
    canManageSchedules?: boolean;
    canCreateWorkspace?: boolean;
    actions?: Record<string, boolean>;
  } | null;
  authorization?: {
    actor?: {
      principalType: string;
      workspaceRoleKeys?: string[];
      platformRoleKeys?: string[];
      isPlatformAdmin?: boolean;
    } | null;
  } | null;
  workspaces: WorkspaceListItem[];
  discoverableWorkspaces: WorkspaceListItem[];
  serviceAccounts?: Array<{
    id: string;
    workspaceId: string;
    name: string;
    description?: string | null;
    roleKey: string;
    status: string;
    tokenCount?: number;
    activeTokenCount?: number;
    lastUsedAt?: string | null;
    createdAt?: string | null;
  }>;
  apiTokens?: Array<{
    id: string;
    workspaceId: string;
    serviceAccountId?: string | null;
    name: string;
    prefix: string;
    status: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
    lastUsedAt?: string | null;
  }>;
  identityProviders?: Array<{
    id: string;
    providerType: string;
    name: string;
    enabled: boolean;
    configJson?: Record<string, any> | null;
  }>;
  directoryGroups?: Array<{
    id: string;
    workspaceId: string;
    displayName: string;
    source: string;
    status: string;
    roleKeys?: string[];
    memberIds?: string[];
    memberCount?: number;
    createdAt?: string | null;
    updatedAt?: string | null;
  }>;
  breakGlassGrants?: Array<{
    id: string;
    workspaceId: string;
    userId: string;
    roleKey: string;
    status: string;
    reason: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
  }>;
  accessReviews?: Array<{
    id: string;
    title: string;
    status: string;
    createdAt?: string | null;
    dueAt?: string | null;
    items: Array<{
      id: string;
      userId?: string | null;
      roleKey?: string | null;
      status: string;
      decision?: string | null;
      reviewedAt?: string | null;
      notes?: string | null;
    }>;
  }>;
  impersonation?: {
    active?: boolean;
    canStop?: boolean;
    impersonatorUserId?: string | null;
    reason?: string | null;
  } | null;
  applications: Array<{
    id: string;
    workspaceId: string;
    workspaceName: string;
    status: string;
    roleKey?: string | null;
    kind?: 'regular' | 'default';
    createdAt?: string | null;
    updatedAt?: string | null;
  }>;
  stats: {
    workspaceCount: number;
    knowledgeBaseCount: number;
    memberCount: number;
    reviewQueueCount?: number;
    serviceAccountCount?: number;
    enterpriseSsoCount?: number;
    accessReviewCount?: number;
    directoryGroupCount?: number;
    breakGlassGrantCount?: number;
  };
  members: WorkspaceMemberView[];
  reviewQueue?: WorkspaceMemberView[];
};

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
};

const STATUS_LABELS: Record<string, string> = {
  active: '启用',
  invited: '待接受',
  pending: '待审批',
  rejected: '已拒绝',
  inactive: '停用',
};

const WORKSPACE_KIND_LABELS: Record<string, string> = {
  regular: '业务空间',
  default: '系统样例空间',
};

const WORKSPACE_KIND_DESCRIPTIONS: Record<string, string> = {
  regular: '支持邀请成员与申请加入，承载真实业务数据与知识库。',
  default: '系统预置样例空间，自动加入，仅用于浏览与体验样例数据。',
};

const IDENTITY_PROVIDER_LABELS: Record<string, string> = {
  oidc: 'OIDC',
  saml: 'SAML',
};

const PanelGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.92fr);
  gap: 16px;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

const WorkspaceCardList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const WorkspaceCard = styled.div`
  padding: 16px 16px 14px;
  border-radius: 20px;
  border: 1px solid var(--nova-outline-soft);
  background: linear-gradient(180deg, #ffffff 0%, #fafafe 100%);
  box-shadow: 0 14px 30px -20px rgba(31, 35, 50, 0.24);
`;

const WorkspaceCardMeta = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
`;

const WorkspaceSummary = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const WorkspaceActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
`;

const CenterTabs = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px;
  border-radius: 18px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(255, 255, 255, 0.82);
  margin-bottom: 16px;
`;

const CenterTab = styled.button<{ $active?: boolean }>`
  height: 40px;
  border-radius: 999px;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(111, 71, 255, 0.18)' : 'rgba(15, 23, 42, 0.06)'};
  background: ${(props) =>
    props.$active
      ? 'linear-gradient(180deg, rgba(238, 233, 252, 0.92) 0%, rgba(255, 255, 255, 0.98) 100%)'
      : 'rgba(255, 255, 255, 0.92)'};
  color: ${(props) => (props.$active ? '#6f47ff' : '#4b5565')};
  padding: 0 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
`;

const FlatSearchInput = styled(Input.Search)`
  &&.ant-input-search .ant-input-group .ant-input-affix-wrapper,
  &&.ant-input-affix-wrapper {
    border-radius: 10px;
    border-color: #e5e9f3;
    box-shadow: none;
  }

  &&.ant-input-search .ant-input-group .ant-input-affix-wrapper .ant-input,
  &&.ant-input-affix-wrapper .ant-input {
    border: 0 !important;
    box-shadow: none !important;
    background: transparent !important;
  }
`;

const AsideStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const QueuePreviewList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const QueuePreviewCard = styled.div`
  border-radius: 16px;
  border: 1px solid var(--nova-outline-soft);
  background: rgba(248, 246, 251, 0.96);
  padding: 12px 14px;
`;

const SummaryList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SummaryRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid var(--nova-outline-soft);
`;

const GovernanceGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const governanceCardMetricStyle = {
  display: 'block',
  fontSize: 26,
  lineHeight: 1.1,
  marginBottom: 8,
} as const;

const applicationStatusColor = (status: string) => {
  switch (status) {
    case 'active':
      return 'green';
    case 'pending':
      return 'gold';
    case 'invited':
      return 'blue';
    case 'rejected':
      return 'red';
    case 'inactive':
      return 'default';
    default:
      return 'default';
  }
};

const workspaceKindColor = (kind?: string | null) => {
  switch (kind) {
    case 'default':
      return 'geekblue';
    case 'regular':
      return 'green';
    default:
      return 'default';
  }
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getCertificateExpiryStatus = (
  configJson?: Record<string, any> | null,
) => {
  const certificateSummaries = configJson?.signingCertificateSummaries;
  const summaries = Array.isArray(certificateSummaries)
    ? certificateSummaries
    : [];
  if (summaries.some((summary) => summary?.status === 'expired')) {
    return {
      text: '证书已过期，请尽快刷新 metadata 或替换证书',
      type: 'danger' as const,
      level: 'expired' as const,
    };
  }
  if (summaries.some((summary) => summary?.status === 'expiring_soon')) {
    return {
      text: '证书将在 30 天内到期，请尽快刷新 metadata 或替换证书',
      type: 'warning' as const,
      level: 'expiring_soon' as const,
    };
  }
  const expiryAt = configJson?.earliestCertificateExpiryAt;
  if (!expiryAt) {
    return {
      text: '最近证书到期：—',
      type: 'secondary' as const,
      level: 'unknown' as const,
    };
  }

  const expiryDate = new Date(expiryAt);
  if (Number.isNaN(expiryDate.getTime())) {
    return {
      text: '最近证书到期：—',
      type: 'secondary' as const,
      level: 'unknown' as const,
    };
  }

  const diff = expiryDate.getTime() - Date.now();
  if (diff <= 0) {
    return {
      text: `证书已于 ${formatDateTime(expiryAt)} 过期`,
      type: 'danger' as const,
      level: 'expired' as const,
    };
  }
  if (diff <= 30 * 24 * 60 * 60 * 1000) {
    return {
      text: `最近证书将于 ${formatDateTime(expiryAt)} 到期`,
      type: 'warning' as const,
      level: 'expiring_soon' as const,
    };
  }

  return {
    text: `最近证书到期：${formatDateTime(expiryAt)}`,
    type: 'secondary' as const,
    level: 'healthy' as const,
  };
};

export default function WorkspacePage() {
  const router = useRouter();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const workspaceOverviewUrl = useMemo(
    () =>
      runtimeScopePage.hasRuntimeScope
        ? buildRuntimeScopeUrl('/api/v1/workspace/current')
        : null,
    [runtimeScopePage.hasRuntimeScope],
  );
  const cachedOverview = useMemo(
    () =>
      workspaceOverviewUrl
        ? peekWorkspaceOverview<WorkspaceOverviewPayload>(workspaceOverviewUrl)
        : null,
    [workspaceOverviewUrl],
  );
  const [activeTab, setActiveTab] = useState<
    'mine' | 'discover' | 'applications'
  >('mine');
  const [loading, setLoading] = useState(!cachedOverview);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WorkspaceOverviewPayload | null>(
    cachedOverview,
  );
  const dataRef = useRef<WorkspaceOverviewPayload | null>(cachedOverview);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [workspaceAction, setWorkspaceAction] = useState<{
    workspaceId: string;
    action: 'join' | 'apply';
  } | null>(null);

  const loadOverview = useCallback(async () => {
    if (!runtimeScopePage.hasRuntimeScope || !workspaceOverviewUrl) {
      return;
    }

    const nextCachedOverview =
      peekWorkspaceOverview<WorkspaceOverviewPayload>(workspaceOverviewUrl);
    setLoading(!nextCachedOverview && !dataRef.current);
    setError(null);

    try {
      const payload =
        await loadWorkspaceOverview<WorkspaceOverviewPayload>(
          workspaceOverviewUrl,
        );
      setData(payload);
      return payload;
    } catch (fetchError: any) {
      setError(fetchError?.message || '加载工作区信息失败');
      setData(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [runtimeScopePage.hasRuntimeScope, workspaceOverviewUrl]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const workspaceCards = useMemo(
    () => data?.workspaces || [],
    [data?.workspaces],
  );
  const discoverableWorkspaces = useMemo(
    () => data?.discoverableWorkspaces || [],
    [data?.discoverableWorkspaces],
  );
  const applicationRecords = useMemo(
    () => data?.applications || [],
    [data?.applications],
  );
  const reviewQueue = useMemo(
    () => data?.reviewQueue || [],
    [data?.reviewQueue],
  );
  const permissionActions = data?.permissions?.actions || {};
  const canManageMembers =
    Boolean(permissionActions['workspace.member.status.update']) ||
    Boolean(data?.permissions?.canManageMembers);
  const canInviteMembers =
    Boolean(permissionActions['workspace.member.invite']) ||
    Boolean(data?.permissions?.canInviteMembers);
  const canCreateWorkspace =
    Boolean(permissionActions['workspace.create']) ||
    Boolean(data?.permissions?.canCreateWorkspace);
  const canReadServiceAccounts = Boolean(
    permissionActions['service_account.read'],
  );
  const canReadApiTokens = Boolean(permissionActions['api_token.read']);
  const canReadIdentityProviders = Boolean(
    permissionActions['identity_provider.read'],
  );
  const canReadAccessReviews = Boolean(permissionActions['access_review.read']);
  const canReadGroups = Boolean(permissionActions['group.read']);
  const canManageBreakGlass = Boolean(permissionActions['break_glass.manage']);
  const canStartImpersonation = Boolean(
    permissionActions['impersonation.start'],
  );
  const defaultWorkspaceId =
    data?.defaultWorkspaceId || data?.user?.defaultWorkspaceId || null;
  const isPlatformAdmin = canCreateWorkspace || Boolean(data?.isPlatformAdmin);
  const actorWorkspaceRoles =
    data?.authorization?.actor?.workspaceRoleKeys || [];
  const actorPlatformRoles = data?.authorization?.actor?.platformRoleKeys || [];
  const identityProviders = useMemo(
    () => data?.identityProviders || [],
    [data?.identityProviders],
  );
  const enabledIdentityProviderCount = useMemo(
    () => identityProviders.filter((provider) => provider.enabled).length,
    [identityProviders],
  );
  const samlCertificateAlertSummary = useMemo(() => {
    let expiredProviderCount = 0;
    let expiringSoonProviderCount = 0;

    identityProviders.forEach((provider) => {
      if (!provider.enabled || provider.providerType !== 'saml') {
        return;
      }
      const status = getCertificateExpiryStatus(provider.configJson);
      if (status.level === 'expired') {
        expiredProviderCount += 1;
      } else if (status.level === 'expiring_soon') {
        expiringSoonProviderCount += 1;
      }
    });

    if (!expiredProviderCount && !expiringSoonProviderCount) {
      return null;
    }

    if (expiredProviderCount > 0) {
      return {
        type: 'error' as const,
        message: 'SAML 证书健康告警',
        description:
          expiringSoonProviderCount > 0
            ? `有 ${expiredProviderCount} 个已启用 SAML 提供方证书已过期，另有 ${expiringSoonProviderCount} 个将在 30 天内到期，请前往“设置 > 身份与目录”处理。`
            : `有 ${expiredProviderCount} 个已启用 SAML 提供方证书已过期，请前往“设置 > 身份与目录”处理。`,
      };
    }

    return {
      type: 'warning' as const,
      message: 'SAML 证书健康告警',
      description: `有 ${expiringSoonProviderCount} 个已启用 SAML 提供方证书将在 30 天内到期，请前往“设置 > 身份与目录”处理。`,
    };
  }, [identityProviders]);
  const scimEnabledProviderCount = useMemo(
    () =>
      identityProviders.filter((provider) =>
        Boolean(
          provider.configJson?.hasScimBearerToken ||
            provider.configJson?.scimBearerToken,
        ),
      ).length,
    [identityProviders],
  );
  const accessReviews = useMemo(
    () => data?.accessReviews || [],
    [data?.accessReviews],
  );
  const directoryGroups = useMemo(
    () => data?.directoryGroups || [],
    [data?.directoryGroups],
  );
  const breakGlassGrants = useMemo(
    () => data?.breakGlassGrants || [],
    [data?.breakGlassGrants],
  );
  const normalizedSearchKeyword = searchKeyword.trim().toLowerCase();

  const filteredWorkspaceCards = useMemo(() => {
    if (!normalizedSearchKeyword) {
      return workspaceCards;
    }

    return workspaceCards.filter((item) => {
      const name = String(item.name || '').toLowerCase();
      const slug = String(item.slug || '').toLowerCase();
      return (
        name.includes(normalizedSearchKeyword) ||
        slug.includes(normalizedSearchKeyword)
      );
    });
  }, [normalizedSearchKeyword, workspaceCards]);

  const filteredDiscoverableWorkspaces = useMemo(() => {
    if (!normalizedSearchKeyword) {
      return discoverableWorkspaces;
    }

    return discoverableWorkspaces.filter((item) => {
      const name = String(item.name || '').toLowerCase();
      const slug = String(item.slug || '').toLowerCase();
      return (
        name.includes(normalizedSearchKeyword) ||
        slug.includes(normalizedSearchKeyword)
      );
    });
  }, [discoverableWorkspaces, normalizedSearchKeyword]);

  const filteredApplicationRecords = useMemo(() => {
    if (!normalizedSearchKeyword) {
      return applicationRecords;
    }

    return applicationRecords.filter((item) =>
      String(item.workspaceName || '')
        .toLowerCase()
        .includes(normalizedSearchKeyword),
    );
  }, [applicationRecords, normalizedSearchKeyword]);

  const governanceCenterVisible =
    canInviteMembers ||
    canManageMembers ||
    canReadServiceAccounts ||
    canReadApiTokens ||
    canReadIdentityProviders ||
    canReadAccessReviews ||
    canReadGroups ||
    canManageBreakGlass ||
    canStartImpersonation;

  const activeBreakGlassCount = useMemo(
    () =>
      breakGlassGrants.filter(
        (grant) => !grant.revokedAt && grant.status === 'active',
      ).length,
    [breakGlassGrants],
  );
  const recentEnabledIdentityProviders = useMemo(
    () =>
      identityProviders
        .filter((provider) => provider.enabled)
        .slice(0, 2)
        .map(
          (provider) =>
            `${IDENTITY_PROVIDER_LABELS[provider.providerType] || provider.providerType} · ${provider.name}`,
        ),
    [identityProviders],
  );

  const switchWorkspace = async (workspaceId: string) => {
    const nextUrl = buildRuntimeScopeUrl(
      Path.SettingsWorkspace,
      {},
      {
        workspaceId,
      },
    );
    await router.replace(nextUrl);
  };

  const openWorkspacePath = async (workspaceId: string, path: string) => {
    const nextUrl = buildRuntimeScopeUrl(path, {}, { workspaceId });
    await router.replace(nextUrl);
  };

  const handleWorkspaceAction = async (
    workspaceId: string,
    action: 'join' | 'apply',
  ) => {
    try {
      setWorkspaceAction({ workspaceId, action });
      const endpoint =
        action === 'join'
          ? '/api/v1/workspace/join'
          : '/api/v1/workspace/apply';
      const response = await fetch(buildRuntimeScopeUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workspaceId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || '工作区操作失败');
      }

      if (action === 'join') {
        message.success('已加入工作空间');
        await switchWorkspace(workspaceId);
        return;
      }

      message.success('已提交加入申请，等待管理员审批');
      setActiveTab('applications');
      await loadOverview();
    } catch (actionError: any) {
      message.error(actionError?.message || '工作区操作失败');
    } finally {
      setWorkspaceAction(null);
    }
  };

  const handleSetDefaultWorkspace = async (workspaceId: string) => {
    try {
      const response = await fetch('/api/v1/workspace/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ defaultWorkspaceId: workspaceId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '设置默认工作空间失败');
      }

      message.success('默认进入工作空间已更新');
      await loadOverview();
    } catch (actionError: any) {
      message.error(actionError?.message || '设置默认工作空间失败');
    }
  };

  if (runtimeScopePage.guarding) {
    return (
      <ConsoleShellLayout
        navItems={buildNovaSettingsNavItems({
          activeKey: 'settingsWorkspace',
          onNavigate: runtimeScopeNavigation.pushWorkspace,
          showPlatformAdmin: isPlatformAdmin,
        })}
        title="工作空间"
        hideHeader
        contentBorderless
        loading
      />
    );
  }

  return (
    <ConsoleShellLayout
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsWorkspace',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: isPlatformAdmin,
      })}
      title="工作空间"
      hideHeader
      contentBorderless
    >
      {error ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          message="加载工作区信息失败"
          description={error}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <CenterTabs>
        <CenterTab
          type="button"
          $active={activeTab === 'mine'}
          onClick={() => setActiveTab('mine')}
        >
          我的工作空间
        </CenterTab>
        <CenterTab
          type="button"
          $active={activeTab === 'discover'}
          onClick={() => setActiveTab('discover')}
        >
          发现工作空间
        </CenterTab>
        <CenterTab
          type="button"
          $active={activeTab === 'applications'}
          onClick={() => setActiveTab('applications')}
        >
          申请记录
        </CenterTab>
      </CenterTabs>

      <PanelGrid>
        <section className="console-panel">
          <div className="console-panel-header">
            <div>
              <div className="console-panel-title">
                {activeTab === 'mine'
                  ? '我可访问的工作空间'
                  : activeTab === 'discover'
                    ? '发现工作空间'
                    : '申请记录'}
              </div>
              <div className="console-panel-subtitle">
                {activeTab === 'mine'
                  ? '聚焦工作空间切换、默认进入偏好与常用入口。'
                  : activeTab === 'discover'
                    ? '发现其他业务工作空间并提交加入申请。'
                    : '跟踪邀请、申请与审批结果，并在收到邀请后直接接受。'}
              </div>
            </div>
          </div>
          <FlatSearchInput
            allowClear
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder="搜索工作空间名称或标识"
            style={{ marginBottom: 16 }}
          />

          {activeTab === 'mine' ? (
            filteredWorkspaceCards.length === 0 ? (
              <Text type="secondary">
                {loading ? '加载中…' : '暂无工作空间'}
              </Text>
            ) : (
              <WorkspaceCardList>
                {filteredWorkspaceCards.map((item) => {
                  const isCurrent = item.id === data?.workspace.id;
                  return (
                    <WorkspaceCard key={item.id}>
                      <WorkspaceCardMeta>
                        <Space align="center" size={8} wrap>
                          <Text strong>
                            {getReferenceDisplayWorkspaceName(item.name)}
                          </Text>
                          {isCurrent ? <Tag color="purple">当前</Tag> : null}
                          <Tag color={workspaceKindColor(item.kind)}>
                            {WORKSPACE_KIND_LABELS[item.kind || 'regular']}
                          </Tag>
                          {item.id === defaultWorkspaceId ? (
                            <Tag color="gold">默认进入</Tag>
                          ) : null}
                        </Space>
                        <Text type="secondary">{item.slug || item.id}</Text>
                      </WorkspaceCardMeta>
                      <WorkspaceSummary>
                        <Text type="secondary">
                          {isCurrent
                            ? '当前所有一级工作台都会跟随此工作空间切换。'
                            : '可快速切换后进入当前工作空间的知识库、看板与调度。'}
                        </Text>
                      </WorkspaceSummary>
                      <WorkspaceActionRow>
                        <Button
                          size="small"
                          type={isCurrent ? 'default' : 'primary'}
                          onClick={() => void switchWorkspace(item.id)}
                        >
                          {isCurrent ? '进入当前工作空间' : '切换到此工作空间'}
                        </Button>
                        <Button
                          size="small"
                          onClick={() =>
                            void openWorkspacePath(item.id, Path.Knowledge)
                          }
                        >
                          查看知识库
                        </Button>
                        <Button
                          size="small"
                          onClick={() =>
                            void openWorkspacePath(item.id, Path.HomeDashboard)
                          }
                        >
                          查看数据看板
                        </Button>
                        <Button
                          size="small"
                          onClick={() =>
                            void openWorkspacePath(
                              item.id,
                              Path.SettingsSystemTasks,
                            )
                          }
                        >
                          查看系统任务
                        </Button>
                        {item.id !== defaultWorkspaceId ? (
                          <Button
                            size="small"
                            onClick={() =>
                              void handleSetDefaultWorkspace(item.id)
                            }
                          >
                            设为默认进入
                          </Button>
                        ) : null}
                      </WorkspaceActionRow>
                    </WorkspaceCard>
                  );
                })}
              </WorkspaceCardList>
            )
          ) : activeTab === 'discover' ? (
            filteredDiscoverableWorkspaces.length === 0 ? (
              <Text type="secondary">
                {loading ? '加载中…' : '当前没有更多可加入的工作空间'}
              </Text>
            ) : (
              <WorkspaceCardList>
                {filteredDiscoverableWorkspaces.map((item) => {
                  const isRunning =
                    workspaceAction?.workspaceId === item.id &&
                    workspaceAction.action === 'apply';
                  return (
                    <WorkspaceCard key={item.id}>
                      <WorkspaceCardMeta>
                        <Space align="center" size={8} wrap>
                          <Text strong>
                            {getReferenceDisplayWorkspaceName(item.name)}
                          </Text>
                          <Tag color={workspaceKindColor(item.kind)}>
                            {WORKSPACE_KIND_LABELS[item.kind || 'regular']}
                          </Tag>
                        </Space>
                        <Text type="secondary">{item.slug || item.id}</Text>
                      </WorkspaceCardMeta>
                      <Text type="secondary">
                        {WORKSPACE_KIND_DESCRIPTIONS[item.kind || 'regular']}
                      </Text>
                      <WorkspaceActionRow>
                        <Button
                          size="small"
                          type="primary"
                          loading={isRunning}
                          onClick={() =>
                            void handleWorkspaceAction(item.id, 'apply')
                          }
                        >
                          申请加入
                        </Button>
                      </WorkspaceActionRow>
                    </WorkspaceCard>
                  );
                })}
              </WorkspaceCardList>
            )
          ) : filteredApplicationRecords.length === 0 ? (
            <Space direction="vertical" size={12}>
              <Text type="secondary">
                暂无加入记录。你可以先去发现工作空间并提交加入申请。
              </Text>
              <Button onClick={() => setActiveTab('discover')}>
                去发现工作空间
              </Button>
            </Space>
          ) : (
            <WorkspaceCardList>
              {filteredApplicationRecords.map((item) => (
                <WorkspaceCard key={item.id}>
                  <WorkspaceCardMeta>
                    <Text strong>{item.workspaceName}</Text>
                    <Tag color={applicationStatusColor(item.status)}>
                      {STATUS_LABELS[item.status] || item.status}
                    </Tag>
                  </WorkspaceCardMeta>
                  <Space size={[8, 8]} wrap>
                    <Tag color={workspaceKindColor(item.kind)}>
                      {WORKSPACE_KIND_LABELS[item.kind || 'regular']}
                    </Tag>
                    {item.roleKey ? (
                      <Tag color="blue">
                        申请角色：{ROLE_LABELS[item.roleKey] || item.roleKey}
                      </Tag>
                    ) : null}
                  </Space>
                  <WorkspaceSummary>
                    <Text type="secondary">
                      最近更新时间：
                      {formatDateTime(item.updatedAt || item.createdAt)}
                    </Text>
                  </WorkspaceSummary>
                  {item.status === 'invited' ? (
                    <WorkspaceActionRow>
                      <Button
                        size="small"
                        type="primary"
                        loading={
                          workspaceAction?.workspaceId === item.workspaceId &&
                          workspaceAction?.action === 'join'
                        }
                        onClick={() =>
                          void handleWorkspaceAction(item.workspaceId, 'join')
                        }
                      >
                        接受邀请
                      </Button>
                    </WorkspaceActionRow>
                  ) : null}
                </WorkspaceCard>
              ))}
            </WorkspaceCardList>
          )}
        </section>

        <section className="console-panel">
          <AsideStack>
            <div>
              <div className="console-panel-title">工作空间运营摘要</div>
              <div className="console-panel-subtitle">
                当前页只保留运营信息、默认进入与常用入口。
              </div>
            </div>

            {samlCertificateAlertSummary ? (
              <Alert
                type={samlCertificateAlertSummary.type}
                showIcon
                message={samlCertificateAlertSummary.message}
                description={samlCertificateAlertSummary.description}
                action={
                  governanceCenterVisible ? (
                    <Button
                      size="small"
                      onClick={() =>
                        runtimeScopeNavigation.pushWorkspace(
                          Path.SettingsIdentity,
                        )
                      }
                    >
                      打开身份与目录
                    </Button>
                  ) : undefined
                }
              />
            ) : null}

            {isPlatformAdmin ? (
              <Alert
                type="info"
                showIcon
                message="平台治理"
                description="创建工作空间、平台级治理与高风险操作入口统一从这里进入。"
                action={
                  <Button
                    size="small"
                    onClick={() =>
                      runtimeScopeNavigation.pushWorkspace(
                        Path.SettingsPlatform,
                      )
                    }
                  >
                    打开平台治理
                  </Button>
                }
              />
            ) : null}

            <SummaryList>
              <SummaryRow>
                <Text type="secondary">空间类型</Text>
                <Tag color={workspaceKindColor(data?.workspace?.kind)}>
                  {WORKSPACE_KIND_LABELS[data?.workspace?.kind || 'regular']}
                </Tag>
              </SummaryRow>
              <SummaryRow>
                <Text type="secondary">默认进入</Text>
                <Text strong>
                  {data?.workspace?.id === defaultWorkspaceId ? '是' : '否'}
                </Text>
              </SummaryRow>
              <SummaryRow>
                <Text type="secondary">我的角色</Text>
                <Text strong>
                  {ROLE_LABELS[data?.membership?.roleKey || 'member'] || '成员'}
                </Text>
              </SummaryRow>
              <SummaryRow>
                <Text type="secondary">授权角色</Text>
                <Space size={6} wrap>
                  {(actorWorkspaceRoles.length > 0
                    ? actorWorkspaceRoles
                    : [data?.membership?.roleKey || 'member']
                  ).map((roleKey) => (
                    <Tag key={roleKey} color="blue">
                      {ROLE_LABELS[roleKey] || roleKey}
                    </Tag>
                  ))}
                  {actorPlatformRoles.map((roleKey) => (
                    <Tag key={roleKey} color="purple">
                      {roleKey === 'platform_admin' ? '平台管理员' : roleKey}
                    </Tag>
                  ))}
                </Space>
              </SummaryRow>
              <SummaryRow>
                <Text type="secondary">知识库</Text>
                <Text strong>{data?.stats.knowledgeBaseCount ?? 0}</Text>
              </SummaryRow>
              <SummaryRow>
                <Text type="secondary">成员数</Text>
                <Text strong>{data?.stats.memberCount ?? 0}</Text>
              </SummaryRow>
              <SummaryRow>
                <Text type="secondary">待处理申请</Text>
                <Text strong>
                  {data?.stats.reviewQueueCount ?? reviewQueue.length}
                </Text>
              </SummaryRow>
            </SummaryList>

            <div>
              <div className="console-panel-title" style={{ fontSize: 15 }}>
                常用入口
              </div>
              <div className="console-panel-subtitle" style={{ marginTop: 4 }}>
                直接跳到具体功能页，不在这里堆治理详情。
              </div>
              <WorkspaceActionRow>
                <Button
                  onClick={() =>
                    runtimeScopeNavigation.pushWorkspace(Path.Knowledge)
                  }
                >
                  查看我的知识库
                </Button>
                <Button
                  onClick={() =>
                    runtimeScopeNavigation.pushWorkspace(Path.HomeDashboard)
                  }
                >
                  查看数据看板
                </Button>
                <Button
                  onClick={() =>
                    runtimeScopeNavigation.pushWorkspace(
                      Path.SettingsSystemTasks,
                    )
                  }
                >
                  查看系统任务
                </Button>
                {governanceCenterVisible ? (
                  <Button
                    onClick={() =>
                      runtimeScopeNavigation.pushWorkspace(Path.SettingsUsers)
                    }
                  >
                    打开用户管理
                  </Button>
                ) : null}
                {governanceCenterVisible ? (
                  <Button
                    onClick={() =>
                      runtimeScopeNavigation.pushWorkspace(
                        Path.SettingsPermissions,
                      )
                    }
                  >
                    打开权限管理
                  </Button>
                ) : null}
                {canReadIdentityProviders ? (
                  <Button
                    onClick={() =>
                      runtimeScopeNavigation.pushWorkspace(
                        Path.SettingsIdentity,
                      )
                    }
                  >
                    打开身份与目录
                  </Button>
                ) : null}
                {permissionActions['audit.read'] ? (
                  <Button
                    onClick={() =>
                      runtimeScopeNavigation.pushWorkspace(Path.SettingsAudit)
                    }
                  >
                    打开审计日志
                  </Button>
                ) : null}
                {isPlatformAdmin ? (
                  <Button
                    onClick={() =>
                      runtimeScopeNavigation.pushWorkspace(
                        Path.SettingsPlatform,
                      )
                    }
                  >
                    打开平台治理
                  </Button>
                ) : null}
                {data?.workspace?.id !== defaultWorkspaceId ? (
                  <Button
                    onClick={() =>
                      void handleSetDefaultWorkspace(data!.workspace.id)
                    }
                  >
                    设为默认进入
                  </Button>
                ) : null}
              </WorkspaceActionRow>
            </div>

            {canManageMembers ? (
              <div>
                <div className="console-panel-title" style={{ fontSize: 15 }}>
                  审批预览
                </div>
                <div
                  className="console-panel-subtitle"
                  style={{ marginTop: 4 }}
                >
                  待处理申请会在这里预览；审批、邀请与成员状态调整请前往“设置
                  &gt; 用户管理”。
                </div>
                <QueuePreviewList style={{ marginTop: 12 }}>
                  {(reviewQueue.length > 0 ? reviewQueue.slice(0, 3) : []).map(
                    (member) => (
                      <QueuePreviewCard key={`queue-preview-${member.id}`}>
                        <Space
                          align="center"
                          style={{
                            width: '100%',
                            justifyContent: 'space-between',
                          }}
                        >
                          <Space direction="vertical" size={2}>
                            <Text strong>
                              {member.user?.displayName ||
                                member.user?.email ||
                                member.userId}
                            </Text>
                            <Text type="secondary">
                              {member.user?.email || member.userId}
                            </Text>
                          </Space>
                          <Tag color={applicationStatusColor(member.status)}>
                            {STATUS_LABELS[member.status] || member.status}
                          </Tag>
                        </Space>
                      </QueuePreviewCard>
                    ),
                  )}
                  {reviewQueue.length === 0 ? (
                    <QueuePreviewCard>
                      <Text type="secondary">
                        当前没有待审批成员，新的加入申请会展示在“设置 &gt;
                        用户管理”。
                      </Text>
                    </QueuePreviewCard>
                  ) : null}
                </QueuePreviewList>
              </div>
            ) : null}

            {governanceCenterVisible ? (
              <div>
                <div className="console-panel-title">设置快捷入口</div>
                <div className="console-panel-subtitle">
                  左侧菜单已经分层，这里只保留重点入口和当前数字。
                </div>
                <GovernanceGrid style={{ marginTop: 12 }}>
                  <WorkspaceCard>
                    <Text strong style={governanceCardMetricStyle}>
                      {data?.stats.memberCount ?? 0}
                    </Text>
                    <Text strong>用户与权限</Text>
                    <WorkspaceSummary>
                      <Text type="secondary">
                        成员生命周期、角色与授权都已拆成独立页面。
                      </Text>
                      <Text type="secondary">
                        待处理申请：
                        {data?.stats.reviewQueueCount ?? reviewQueue.length} 条
                      </Text>
                    </WorkspaceSummary>
                    <WorkspaceActionRow>
                      <Button
                        size="small"
                        type="primary"
                        onClick={() =>
                          runtimeScopeNavigation.pushWorkspace(
                            Path.SettingsUsers,
                          )
                        }
                      >
                        打开用户管理
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          runtimeScopeNavigation.pushWorkspace(
                            Path.SettingsPermissions,
                          )
                        }
                      >
                        打开权限管理
                      </Button>
                    </WorkspaceActionRow>
                  </WorkspaceCard>

                  <WorkspaceCard>
                    <Text strong style={governanceCardMetricStyle}>
                      {enabledIdentityProviderCount}
                    </Text>
                    <Text strong>身份与目录</Text>
                    <WorkspaceSummary>
                      <Text type="secondary">
                        企业 SSO / OIDC / SAML / SCIM：
                        {enabledIdentityProviderCount} 个已启用
                      </Text>
                      <Text type="secondary">
                        目录组：{directoryGroups.length} 个；SCIM 同步：
                        {scimEnabledProviderCount} 个
                      </Text>
                      {recentEnabledIdentityProviders.length > 0 ? (
                        <Text type="secondary">
                          {recentEnabledIdentityProviders.join('；')}
                        </Text>
                      ) : null}
                    </WorkspaceSummary>
                    <WorkspaceActionRow>
                      <Button
                        size="small"
                        onClick={() =>
                          runtimeScopeNavigation.pushWorkspace(
                            Path.SettingsIdentity,
                          )
                        }
                      >
                        打开身份与目录
                      </Button>
                    </WorkspaceActionRow>
                  </WorkspaceCard>

                  <WorkspaceCard>
                    <Text strong style={governanceCardMetricStyle}>
                      {accessReviews.length}
                    </Text>
                    <Text strong>审计与高风险动作</Text>
                    <WorkspaceSummary>
                      <Text type="secondary">
                        Access Review：{accessReviews.length} 个；Break-glass：
                        {activeBreakGlassCount} 条生效中
                      </Text>
                      <Text type="secondary">
                        代理登录：
                        {data?.impersonation?.active
                          ? '当前会话已开启'
                          : '当前未开启'}
                      </Text>
                    </WorkspaceSummary>
                    <WorkspaceActionRow>
                      <Button
                        size="small"
                        onClick={() =>
                          runtimeScopeNavigation.pushWorkspace(
                            Path.SettingsAudit,
                          )
                        }
                      >
                        打开审计日志
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          runtimeScopeNavigation.pushWorkspace(
                            Path.SettingsPermissions,
                          )
                        }
                      >
                        打开权限管理
                      </Button>
                      {isPlatformAdmin ? (
                        <Button
                          size="small"
                          onClick={() =>
                            runtimeScopeNavigation.pushWorkspace(
                              Path.SettingsPlatform,
                            )
                          }
                        >
                          打开平台治理
                        </Button>
                      ) : null}
                    </WorkspaceActionRow>
                  </WorkspaceCard>
                </GovernanceGrid>
              </div>
            ) : null}
          </AsideStack>
        </section>
      </PanelGrid>
    </ConsoleShellLayout>
  );
}
