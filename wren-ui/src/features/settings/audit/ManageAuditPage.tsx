import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import AuditOutlined from '@ant-design/icons/AuditOutlined';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import { formatDateTime } from '@/features/settings/workspaceGovernanceShared';
import type { WorkspaceAuditEvent } from '@/features/settings/workspaceGovernanceShared';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import {
  resolvePlatformConsoleCapabilities,
  resolvePlatformManagementFromAuthSession,
} from '@/features/settings/settingsPageCapabilities';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import useWorkspaceGovernanceOverview from '@/features/settings/useWorkspaceGovernanceOverview';

const { Text } = Typography;

function AuditSummaryMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <Space direction="vertical" size={4}>
      <Text type="secondary">{label}</Text>
      <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>
        {value}
      </div>
    </Space>
  );
}

export default function SettingsAuditPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const platformCapabilities = resolvePlatformConsoleCapabilities(
    authSession.data,
  );
  const workspaceOverviewRequestEnabled =
    runtimeScopePage.hasRuntimeScope && authSession.authenticated;
  const { workspaceOverview, loading } = useWorkspaceGovernanceOverview({
    enabled: workspaceOverviewRequestEnabled,
    errorMessage: '加载审计中心失败',
  });
  const [auditEvents, setAuditEvents] = useState<WorkspaceAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilters, setAuditFilters] = useState({
    action: '',
    actorType: '',
    result: '',
    query: '',
  });
  const auditEventsPath = platformCapabilities.canReadAudit
    ? '/api/v1/platform/audit-events'
    : '/api/v1/workspace/audit-events';

  const loadAuditEvents = useCallback(async () => {
    if (!workspaceOverviewRequestEnabled) {
      return;
    }

    try {
      setAuditLoading(true);
      const query = new URLSearchParams();
      query.set('limit', '50');
      if (auditFilters.action.trim()) {
        query.set('action', auditFilters.action.trim());
      }
      if (auditFilters.actorType.trim()) {
        query.set('actorType', auditFilters.actorType.trim());
      }
      if (auditFilters.result.trim()) {
        query.set('result', auditFilters.result.trim());
      }
      if (auditFilters.query.trim()) {
        query.set('query', auditFilters.query.trim());
      }

      const response = await fetch(
        buildRuntimeScopeUrl(`${auditEventsPath}?${query.toString()}`),
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
  }, [auditEventsPath, auditFilters, workspaceOverviewRequestEnabled]);

  useEffect(() => {
    void loadAuditEvents();
  }, [loadAuditEvents]);

  const permissionActions = workspaceOverview?.permissions?.actions || {};
  const canReadAudit = Boolean(
    platformCapabilities.canReadAudit || permissionActions['audit.read'],
  );

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
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsAudit',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });

  return (
    <ConsoleShellLayout
      title="审计日志"
      description="查询授权、治理与高风险操作相关的审计事件。"
      eyebrow="Audit & Governance"
      loading={runtimeScopePage.guarding || authSession.loading}
      {...shellProps}
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
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={8}>
                <AuditSummaryMetric
                  label="成功 / 允许"
                  value={resultSummary.success}
                />
              </Col>
              <Col xs={24} md={8}>
                <AuditSummaryMetric
                  label="拒绝 / 失败"
                  value={resultSummary.denied}
                />
              </Col>
              <Col xs={24} md={8}>
                <AuditSummaryMetric
                  label="高风险事件"
                  value={resultSummary.highRisk}
                />
              </Col>
            </Row>
          </Card>

          <Card
            title={
              <span>
                <AuditOutlined style={{ marginRight: 8 }} />
                审计事件
              </span>
            }
            extra={
              <Button
                loading={auditLoading}
                onClick={() => void loadAuditEvents()}
              >
                刷新
              </Button>
            }
          >
            <Text
              type="secondary"
              style={{ display: 'block', marginBottom: 16 }}
            >
              最近事件 {auditEvents.length} · 成功 / 允许{' '}
              {resultSummary.success} · 拒绝 / 失败 {resultSummary.denied} ·
              高风险 {resultSummary.highRisk}
            </Text>
            <Text
              type="secondary"
              style={{ display: 'block', marginBottom: 16 }}
            >
              最近 50 条事件，可按动作、主体、结果与关键字筛选。
            </Text>
            {!canReadAudit ? (
              <Alert
                type="info"
                showIcon
                message="当前为只读提示"
                description="你没有 audit.read 权限，暂时无法查看审计事件。"
              />
            ) : (
              <>
                <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                  <Col xs={24} lg={6}>
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
                  </Col>
                  <Col xs={24} sm={12} lg={4}>
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
                      style={{ width: '100%' }}
                    />
                  </Col>
                  <Col xs={24} sm={12} lg={4}>
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
                      style={{ width: '100%' }}
                    />
                  </Col>
                  <Col xs={24} lg={10}>
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
                  </Col>
                </Row>
                <Table
                  rowKey="id"
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
              </>
            )}
          </Card>
        </Space>
      )}
    </ConsoleShellLayout>
  );
}
