import {
  CacheScheduleDayEnum,
  DashboardSchedule,
  DAYS,
  ScheduleFrequencyEnum,
  SetDashboardCacheData,
} from '@server/models/dashboard';
import {
  Dashboard,
  DashboardItemLayout,
  IDashboardItemRepository,
  IDashboardRepository,
} from '@server/repositories';
import type { IQueryOptions } from '@server/repositories/baseRepository';
import { getLogger } from '@server/utils';
import { getUTCOffsetMinutes } from '@server/utils/timezone';
import { CronExpressionParser } from 'cron-parser';
import { DashboardRuntimeBinding } from './dashboardServiceTypes';

const logger = getLogger('DashboardService');

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const buildDashboardRuntimeBindingPatch = (
  dashboard: Dashboard,
  binding: DashboardRuntimeBinding,
): Partial<Dashboard> => {
  if (
    dashboard.knowledgeBaseId &&
    binding.knowledgeBaseId &&
    dashboard.knowledgeBaseId !== binding.knowledgeBaseId
  ) {
    throw new Error(
      `Dashboard ${dashboard.id} is already bound to another knowledge base`,
    );
  }

  const patch: Partial<Dashboard> = {};

  if (
    binding.knowledgeBaseId !== undefined &&
    binding.knowledgeBaseId !== dashboard.knowledgeBaseId
  ) {
    patch.knowledgeBaseId = binding.knowledgeBaseId ?? null;
  }
  if (
    binding.kbSnapshotId !== undefined &&
    binding.kbSnapshotId !== dashboard.kbSnapshotId
  ) {
    patch.kbSnapshotId = binding.kbSnapshotId ?? null;
  }
  if (
    binding.deployHash !== undefined &&
    binding.deployHash !== dashboard.deployHash
  ) {
    patch.deployHash = binding.deployHash ?? null;
  }
  if (
    binding.createdBy !== undefined &&
    binding.createdBy !== dashboard.createdBy
  ) {
    patch.createdBy = binding.createdBy ?? null;
  }

  return patch;
};

export const findProjectDashboardByProjectBridge = async (
  dashboardRepository: IDashboardRepository,
  bridgeProjectId: number,
): Promise<Dashboard | null> => {
  const dashboards = await dashboardRepository.findAllBy({
    projectId: bridgeProjectId,
  });
  return resolveDefaultDashboard(
    dashboards.filter((dashboard) => dashboard.projectId === bridgeProjectId),
  );
};

export const findUnboundProjectDashboard = async (
  dashboardRepository: IDashboardRepository,
  bridgeProjectId: number,
): Promise<Dashboard | null> => {
  const dashboards = await dashboardRepository.findAllBy({
    projectId: bridgeProjectId,
  });
  return resolveDefaultDashboard(
    dashboards.filter((dashboard) => !dashboard.knowledgeBaseId),
  );
};

export const sortDashboardsForScope = (dashboards: Dashboard[]) =>
  [...dashboards].sort((left, right) => {
    const leftIsDefault = Boolean(left.isDefault);
    const rightIsDefault = Boolean(right.isDefault);
    if (leftIsDefault !== rightIsDefault) {
      return leftIsDefault ? -1 : 1;
    }
    if (left.id === right.id) {
      return 0;
    }
    return left.id - right.id;
  });

export const resolveDefaultDashboard = (
  dashboards: Dashboard[],
): Dashboard | null => sortDashboardsForScope(dashboards)[0] || null;

export const createScopedDashboard = async (
  dashboardRepository: IDashboardRepository,
  {
    bridgeProjectId,
    binding,
    isDefault = false,
    name = 'Dashboard',
  }: {
    bridgeProjectId: number | null;
    binding?: DashboardRuntimeBinding;
    isDefault?: boolean;
    name?: string;
  },
  queryOptions?: IQueryOptions,
): Promise<Dashboard> => {
  const payload = {
    isDefault,
    name,
    projectId: bridgeProjectId ?? null,
    knowledgeBaseId: binding?.knowledgeBaseId ?? null,
    kbSnapshotId: binding?.kbSnapshotId ?? null,
    deployHash: binding?.deployHash ?? null,
    createdBy: binding?.createdBy ?? null,
  };

  if (queryOptions) {
    return await dashboardRepository.createOne(payload, queryOptions);
  }

  return await dashboardRepository.createOne(payload);
};

export const calculateDashboardNewLayout = async (
  dashboardItemRepository: IDashboardItemRepository,
  dashboardId: number,
): Promise<DashboardItemLayout> => {
  const dashboardItems = await dashboardItemRepository.findAllBy({
    dashboardId,
  });
  const allLayouts = dashboardItems.map((item) => item.layout);
  if (allLayouts.length === 0) return { x: 0, y: 0, w: 3, h: 2 };

  const columnCount = 6;
  const halfLayoutX = columnCount / 2;
  const maxY = Math.max(...allLayouts.map((layout) => layout.y));

  const latestLayout = allLayouts.filter((layout) => layout.y === maxY);
  const isNextRow =
    latestLayout.reduce((acc, layout) => acc + layout.x + layout.w, 0) >
    halfLayoutX;

  const x = isNextRow ? 0 : halfLayoutX;
  const y = isNextRow ? maxY + 2 : maxY;
  return { x, y, w: 3, h: 2 };
};

export const toUtcDashboardSchedule = (
  schedule: DashboardSchedule,
): DashboardSchedule => {
  if (
    !schedule.timezone ||
    schedule.frequency === ScheduleFrequencyEnum.CUSTOM
  ) {
    return schedule;
  }

  const offsetMinutes = getUTCOffsetMinutes(schedule.timezone);
  let utcMinute = schedule.minute - offsetMinutes;
  let carryOver = 0;

  if (utcMinute < 0) {
    carryOver = Math.ceil(Math.abs(utcMinute) / 60);
    utcMinute = (utcMinute + carryOver * 60) % 60;
    carryOver = -carryOver;
  } else if (utcMinute >= 60) {
    carryOver = Math.floor(utcMinute / 60);
    utcMinute = utcMinute % 60;
  }

  let utcHour = schedule.hour + carryOver;
  let dayAdjustment = 0;

  if (utcHour < 0) {
    dayAdjustment = Math.ceil(Math.abs(utcHour) / 24);
    utcHour = (utcHour + dayAdjustment * 24) % 24;
    dayAdjustment = -dayAdjustment;
  } else if (utcHour >= 24) {
    dayAdjustment = Math.floor(utcHour / 24);
    utcHour = utcHour % 24;
  }

  if (
    schedule.frequency === ScheduleFrequencyEnum.WEEKLY &&
    dayAdjustment !== 0
  ) {
    const currentDayIndex = DAYS.indexOf(schedule.day);
    const adjustedDayIndex = (currentDayIndex + dayAdjustment + 7) % 7;
    return {
      ...schedule,
      hour: utcHour,
      minute: utcMinute,
      day: DAYS[adjustedDayIndex],
    };
  }

  return {
    ...schedule,
    hour: utcHour,
    minute: utcMinute,
  };
};

export const toDashboardTimezoneSchedule = (
  schedule: DashboardSchedule,
): DashboardSchedule => {
  const { timezone } = schedule;
  if (
    [ScheduleFrequencyEnum.CUSTOM, ScheduleFrequencyEnum.NEVER].includes(
      schedule.frequency,
    ) ||
    !timezone
  ) {
    return schedule;
  }

  const offsetMinutes = getUTCOffsetMinutes(timezone);
  let localMinute = schedule.minute + offsetMinutes;
  let carryOver = 0;

  if (localMinute < 0) {
    carryOver = Math.ceil(Math.abs(localMinute) / 60);
    localMinute = (localMinute + carryOver * 60) % 60;
    carryOver = -carryOver;
  } else if (localMinute >= 60) {
    carryOver = Math.floor(localMinute / 60);
    localMinute = localMinute % 60;
  }

  let localHour = schedule.hour + carryOver;
  let dayAdjustment = 0;

  if (localHour < 0) {
    dayAdjustment = Math.ceil(Math.abs(localHour) / 24);
    localHour = (localHour + dayAdjustment * 24) % 24;
    dayAdjustment = -dayAdjustment;
  } else if (localHour >= 24) {
    dayAdjustment = Math.floor(localHour / 24);
    localHour = localHour % 24;
  }

  if (
    schedule.frequency === ScheduleFrequencyEnum.WEEKLY &&
    dayAdjustment !== 0
  ) {
    const currentDayIndex = DAYS.indexOf(schedule.day);
    const adjustedDayIndex = (currentDayIndex + dayAdjustment + 7) % 7;
    return {
      ...schedule,
      hour: localHour,
      minute: localMinute,
      day: DAYS[adjustedDayIndex],
      timezone,
    };
  }

  return {
    ...schedule,
    hour: localHour,
    minute: localMinute,
    timezone,
  };
};

export const generateDashboardCronExpression = (
  schedule: DashboardSchedule,
): string | null => {
  const { frequency, day, hour, minute } = toUtcDashboardSchedule(schedule);

  switch (frequency) {
    case ScheduleFrequencyEnum.DAILY:
      return `${minute} ${hour} * * *`;
    case ScheduleFrequencyEnum.WEEKLY:
      return `${minute} ${hour} * * ${day}`;
    case ScheduleFrequencyEnum.CUSTOM:
      return schedule.cron;
    case ScheduleFrequencyEnum.NEVER:
      return null;
    default:
      logger.warn(`Unsupported schedule frequency: ${frequency}`);
      return null;
  }
};

export const calculateDashboardNextRunTime = (
  cronExpression: string,
): Date | null => {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
    });
    return interval.next().toDate();
  } catch (error: unknown) {
    logger.error(`Failed to parse cron expression: ${toErrorMessage(error)}`);
    return null;
  }
};

export const validateDashboardScheduleInput = (
  data: SetDashboardCacheData,
): void => {
  const { schedule } = data;
  if (!schedule) {
    return;
  }
  if (schedule.frequency === ScheduleFrequencyEnum.WEEKLY && !schedule.day) {
    throw new Error('Day of week is required for weekly schedule');
  }

  if (schedule.frequency === ScheduleFrequencyEnum.CUSTOM && !schedule.cron) {
    throw new Error('Cron expression is required for custom schedule');
  }

  if (schedule.hour < 0 || schedule.hour > 23) {
    throw new Error('Hour must be between 0 and 23');
  }

  if (schedule.minute < 0 || schedule.minute > 59) {
    throw new Error('Minute must be between 0 and 59');
  }

  if (schedule.timezone) {
    try {
      new Date().toLocaleString('en-US', { timeZone: schedule.timezone });
    } catch (_) {
      throw new Error(`Invalid timezone: ${schedule.timezone}`);
    }
  }

  if (schedule.frequency === ScheduleFrequencyEnum.CUSTOM) {
    if (process.env.NODE_ENV === 'development') return;
    const baseInterval = CronExpressionParser.parse(schedule.cron, {
      currentDate: new Date(),
    });
    const baseDate = baseInterval.next().toDate();

    const nextInterval = CronExpressionParser.parse(schedule.cron, {
      currentDate: baseDate,
    });
    const nextDate = nextInterval.next().toDate();
    const diff = nextDate.getTime() - baseDate.getTime();
    if (diff < 10 * 60 * 1000) {
      throw new Error(
        'Custom cron expression must be at least 10 minutes apart',
      );
    }
  }
};

export const parseDashboardCronExpression = (
  dashboard: Dashboard,
): DashboardSchedule => {
  const frequency = dashboard.scheduleFrequency || ScheduleFrequencyEnum.NEVER;
  if (!dashboard.scheduleCron) {
    return {
      frequency,
      hour: 0,
      minute: 0,
      day: CacheScheduleDayEnum.SUN,
      timezone: dashboard.scheduleTimezone || '',
      cron: '',
    };
  }
  switch (frequency) {
    case ScheduleFrequencyEnum.CUSTOM:
      return {
        frequency: ScheduleFrequencyEnum.CUSTOM,
        hour: 0,
        minute: 0,
        day: CacheScheduleDayEnum.SUN,
        timezone: dashboard.scheduleTimezone || '',
        cron: dashboard.scheduleCron,
      };
    case ScheduleFrequencyEnum.DAILY:
    case ScheduleFrequencyEnum.WEEKLY: {
      const parts = dashboard.scheduleCron.split(' ');
      if (parts.length !== 5) {
        throw new Error('Invalid cron expression format');
      }
      const [minute, hour, , , dayOfWeek] = parts;
      return toDashboardTimezoneSchedule({
        frequency,
        hour: parseInt(hour, 10),
        minute: parseInt(minute, 10),
        day:
          frequency === ScheduleFrequencyEnum.WEEKLY
            ? (dayOfWeek as CacheScheduleDayEnum)
            : CacheScheduleDayEnum.SUN,
        timezone: dashboard.scheduleTimezone || '',
        cron: '',
      });
    }
    case ScheduleFrequencyEnum.NEVER:
      return {
        frequency: ScheduleFrequencyEnum.NEVER,
        hour: 0,
        minute: 0,
        day: CacheScheduleDayEnum.SUN,
        timezone: dashboard.scheduleTimezone || '',
        cron: '',
      };
    default:
      throw new Error('Invalid schedule frequency');
  }
};
