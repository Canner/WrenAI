export type ScheduleConfig = {
  frequency: string;
  day?: string | null;
  hour?: number | null;
  minute?: number | null;
  cron?: string | null;
  timezone?: string | null;
};

export type ScheduleJobView = {
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
  scheduleConfig?: ScheduleConfig | null;
};

export type ScheduleRunView = {
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

export const formatDateTime = (value?: string | null) => {
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

export const getStatusColor = (status?: string | null) => {
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

export const getStatusLabel = (status?: string | null) => {
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
