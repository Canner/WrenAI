import { components } from '@/common';
import type { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { resolveDashboardScheduleBinding } from '@server/utils/dashboardRuntime';
import {
  ScheduleFrequencyEnum,
  type SetDashboardCacheData,
} from '@server/models/dashboard';
import { DASHBOARD_REFRESH_TARGET_TYPE } from '@server/services/scheduleService';

const toTimestamp = (value?: Date | string | null) => {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

export const serializeScheduleJob = (job: any) => ({
  id: job.id,
  workspaceId: job.workspaceId,
  knowledgeBaseId: job.knowledgeBaseId,
  kbSnapshotId: job.kbSnapshotId,
  deployHash: job.deployHash,
  targetType: job.targetType,
  targetId: job.targetId,
  cronExpr: job.cronExpr,
  timezone: job.timezone,
  status: job.status,
  nextRunAt: job.nextRunAt || null,
  lastRunAt: job.lastRunAt || null,
  lastError: job.lastError || null,
});

export const serializeScheduleRun = (run: any) => ({
  id: run.id,
  scheduleJobId: run.scheduleJobId,
  traceId: run.traceId || null,
  status: run.status,
  startedAt: run.startedAt || null,
  finishedAt: run.finishedAt || null,
  errorMessage: run.errorMessage || null,
  detailJson: run.detailJson || null,
});

export const serializeDashboard = (dashboard: any) => ({
  id: dashboard.id,
  cacheEnabled: dashboard.cacheEnabled,
  scheduleFrequency: dashboard.scheduleFrequency,
  scheduleTimezone: dashboard.scheduleTimezone,
  scheduleCron: dashboard.scheduleCron,
  nextScheduledAt: dashboard.nextScheduledAt || null,
});

const syncDashboardScheduleJob = async ({
  runtimeIdentity,
  scheduleJob,
  data,
}: {
  runtimeIdentity: PersistedRuntimeIdentity;
  scheduleJob: Awaited<
    ReturnType<typeof components.scheduleJobRepository.findOneBy>
  >;
  data: SetDashboardCacheData;
}) => {
  if (!scheduleJob) {
    throw new Error('Schedule job not found');
  }

  if (scheduleJob.targetType !== DASHBOARD_REFRESH_TARGET_TYPE) {
    throw new Error('Only dashboard refresh jobs can be updated here');
  }

  const dashboardId = Number.parseInt(scheduleJob.targetId, 10);
  if (Number.isNaN(dashboardId)) {
    throw new Error(
      `Invalid dashboard refresh target id: ${scheduleJob.targetId}`,
    );
  }

  const dashboard = await components.dashboardRepository.findOneBy({
    id: dashboardId,
  });
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }

  const updatedDashboard =
    await components.dashboardService.setDashboardSchedule(dashboardId, data);

  const scheduleBinding = await resolveDashboardScheduleBinding({
    dashboard: updatedDashboard,
    runtimeIdentity,
    kbSnapshotRepository: components.kbSnapshotRepository,
    knowledgeBaseRepository: components.knowledgeBaseRepository,
  });

  const syncedJob = await components.scheduleService.syncDashboardRefreshJob({
    dashboardId: updatedDashboard.id,
    enabled: Boolean(
      updatedDashboard.cacheEnabled && updatedDashboard.scheduleCron,
    ),
    cronExpr: updatedDashboard.scheduleCron,
    timezone:
      updatedDashboard.scheduleTimezone || scheduleJob.timezone || 'UTC',
    nextRunAt: updatedDashboard.nextScheduledAt || null,
    workspaceId: scheduleBinding.workspaceId,
    knowledgeBaseId: scheduleBinding.knowledgeBaseId,
    kbSnapshotId: scheduleBinding.kbSnapshotId,
    deployHash: scheduleBinding.deployHash,
    createdBy: runtimeIdentity.actorUserId || null,
  });

  return {
    dashboard: serializeDashboard(updatedDashboard),
    job: serializeScheduleJob(syncedJob || scheduleJob),
  };
};

export const disableDashboardScheduleJob = async ({
  runtimeIdentity,
  scheduleJob,
}: {
  runtimeIdentity: PersistedRuntimeIdentity;
  scheduleJob: Awaited<
    ReturnType<typeof components.scheduleJobRepository.findOneBy>
  >;
}) =>
  await syncDashboardScheduleJob({
    runtimeIdentity,
    scheduleJob,
    data: {
      cacheEnabled: true,
      schedule: {
        frequency: ScheduleFrequencyEnum.NEVER,
        day: null as any,
        hour: 0,
        minute: 0,
        cron: null as any,
        timezone: scheduleJob?.timezone || 'UTC',
      },
    },
  });

export const updateDashboardScheduleJob = async ({
  runtimeIdentity,
  scheduleJob,
  body,
}: {
  runtimeIdentity: PersistedRuntimeIdentity;
  scheduleJob: Awaited<
    ReturnType<typeof components.scheduleJobRepository.findOneBy>
  >;
  body: Record<string, any>;
}) => {
  const data = body?.data as SetDashboardCacheData | undefined;
  if (!data || typeof data.cacheEnabled !== 'boolean') {
    throw new Error('Schedule update payload is required');
  }

  if (data.cacheEnabled && !data.schedule) {
    throw new Error('Schedule config is required when cache is enabled');
  }

  return await syncDashboardScheduleJob({
    runtimeIdentity,
    scheduleJob,
    data,
  });
};

export const resolveLatestScheduleRun = (runs: any[]) =>
  [...runs].sort(
    (left, right) =>
      toTimestamp(right.startedAt || right.finishedAt) -
      toTimestamp(left.startedAt || left.finishedAt),
  )[0] || null;

export const runScheduleJobNow = async ({
  id,
  scheduleJob,
}: {
  id: string;
  scheduleJob: Awaited<
    ReturnType<typeof components.scheduleJobRepository.findOneBy>
  >;
}) => {
  if (!scheduleJob) {
    throw new Error('Schedule job not found');
  }

  await components.scheduleWorker.runJobNow(scheduleJob);

  const [updatedJob, runs] = await Promise.all([
    components.scheduleJobRepository.findOneBy({ id }),
    components.scheduleJobRunRepository.findAllBy({ scheduleJobId: id }),
  ]);

  return {
    updatedJob,
    latestRun: resolveLatestScheduleRun(runs),
  };
};
