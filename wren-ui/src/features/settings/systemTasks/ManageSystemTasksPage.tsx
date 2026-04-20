import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Space, message } from 'antd';
import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import CacheSettingsDrawer from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import type { Schedule as DashboardScheduleConfig } from '@/components/pages/home/dashboardGrid/CacheSettingsDrawer';
import ScheduleRunDetailsDrawer from '@/components/pages/workspace/ScheduleRunDetailsDrawer';
import { buildSettingsConsoleShellProps } from '@/features/settings/settingsShell';
import {
  resolvePlatformConsoleCapabilities,
  resolvePlatformManagementFromAuthSession,
} from '@/features/settings/settingsPageCapabilities';
import useAuthSession from '@/hooks/useAuthSession';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRestRequest from '@/hooks/useRestRequest';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  getStatusLabel,
  type ScheduleJobView,
  type ScheduleOverviewPayload,
  type ScheduleRunView,
} from '@/features/settings/systemTasks/systemTasksPageUtils';
import SystemTasksSummarySection from '@/features/settings/systemTasks/SystemTasksSummarySection';
import SystemTasksJobsSection from '@/features/settings/systemTasks/SystemTasksJobsSection';
import SystemTasksRunsSection from '@/features/settings/systemTasks/SystemTasksRunsSection';

export const buildSystemTasksOverviewUrl = ({
  usePlatformRoute = false,
}: {
  usePlatformRoute?: boolean;
} = {}) =>
  buildRuntimeScopeUrl(
    usePlatformRoute
      ? '/api/v1/platform/system-tasks'
      : '/api/v1/workspace/schedules',
  );

export const buildSystemTasksOverviewRequestKey = ({
  hasRuntimeScope,
  usePlatformRoute = false,
}: {
  hasRuntimeScope: boolean;
  usePlatformRoute?: boolean;
}) =>
  hasRuntimeScope
    ? buildSystemTasksOverviewUrl({
        usePlatformRoute,
      })
    : null;

export const buildSystemTaskActionUrl = ({
  jobId,
  action,
  usePlatformRoute = false,
}: {
  jobId: string;
  action: 'run' | 'update' | 'disable';
  usePlatformRoute?: boolean;
}) =>
  buildRuntimeScopeUrl(
    usePlatformRoute
      ? action === 'run'
        ? `/api/v1/platform/system-tasks/${jobId}/run`
        : `/api/v1/platform/system-tasks/${jobId}`
      : action === 'run'
        ? `/api/v1/workspace/schedules/${jobId}/run`
        : `/api/v1/workspace/schedules/${jobId}`,
  );

const canManageWorkspaceScheduleFromAuthSession = (
  authSession: ReturnType<typeof useAuthSession>['data'],
) =>
  Boolean(
    authSession?.authorization?.actions?.['workspace.schedule.manage'] ||
      authSession?.authorization?.actor?.grantedActions?.includes(
        'workspace.schedule.manage',
      ),
  );

export const loadSystemTasksOverviewPayload = async ({
  requestUrl = buildSystemTasksOverviewUrl(),
  fetcher = fetch,
}: {
  requestUrl?: string;
  fetcher?: typeof fetch;
}) => {
  const response = await fetcher(requestUrl);
  const payload = (await response.json()) as ScheduleOverviewPayload & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || '加载定时任务失败');
  }

  return payload;
};

export default function SettingsSystemTasksPage() {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const platformCapabilities = resolvePlatformConsoleCapabilities(
    authSession.data,
  );
  const shellProps = buildSettingsConsoleShellProps({
    activeKey: 'settingsSystemTasks',
    onNavigate: runtimeScopeNavigation.pushWorkspace,
    showPlatformAdmin: showPlatformManagement,
  });
  const usePlatformManageRoute = platformCapabilities.canManageSystemTasks;
  const canManageTaskActions = Boolean(
    usePlatformManageRoute ||
      canManageWorkspaceScheduleFromAuthSession(authSession.data),
  );
  const [pendingAction, setPendingAction] = useState<{
    jobId: string;
    action: 'run' | 'disable' | 'update';
  } | null>(null);
  const [editingJob, setEditingJob] = useState<ScheduleJobView | null>(null);
  const [selectedRun, setSelectedRun] = useState<ScheduleRunView | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('all');
  const [runStatusFilter, setRunStatusFilter] = useState<string>('all');
  const requestUrl = useMemo(
    () =>
      buildSystemTasksOverviewRequestKey({
        hasRuntimeScope: runtimeScopePage.hasRuntimeScope,
        usePlatformRoute: platformCapabilities.canReadSystemTasks,
      }),
    [
      platformCapabilities.canReadSystemTasks,
      runtimeScopePage.hasRuntimeScope,
    ],
  );
  const [error, setError] = useState<string | null>(null);
  const {
    data,
    loading,
    refetch: refetchOverview,
    setData,
  } = useRestRequest<ScheduleOverviewPayload | null>({
    enabled: Boolean(requestUrl),
    auto: Boolean(requestUrl),
    initialData: null,
    requestKey: requestUrl,
    request: async () =>
      loadSystemTasksOverviewPayload({
        requestUrl: requestUrl as string,
      }),
    onSuccess: () => {
      setError(null);
    },
    onError: (nextError) => {
      setError(nextError.message || '加载定时任务失败');
    },
  });

  const load = useCallback(
    async (keepLoadingState = true) => {
      if (!requestUrl) {
        return;
      }

      if (keepLoadingState) {
        try {
          await refetchOverview();
        } catch (_error) {
          return;
        }
        return;
      }

      try {
        const payload = await loadSystemTasksOverviewPayload({
          requestUrl,
        });
        setData(payload);
        setError(null);
      } catch (fetchError: any) {
        setError(fetchError?.message || '加载定时任务失败');
      }
    },
    [refetchOverview, requestUrl, setData],
  );

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
          buildSystemTaskActionUrl({
            jobId,
            action: 'run',
            usePlatformRoute: usePlatformManageRoute,
          }),
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
    [load, usePlatformManageRoute],
  );

  const handleDisable = useCallback(
    async (jobId: string) => {
      setPendingAction({ jobId, action: 'disable' });
      try {
        const response = await fetch(
          buildSystemTaskActionUrl({
            jobId,
            action: 'disable',
            usePlatformRoute: usePlatformManageRoute,
          }),
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
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
    [load, usePlatformManageRoute],
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
          buildSystemTaskActionUrl({
            jobId: editingJob.id,
            action: 'update',
            usePlatformRoute: usePlatformManageRoute,
          }),
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', data: values }),
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
    [editingJob, load, usePlatformManageRoute],
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
        (status) => ({ label: getStatusLabel(status), value: status }),
      ),
    ],
    [data?.jobs],
  );

  const runStatusOptions = useMemo(
    () => [
      { label: '全部运行状态', value: 'all' },
      ...Array.from(
        new Set((data?.recentRuns || []).map((run) => run.status)),
      ).map((status) => ({ label: getStatusLabel(status), value: status })),
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
        <SystemTasksSummarySection data={data} />
        <SystemTasksJobsSection
          canManageActions={canManageTaskActions}
          filteredJobs={filteredJobs}
          jobStatusFilter={jobStatusFilter}
          jobStatusOptions={jobStatusOptions}
          loading={loading}
          onChangeJobStatusFilter={setJobStatusFilter}
          onDisable={(jobId) => void handleDisable(jobId)}
          onEdit={setEditingJob}
          onRunNow={(jobId) => void handleRunNow(jobId)}
          pendingAction={pendingAction}
        />
        <SystemTasksRunsSection
          filteredRuns={filteredRuns}
          loading={loading}
          onChangeRunStatusFilter={setRunStatusFilter}
          onOpenRun={setSelectedRun}
          runStatusFilter={runStatusFilter}
          runStatusOptions={runStatusOptions}
        />
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
