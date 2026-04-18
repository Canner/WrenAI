import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Select, Space, Table, Tag, message } from 'antd';
import AuditOutlined from '@ant-design/icons/AuditOutlined';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import {
  WorkspaceAuditEvent,
  WorkspaceGovernanceOverview,
  formatDateTime,
} from '@/components/pages/settings/workspaceGovernanceShared';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { Path } from '@/utils/enum';

export default function SettingsAuditPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = Boolean(
    authSession.data?.authorization?.actor?.platformRoleKeys?.includes(
      'platform_admin',
    ) ||
      authSession.data?.authorization?.actor?.isPlatformAdmin ||
      authSession.data?.isPlatformAdmin,
  );

  const workspaceOverviewUrl = useMemo(
    () =>
      runtimeScopePage.hasRuntimeScope
        ? buildRuntimeScopeUrl('/api/v1/workspace/current')
        : null,
    [runtimeScopePage.hasRuntimeScope],
  );

  const [workspaceOverview, setWorkspaceOverview] =
    useState<WorkspaceGovernanceOverview | null>(null);
  const [auditEvents, setAuditEvents] = useState<WorkspaceAuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilters, setAuditFilters] = useState({
    action: '',
    actorType: '',
    result: '',
    query: '',
  });

  const loadWorkspaceOverview = useCallback(async () => {
    if (!workspaceOverviewUrl || !authSession.authenticated) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(workspaceOverviewUrl, {
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '加载审计中心失败');
      }
      setWorkspaceOverview(payload as WorkspaceGovernanceOverview);
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载审计中心失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [authSession.authenticated, workspaceOverviewUrl]);

  const loadAuditEvents = useCallback(async () => {
    if (!workspaceOverviewUrl || !authSession.authenticated) {
      return;
    }

    try {
      setAuditLoading(true);
      const query = new URLSearchParams();
      query.set('limit', '50');
      if (auditFilters.action.trim())
        query.set('action', auditFilters.action.trim());
      if (auditFilters.actorType.trim())
        query.set('actorType', auditFilters.actorType.trim());
      if (auditFilters.result.trim())
        query.set('result', auditFilters.result.trim());
      if (auditFilters.query.trim())
        query.set('query', auditFilters.query.trim());

      const response = await fetch(
        buildRuntimeScopeUrl(
          `/api/v1/workspace/audit-events?${query.toString()}`,
        ),
        {
          credentials: 'include',
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403) {
          setAuditEvents([]);
          return;
        }
        throw new Error(payload.error || '加载审计事件失败');
      }
      setAuditEvents(Array.isArray(payload.events) ? payload.events : []);
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载审计事件失败',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setAuditLoading(false);
    }
  }, [auditFilters, authSession.authenticated, workspaceOverviewUrl]);

  useEffect(() => {
    void loadWorkspaceOverview();
  }, [loadWorkspaceOverview]);

  useEffect(() => {
    void loadAuditEvents();
  }, [loadAuditEvents]);

  const permissionActions = workspaceOverview?.permissions?.actions || {};
  const canReadAudit = Boolean(permissionActions['audit.read']);

  const resultSummary = useMemo(
    () => ({
      success: auditEvents.filter((event) =>
        ['allowed', 'succeeded'].includes(event.result),
      ).length,
      denied: auditEvents.filter((event) =>
        ['denied', 'failed'].includes(event.result),
      ).length,
      highRisk: auditEvents.filter((event) =>
        /(break_glass|impersonation|role_binding|service_account|api_token|identity_provider)/.test(
          event.action,
        ),
      ).length,
    }),
    [auditEvents],
  );

  return (
    <ConsoleShellLayout
      title="审计日志"
      description="查询授权、治理与高风险操作相关的审计事件。"
      eyebrow="Audit & Governance"
      loading={runtimeScopePage.guarding || authSession.loading}
      navItems={buildNovaSettingsNavItems({
        activeKey: 'settingsAudit',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: showPlatformManagement,
      })}
      hideHistorySection
      hideHeader
      contentBorderless
      sidebarBackAction={{
        label: '返回主菜单',
        onClick: () => runtimeScopeNavigation.pushWorkspace(Path.Home),
      }}
    >
      {!authSession.authenticated ? (
        <Alert
          className="console-alert"
          type="warning"
          showIcon
          message="当前未登录"
          description="请先登录后再查看审计日志。"
        />
      ) : (
        <div className="console-grid">
          <section className="console-panel" style={{ gridColumn: 'span 12' }}>
            <div className="console-panel-header">
              <div>
                <div className="console-panel-title">
                  <AuditOutlined style={{ marginRight: 8 }} />
                  审计事件
                </div>
                <div className="console-panel-subtitle">
                  最近事件 {auditEvents.length} · 成功 {resultSummary.success} ·
                  拒绝/失败 {resultSummary.denied} · 高风险{' '}
                  {resultSummary.highRisk}
                </div>
              </div>
            </div>
            {!canReadAudit ? (
              <Alert
                type="info"
                showIcon
                message="当前为只读提示"
                description="你没有 audit.read 权限，暂时无法查看审计事件。"
              />
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'minmax(0,1fr) 130px 120px minmax(0,1fr) auto',
                    gap: 8,
                  }}
                >
                  <Input
                    placeholder="Action（如 role.manage）"
                    value={auditFilters.action}
                    onChange={(event) =>
                      setAuditFilters((previous) => ({
                        ...previous,
                        action: event.target.value,
                      }))
                    }
                  />
                  <Select
                    allowClear
                    placeholder="ActorType"
                    value={auditFilters.actorType || undefined}
                    options={[
                      { label: 'user', value: 'user' },
                      { label: 'service_account', value: 'service_account' },
                      { label: 'system', value: 'system' },
                    ]}
                    onChange={(value) =>
                      setAuditFilters((previous) => ({
                        ...previous,
                        actorType: value || '',
                      }))
                    }
                  />
                  <Select
                    allowClear
                    placeholder="Result"
                    value={auditFilters.result || undefined}
                    options={[
                      { label: 'allowed', value: 'allowed' },
                      { label: 'denied', value: 'denied' },
                      { label: 'succeeded', value: 'succeeded' },
                      { label: 'failed', value: 'failed' },
                    ]}
                    onChange={(value) =>
                      setAuditFilters((previous) => ({
                        ...previous,
                        result: value || '',
                      }))
                    }
                  />
                  <Input
                    placeholder="关键字（actor/resource）"
                    value={auditFilters.query}
                    onChange={(event) =>
                      setAuditFilters((previous) => ({
                        ...previous,
                        query: event.target.value,
                      }))
                    }
                  />
                  <Button
                    loading={auditLoading}
                    onClick={() => void loadAuditEvents()}
                  >
                    刷新
                  </Button>
                </div>
                <Table
                  rowKey="id"
                  size="small"
                  loading={loading || auditLoading}
                  pagination={false}
                  locale={{ emptyText: '暂无审计事件' }}
                  dataSource={auditEvents}
                  columns={[
                    { title: 'Action', dataIndex: 'action', width: 180 },
                    {
                      title: 'Result',
                      dataIndex: 'result',
                      width: 110,
                      render: (value: string) => (
                        <Tag
                          color={
                            value === 'allowed' || value === 'succeeded'
                              ? 'green'
                              : value === 'denied' || value === 'failed'
                                ? 'red'
                                : 'default'
                          }
                        >
                          {value}
                        </Tag>
                      ),
                    },
                    {
                      title: 'Actor',
                      key: 'actor',
                      render: (_value, record: WorkspaceAuditEvent) =>
                        `${record.actorType || '-'}:${record.actorId || '-'}`,
                    },
                    {
                      title: 'Resource',
                      key: 'resource',
                      render: (_value, record: WorkspaceAuditEvent) =>
                        `${record.resourceType || '-'}:${record.resourceId || '-'}`,
                    },
                    {
                      title: '时间',
                      dataIndex: 'createdAt',
                      width: 150,
                      render: (value: string | null | undefined) =>
                        formatDateTime(value),
                    },
                  ]}
                />
              </Space>
            )}
          </section>
        </div>
      )}
    </ConsoleShellLayout>
  );
}
