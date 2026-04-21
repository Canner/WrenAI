import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Skeleton, Space, Tabs } from 'antd';
import { appMessage as message } from '@/utils/antdAppBridge';
import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import DolaAppShell from '@/components/reference/DolaAppShell';
import { buildNovaSettingsNavItems } from '@/components/reference/novaShellNavigation';
import { usePersistentShellEmbedded } from '@/components/reference/PersistentShellContext';
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
  type ScheduleConfig,
  type ScheduleJobView,
  type ScheduleOverviewPayload,
  type ScheduleRunView,
} from '@/features/settings/systemTasks/systemTasksPageUtils';
import SystemTasksJobsSection from '@/features/settings/systemTasks/SystemTasksJobsSection';
import SystemTasksRunsSection from '@/features/settings/systemTasks/SystemTasksRunsSection';
import SystemTaskScheduleDrawer from '@/features/settings/systemTasks/SystemTaskScheduleDrawer';
import SystemTaskRunDetailsDrawer from '@/features/settings/systemTasks/SystemTaskRunDetailsDrawer';
import { Path } from '@/utils/enum';

const toWorkspaceTaskSelector = (
  selector?: ClientRuntimeScopeSelector,
): ClientRuntimeScopeSelector | undefined => {
  if (!selector?.workspaceId) {
    return selector;
  }

  return {
    workspaceId: selector.workspaceId,
  };
};

export const buildSystemTasksOverviewUrl = ({
  selector,
  usePlatformRoute = false,
}: {
  selector?: ClientRuntimeScopeSelector;
  usePlatformRoute?: boolean;
} = {}) =>
  buildRuntimeScopeUrl(
    usePlatformRoute
      ? '/api/v1/platform/system-tasks'
      : '/api/v1/workspace/schedules',
    {},
    toWorkspaceTaskSelector(selector),
  );

export const buildSystemTasksOverviewRequestKey = ({
  hasRuntimeScope,
  selector,
  usePlatformRoute = false,
}: {
  hasRuntimeScope: boolean;
  selector?: ClientRuntimeScopeSelector;
  usePlatformRoute?: boolean;
}) =>
  hasRuntimeScope
    ? buildSystemTasksOverviewUrl({
        selector,
        usePlatformRoute,
      })
    : null;

export const buildSystemTaskActionUrl = ({
  jobId,
  action,
  selector,
  usePlatformRoute = false,
}: {
  jobId: string;
  action: 'run' | 'update' | 'disable';
  selector?: ClientRuntimeScopeSelector;
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
    {},
    toWorkspaceTaskSelector(selector),
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
  const embedded = usePersistentShellEmbedded();
  const authSession = useAuthSession();
  const showPlatformManagement = resolvePlatformManagementFromAuthSession(
    authSession.data,
  );
  const platformCapabilities = resolvePlatformConsoleCapabilities(
    authSession.data,
  );
  const navItems = useMemo(
    () =>
      buildNovaSettingsNavItems({
        activeKey: 'settingsSystemTasks',
        onNavigate: runtimeScopeNavigation.pushWorkspace,
        showPlatformAdmin: showPlatformManagement,
      }),
    [runtimeScopeNavigation.pushWorkspace, showPlatformManagement],
  );
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
        selector: runtimeScopeNavigation.selector,
        usePlatformRoute: platformCapabilities.canReadSystemTasks,
      }),
    [
      platformCapabilities.canReadSystemTasks,
      runtimeScopeNavigation.selector,
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
            selector: runtimeScopeNavigation.selector,
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
            selector: runtimeScopeNavigation.selector,
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
      schedule: ScheduleConfig | null;
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
            selector: runtimeScopeNavigation.selector,
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

  const tabItems = useMemo(
    () => [
      {
        key: 'jobs',
        label: `任务列表 (${data?.jobs?.length || 0})`,
        children: (
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
        ),
      },
      {
        key: 'runs',
        label: `运行记录 (${data?.recentRuns?.length || 0})`,
        children: (
          <SystemTasksRunsSection
            filteredRuns={filteredRuns}
            loading={loading}
            onChangeRunStatusFilter={setRunStatusFilter}
            onOpenRun={setSelectedRun}
            runStatusFilter={runStatusFilter}
            runStatusOptions={runStatusOptions}
          />
        ),
      },
    ],
    [
      canManageTaskActions,
      data?.jobs?.length,
      data?.recentRuns?.length,
      filteredJobs,
      filteredRuns,
      handleDisable,
      handleRunNow,
      jobStatusFilter,
      jobStatusOptions,
      loading,
      pendingAction,
      runStatusFilter,
      runStatusOptions,
    ],
  );

  const pageContent = (
    <>
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        {runtimeScopePage.guarding ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : (
          <>
            {error ? (
              <Alert
                className="console-alert"
                type="warning"
                showIcon
                title="加载定时任务失败"
                description={error}
              />
            ) : null}
            <Tabs
              animated={false}
              defaultActiveKey="jobs"
              items={tabItems}
              style={{ width: '100%' }}
            />
          </>
        )}
      </Space>

      <SystemTaskScheduleDrawer
        open={Boolean(editingJob)}
        defaultValue={getDrawerDefaultValue(editingJob)}
        loading={pendingAction?.action === 'update'}
        onClose={() => setEditingJob(null)}
        onSubmit={handleUpdateSchedule}
      />
      <SystemTaskRunDetailsDrawer
        open={Boolean(selectedRun)}
        run={selectedRun}
        onClose={() => setSelectedRun(null)}
      />
    </>
  );

  if (embedded) {
    return pageContent;
  }

  return (
    <DolaAppShell
      navItems={navItems}
      hideHistorySection
      sidebarBackAction={{
        label: '返回主菜单',
        onClick: () => void runtimeScopeNavigation.pushWorkspace(Path.Home),
      }}
      hideSidebarBranding
      hideSidebarFooterPanel
      hideSidebarCollapseToggle
    >
      {pageContent}
    </DolaAppShell>
  );
}
