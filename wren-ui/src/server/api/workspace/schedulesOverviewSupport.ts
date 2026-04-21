import { components } from '@/common';
import { DASHBOARD_REFRESH_TARGET_TYPE } from '@server/services/scheduleService';
import { ScheduleFrequencyEnum } from '@server/models/dashboard';

export type ScheduleJobView = {
  id: string;
  targetType: string;
  targetTypeLabel: string;
  targetId: string;
  targetName: string;
  cronExpr: string;
  timezone: string;
  status: string;
  nextRunAt?: Date | string | null;
  lastRunAt?: Date | string | null;
  lastError?: string | null;
  dashboardId?: number | null;
  cacheEnabled?: boolean;
  scheduleConfig?: {
    frequency: string;
    day?: string | null;
    hour?: number | null;
    minute?: number | null;
    cron?: string | null;
    timezone?: string | null;
  } | null;
};

export type ScheduleRunView = {
  id: string;
  scheduleJobId: string;
  targetType: string;
  targetTypeLabel: string;
  targetName: string;
  status: string;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  traceId?: string | null;
  errorMessage?: string | null;
  detailJson?: Record<string, any> | null;
};

export type ScheduleOverviewPayload = {
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

const toTimestamp = (value?: Date | string | null) => {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

export const getScheduleTargetTypeLabel = (targetType?: string | null) => {
  if (targetType === DASHBOARD_REFRESH_TARGET_TYPE) {
    return '看板缓存刷新';
  }

  return targetType || '未知任务';
};

const buildScheduleConfig = (dashboard?: {
  scheduleFrequency?: string | null;
  scheduleTimezone?: string | null;
  scheduleCron?: string | null;
}) => {
  if (!dashboard) {
    return null;
  }

  const frequency = dashboard.scheduleFrequency || ScheduleFrequencyEnum.NEVER;
  if (!dashboard.scheduleCron || frequency === ScheduleFrequencyEnum.NEVER) {
    return {
      frequency,
      day: null,
      hour: 0,
      minute: 0,
      cron: null,
      timezone: dashboard.scheduleTimezone || 'UTC',
    };
  }

  if (frequency === ScheduleFrequencyEnum.CUSTOM) {
    return {
      frequency,
      day: null,
      hour: 0,
      minute: 0,
      cron: dashboard.scheduleCron,
      timezone: dashboard.scheduleTimezone || 'UTC',
    };
  }

  const cronParts = dashboard.scheduleCron.split(' ');
  if (cronParts.length !== 5) {
    return {
      frequency,
      day: null,
      hour: 0,
      minute: 0,
      cron: dashboard.scheduleCron,
      timezone: dashboard.scheduleTimezone || 'UTC',
    };
  }

  const [minute, hour, , , day] = cronParts;

  return {
    frequency,
    day: frequency === ScheduleFrequencyEnum.WEEKLY ? day : null,
    hour: Number.parseInt(hour, 10),
    minute: Number.parseInt(minute, 10),
    cron:
      frequency === ScheduleFrequencyEnum.CUSTOM
        ? dashboard.scheduleCron
        : null,
    timezone: dashboard.scheduleTimezone || 'UTC',
  };
};

const buildJobView = async (job: {
  targetType: string;
  targetId: string;
  id: string;
  cronExpr: string;
  timezone: string;
  status: string;
  nextRunAt?: Date | string | null;
  lastRunAt?: Date | string | null;
  lastError?: string | null;
}) => {
  if (job.targetType !== DASHBOARD_REFRESH_TARGET_TYPE) {
    return {
      id: job.id,
      targetType: job.targetType,
      targetTypeLabel: getScheduleTargetTypeLabel(job.targetType),
      targetId: job.targetId,
      targetName: job.targetId || '未命名目标',
      cronExpr: job.cronExpr,
      timezone: job.timezone,
      status: job.status,
      nextRunAt: job.nextRunAt || null,
      lastRunAt: job.lastRunAt || null,
      lastError: job.lastError || null,
      dashboardId: null,
      cacheEnabled: true,
      scheduleConfig: null,
    } satisfies ScheduleJobView;
  }

  const dashboardId = Number.parseInt(job.targetId, 10);
  if (Number.isNaN(dashboardId)) {
    return {
      id: job.id,
      targetType: job.targetType,
      targetTypeLabel: getScheduleTargetTypeLabel(job.targetType),
      targetId: job.targetId,
      targetName: `看板 #${job.targetId}`,
      cronExpr: job.cronExpr,
      timezone: job.timezone,
      status: job.status,
      nextRunAt: job.nextRunAt || null,
      lastRunAt: job.lastRunAt || null,
      lastError: job.lastError || null,
      dashboardId: null,
      cacheEnabled: true,
      scheduleConfig: null,
    } satisfies ScheduleJobView;
  }

  const dashboard = await components.dashboardRepository.findOneBy({
    id: dashboardId,
  });

  return {
    id: job.id,
    targetType: job.targetType,
    targetTypeLabel: getScheduleTargetTypeLabel(job.targetType),
    targetId: job.targetId,
    targetName: dashboard?.name || `看板 #${job.targetId}`,
    cronExpr: job.cronExpr,
    timezone: job.timezone,
    status: job.status,
    nextRunAt: job.nextRunAt || null,
    lastRunAt: job.lastRunAt || null,
    lastError: job.lastError || null,
    dashboardId: dashboard?.id ?? dashboardId,
    cacheEnabled: dashboard?.cacheEnabled ?? true,
    scheduleConfig: buildScheduleConfig(dashboard || undefined),
  } satisfies ScheduleJobView;
};

const sortJobs = (jobs: ScheduleJobView[]) =>
  [...jobs].sort((left, right) => {
    const statusScore = left.status === 'active' ? 0 : 1;
    const otherStatusScore = right.status === 'active' ? 0 : 1;
    if (statusScore !== otherStatusScore) {
      return statusScore - otherStatusScore;
    }

    const nextRunDelta =
      (left.nextRunAt ? toTimestamp(left.nextRunAt) : Number.MAX_SAFE_INTEGER) -
      (right.nextRunAt
        ? toTimestamp(right.nextRunAt)
        : Number.MAX_SAFE_INTEGER);
    if (nextRunDelta !== 0) {
      return nextRunDelta;
    }

    return left.targetName.localeCompare(right.targetName);
  });

const sortRuns = (runs: ScheduleRunView[]) =>
  [...runs].sort(
    (left, right) =>
      toTimestamp(right.startedAt || right.finishedAt) -
      toTimestamp(left.startedAt || left.finishedAt),
  );

export const loadScheduleOverviewPayload = async ({
  workspace,
  knowledgeBase = null,
  kbSnapshot = null,
}: {
  workspace: {
    id: string;
    name: string;
    slug?: string | null;
  };
  knowledgeBase?: {
    id: string;
    name: string;
    slug?: string | null;
  } | null;
  kbSnapshot?: {
    id: string;
    deployHash?: string | null;
  } | null;
}): Promise<ScheduleOverviewPayload> => {
  const filter = knowledgeBase
    ? { workspaceId: workspace.id, knowledgeBaseId: knowledgeBase.id }
    : { workspaceId: workspace.id };
  const jobs = await components.scheduleJobRepository.findAllBy(filter as any);
  const jobViews = sortJobs(
    await Promise.all(jobs.map(async (job) => await buildJobView(job))),
  );

  const jobIds = jobViews.map((job) => job.id);
  const jobIdSet = new Set(jobIds);
  const runRows =
    await components.scheduleJobRunRepository.findAllByScheduleJobIds(jobIds);
  const recentRuns = sortRuns(
    runRows
      .filter((run) => jobIdSet.has(run.scheduleJobId))
      .map((run) => {
        const job = jobViews.find((item) => item.id === run.scheduleJobId);
        return {
          id: run.id,
          scheduleJobId: run.scheduleJobId,
          targetType: job?.targetType || 'unknown',
          targetTypeLabel:
            job?.targetTypeLabel || getScheduleTargetTypeLabel(job?.targetType),
          targetName: job?.targetName || `任务 #${run.scheduleJobId}`,
          status: run.status,
          startedAt: run.startedAt || null,
          finishedAt: run.finishedAt || null,
          traceId: run.traceId || null,
          errorMessage: run.errorMessage || null,
          detailJson: run.detailJson || null,
        } satisfies ScheduleRunView;
      }),
  ).slice(0, 12);

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug || null,
    },
    currentKnowledgeBase: knowledgeBase
      ? {
          id: knowledgeBase.id,
          name: knowledgeBase.name,
          slug: knowledgeBase.slug || null,
        }
      : null,
    currentKbSnapshot: kbSnapshot
      ? {
          id: kbSnapshot.id,
          deployHash: kbSnapshot.deployHash || null,
        }
      : null,
    stats: {
      jobCount: jobViews.length,
      activeJobCount: jobViews.filter((job) => job.status === 'active').length,
      runCount: recentRuns.length,
      latestRunStatus: recentRuns[0]?.status || null,
    },
    jobs: jobViews,
    recentRuns,
  };
};
