import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import CacheSettingsDrawer from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import type { Schedule as DashboardScheduleConfig } from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import ScheduleRunDetailsDrawer from '@/components/pages/workspace/ScheduleRunDetailsDrawer';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import { resolvePlatformManagementFromAuthSession } from '@/features/settings/settingsPageCapabilities';

const { Text } = Typography;

function SystemTaskSummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
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

type ScheduleJobView = {
  id: string;
  targetType: string;
  targetTypeLabel: string;
  targetId: string;
  targetName: string;
  cronExpr: string;
  timezone: string;
  status: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastError?: string | null;
  dashboardId?: number | null;
  cacheEnabled?: boolean;
  scheduleConfig?: DashboardScheduleConfig | null;
};

type ScheduleRunView = {
  id: string;
  scheduleJobId: string;
  targetType: string;
  targetTypeLabel: string;
  targetName: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  traceId?: string | null;
  errorMessage?: string | null;
  detailJson?: {
    runtimeIdentity?: {
      workspaceId?: string | null;
      knowledgeBaseId?: string | null;
      kbSnapshotId?: string | null;
      deployHash?: string | null;
    } | null;
    [key: string]: any;
  } | null;
};

type ScheduleOverviewPayload = {
  workspace: {
    id: string;
    name: string;
    slug?: string | null;
  };
  currentKnowledgeBase?: {
    id: string;
    name: string;
    slug?: string | null;
  } | null;
  currentKbSnapshot?: {
    id: string;
    deployHash?: string | null;
  } | null;
  stats: {
    jobCount: number;
    activeJobCount: number;
    runCount: number;
    latestRunStatus?: string | null;
  };
  jobs: ScheduleJobView[];
  recentRuns: ScheduleRunView[];
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

const getStatusColor = (status?: string | null) => {
  switch (status) {
    case 'active':
    case 'succeeded':
      return 'green';
    case 'running':
      return 'blue';
    case 'failed':
      return 'red';
    case 'inactive':
      return 'default';
    default:
      return 'default';
  }
};

const getStatusLabel = (status?: string | null) => {
  switch (status) {
    case 'active':
      return '启用';
    case 'inactive':
      return '停用';
    case 'running':
      return '运行中';
    case 'succeeded':
      return '成功';
    case 'failed':
      return '失败';
    default:
      return status || '未知';
  }
};

export default function SettingsSystemTasksPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsSystemTasks',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScheduleOverviewPayload | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    jobId: string;
    action: 'run' | 'disable' | 'update';
  } | null>(null);
  const [editingJob, setEditingJob] = useState<ScheduleJobView | null>(null);
  const [selectedRun, setSelectedRun] = useState<ScheduleRunView | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('all');
  const [runStatusFilter, setRunStatusFilter] = useState<string>('all');

  const load = useCallback(
    async (keepLoadingState = true) => {
      if (!runtimeScopePage.hasRuntimeScope) {
        return;
      }

      if (keepLoadingState) {
        setLoading(true);
      }
      setError(null);

      try {
        const response = await fetch(
          buildRuntimeScopeUrl('/api/v1/workspace/schedules'),
        );
        const payload = (await response.json()) as ScheduleOverviewPayload & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || '加载定时任务失败');
        }

        setData(payload);
      } catch (fetchError: any) {
        setError(fetchError?.message || '加载定时任务失败');
        setData(null);
      } finally {
        if (keepLoadingState) {
          setLoading(false);
        }
      }
    },
    [runtimeScopePage.hasRuntimeScope],
  );

  useEffect(() => {
    if (!runtimeScopePage.hasRuntimeScope) {
      return;
    }

    void load();
  }, [load, runtimeScopePage.hasRuntimeScope]);

  useEffect(() => {
    if (!selectedRun?.id) {
      return;
    }

    const latestSelectedRun =
      data?.recentRuns?.find((run) => run.id === selectedRun.id) || null;
    if (!latestSelectedRun) {
      setSelectedRun(null);
      return;
    }

    if (latestSelectedRun !== selectedRun) {
      setSelectedRun(latestSelectedRun);
    }
  }, [data?.recentRuns, selectedRun]);

  const handleRunNow = useCallback(
    async (jobId: string) => {
      setPendingAction({ jobId, action: 'run' });
      try {
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/workspace/schedules/${jobId}/run`),
          { method: 'POST' },
        );
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || '立即刷新失败');
        }

        message.success('已触发一次立即刷新');
        await load(false);
      } catch (actionError: any) {
        message.error(actionError?.message || '立即刷新失败');
      } finally {
        setPendingAction(null);
      }
    },
    [load],
  );

  const handleDisable = useCallback(
    async (jobId: string) => {
      setPendingAction({ jobId, action: 'disable' });
      try {
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/workspace/schedules/${jobId}`),
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'disable' }),
          },
        );
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || '切换为仅手动刷新失败');
        }

        message.success('已切换为仅手动刷新');
        await load(false);
      } catch (actionError: any) {
        message.error(actionError?.message || '切换为仅手动刷新失败');
      } finally {
        setPendingAction(null);
      }
    },
    [load],
  );

  const handleUpdateSchedule = useCallback(
    async (values: {
      cacheEnabled: boolean;
      schedule: DashboardScheduleConfig | null;
    }) => {
      if (!editingJob) {
        return;
      }

      setPendingAction({ jobId: editingJob.id, action: 'update' });
      try {
        const response = await fetch(
          buildRuntimeScopeUrl(`/api/v1/workspace/schedules/${editingJob.id}`),
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'update',
              data: values,
            }),
          },
        );
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || '更新刷新计划失败');
        }

        message.success('刷新计划已更新');
        setEditingJob(null);
        await load(false);
      } catch (actionError: any) {
        message.error(actionError?.message || '更新刷新计划失败');
      } finally {
        setPendingAction(null);
      }
    },
    [editingJob, load],
  );

  const getDrawerDefaultValue = useCallback((job: ScheduleJobView | null) => {
    if (!job) {
      return null;
    }

    return {
      cacheEnabled: job.cacheEnabled ?? true,
      schedule: job.scheduleConfig || {
        frequency: 'NEVER',
        day: null,
        hour: 0,
        minute: 0,
        cron: null,
        timezone: job.timezone || 'UTC',
      },
    };
  }, []);

  const jobStatusOptions = useMemo(
    () => [
      { label: '全部任务状态', value: 'all' },
      ...Array.from(new Set((data?.jobs || []).map((job) => job.status))).map(
        (status) => ({
          label: getStatusLabel(status),
          value: status,
        }),
      ),
    ],
    [data?.jobs],
  );

  const runStatusOptions = useMemo(
    () => [
      { label: '全部运行状态', value: 'all' },
      ...Array.from(
        new Set((data?.recentRuns || []).map((run) => run.status)),
      ).map((status) => ({
        label: getStatusLabel(status),
        value: status,
      })),
    ],
    [data?.recentRuns],
  );

  const filteredJobs = useMemo(
    () =>
      (data?.jobs || []).filter(
        (job) => jobStatusFilter === 'all' || job.status === jobStatusFilter,
      ),
    [data?.jobs, jobStatusFilter],
  );

  const filteredRuns = useMemo(
    () =>
      (data?.recentRuns || []).filter(
        (run) => runStatusFilter === 'all' || run.status === runStatusFilter,
      ),
    [data?.recentRuns, runStatusFilter],
  );

  if (runtimeScopePage.guarding) {
    return <ConsoleShellLayout title="系统任务" loading {...shellProps} />;
  }

  return (
    <ConsoleShellLayout
      title="系统任务"
      description="查看当前 Workspace 的调度任务、最近运行与手动执行入口。"
      eyebrow="Automation & Operations"
      {...shellProps}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {error ? (
          <Alert
            className="console-alert"
            type="warning"
            showIcon
            message="加载定时任务失败"
            description={error}
          />
        ) : null}

        <Card>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text type="secondary">
              当前工作空间 {data?.workspace?.name || '—'}
              {data?.currentKnowledgeBase?.name
                ? ` · 当前知识库 ${data.currentKnowledgeBase.name}`
                : ''}
            </Text>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={6}>
                <SystemTaskSummaryMetric
                  label="任务总数"
                  value={data?.stats.jobCount || 0}
                />
              </Col>
              <Col xs={24} md={6}>
                <SystemTaskSummaryMetric
                  label="启用任务"
                  value={data?.stats.activeJobCount || 0}
                />
              </Col>
              <Col xs={24} md={6}>
                <SystemTaskSummaryMetric
                  label="最近运行数"
                  value={data?.stats.runCount || 0}
                />
              </Col>
              <Col xs={24} md={6}>
                <SystemTaskSummaryMetric
                  label="最新状态"
                  value={getStatusLabel(data?.stats.latestRunStatus)}
                />
              </Col>
            </Row>
          </Space>
        </Card>

        <Card
          title="任务列表"
          extra={
            <Space wrap>
              <Text type="secondary">任务状态</Text>
              <Select
                value={jobStatusFilter}
                onChange={(value) => setJobStatusFilter(value)}
                options={jobStatusOptions}
                style={{ minWidth: 180 }}
              />
            </Space>
          }
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            当前支持对看板缓存刷新任务执行立即刷新、编辑计划与切换为仅手动刷新。
          </Text>
          <Table
            rowKey="id"
            loading={loading}
            locale={{ emptyText: '暂无定时任务' }}
            pagination={{ hideOnSinglePage: true, pageSize: 6 }}
            dataSource={filteredJobs}
            columns={[
              {
                title: '任务',
                key: 'target',
                render: (_value, record: ScheduleJobView) => (
                  <Space direction="vertical" size={0}>
                    <Text strong>{record.targetName}</Text>
                    <Text type="secondary">{record.targetTypeLabel}</Text>
                  </Space>
                ),
              },
              {
                title: '计划',
                key: 'cron',
                render: (_value, record: ScheduleJobView) => (
                  <Space direction="vertical" size={0}>
                    <Text>{record.cronExpr}</Text>
                    <Text type="secondary">{record.timezone}</Text>
                  </Space>
                ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 120,
                render: (status: string) => (
                  <Tag color={getStatusColor(status)}>
                    {getStatusLabel(status)}
                  </Tag>
                ),
              },
              {
                title: '下次执行',
                dataIndex: 'nextRunAt',
                width: 160,
                render: (value: string | null) => formatDateTime(value),
              },
              {
                title: '最近执行',
                key: 'lastRun',
                width: 200,
                render: (_value, record: ScheduleJobView) => (
                  <Space direction="vertical" size={0}>
                    <Text>{formatDateTime(record.lastRunAt)}</Text>
                    {record.lastError ? (
                      <Text type="danger">{record.lastError}</Text>
                    ) : (
                      <Text type="secondary">无错误</Text>
                    )}
                  </Space>
                ),
              },
              {
                title: '操作',
                key: 'actions',
                width: 240,
                render: (_value, record: ScheduleJobView) => {
                  const isRunningAction =
                    pendingAction?.jobId === record.id &&
                    pendingAction.action === 'run';
                  const isDisablingAction =
                    pendingAction?.jobId === record.id &&
                    pendingAction.action === 'disable';

                  return (
                    <Space size={8} wrap>
                      <Button
                        onClick={() => handleRunNow(record.id)}
                        loading={isRunningAction}
                      >
                        立即刷新
                      </Button>
                      <Button
                        onClick={() => setEditingJob(record)}
                        loading={
                          pendingAction?.jobId === record.id &&
                          pendingAction.action === 'update'
                        }
                      >
                        编辑计划
                      </Button>
                      {record.status === 'active' ? (
                        <Button
                          onClick={() => handleDisable(record.id)}
                          loading={isDisablingAction}
                        >
                          切为仅手动刷新
                        </Button>
                      ) : null}
                    </Space>
                  );
                },
              },
            ]}
          />
        </Card>

        <Card
          title="最近运行记录"
          extra={
            <Space wrap>
              <Text type="secondary">运行状态</Text>
              <Select
                value={runStatusFilter}
                onChange={(value) => setRunStatusFilter(value)}
                options={runStatusOptions}
                style={{ minWidth: 180 }}
              />
            </Space>
          }
        >
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            方便确认最近是否成功刷新、失败原因、trace 以及对应 runtime scope。
          </Text>
          <Table
            rowKey="id"
            loading={loading}
            locale={{ emptyText: '暂无运行记录' }}
            pagination={{ hideOnSinglePage: true, pageSize: 8 }}
            dataSource={filteredRuns}
            columns={[
              {
                title: '运行',
                key: 'run',
                render: (_value, record: ScheduleRunView) => (
                  <Space direction="vertical" size={0}>
                    <Text strong>{record.targetName}</Text>
                    <Text type="secondary">
                      {formatDateTime(record.startedAt)}
                    </Text>
                  </Space>
                ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 110,
                render: (status: string) => (
                  <Tag color={getStatusColor(status)}>
                    {getStatusLabel(status)}
                  </Tag>
                ),
              },
              {
                title: '详情',
                key: 'detail',
                render: (_value, record: ScheduleRunView) => (
                  <Space direction="vertical" size={0}>
                    {record.errorMessage ? (
                      <Text type="danger">{record.errorMessage}</Text>
                    ) : (
                      <Text type="secondary">
                        {record.traceId
                          ? `traceId: ${record.traceId}`
                          : '执行完成'}
                      </Text>
                    )}
                    <Text type="secondary">
                      {record.detailJson?.runtimeIdentity?.deployHash
                        ? `deployHash: ${record.detailJson.runtimeIdentity.deployHash}`
                        : '沿用当前 runtime scope'}
                    </Text>
                  </Space>
                ),
              },
              {
                title: '操作',
                key: 'actions',
                width: 120,
                render: (_value, record: ScheduleRunView) => (
                  <Button onClick={() => setSelectedRun(record)}>
                    查看详情
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      </Space>

      <CacheSettingsDrawer
        visible={Boolean(editingJob)}
        defaultValue={getDrawerDefaultValue(editingJob)}
        loading={pendingAction?.action === 'update'}
        onClose={() => setEditingJob(null)}
        onSubmit={handleUpdateSchedule}
      />
      <ScheduleRunDetailsDrawer
        visible={Boolean(selectedRun)}
        defaultValue={selectedRun}
        onClose={() => setSelectedRun(null)}
      />
    </ConsoleShellLayout>
  );
}
