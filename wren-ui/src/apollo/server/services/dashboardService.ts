import {
  IDashboardRepository,
  IDashboardItemRepository,
  Dashboard,
  DashboardItem,
  DashboardItemType,
  DashboardItemDetail,
  DashboardItemLayout,
} from '@server/repositories';
import { getLogger } from '@server/utils';
import { getUTCOffsetMinutes } from '@server/utils/timezone';
import { IProjectService } from './projectService';
import {
  SetDashboardCacheData,
  ScheduleFrequencyEnum,
  CacheScheduleDayEnum,
  DashboardSchedule,
  DAYS,
} from '@server/models/dashboard';
import { CronExpressionParser } from 'cron-parser';
const logger = getLogger('DashboardService');
logger.level = 'debug';

export interface CreateDashboardItemInput {
  dashboardId: number;
  type: DashboardItemType;
  sql: string;
  chartSchema: DashboardItemDetail['chartSchema'];
}

export interface UpdateDashboardItemInput {
  displayName: string;
}

export type UpdateDashboardItemLayouts = (DashboardItemLayout & {
  itemId: number;
})[];

export interface IDashboardService {
  initDashboard(): Promise<Dashboard>;
  getCurrentDashboard(): Promise<Dashboard>;
  getDashboardItem(dashboardItemId: number): Promise<DashboardItem>;
  getDashboardItems(dashboardId: number): Promise<DashboardItem[]>;
  createDashboardItem(input: CreateDashboardItemInput): Promise<DashboardItem>;
  updateDashboardItem(
    dashboardItemId: number,
    input: UpdateDashboardItemInput,
  ): Promise<DashboardItem>;
  deleteDashboardItem(dashboardItemId: number): Promise<boolean>;
  updateDashboardItemLayouts(
    layouts: UpdateDashboardItemLayouts,
  ): Promise<DashboardItem[]>;
  setDashboardSchedule(
    dashboardId: number,
    data: SetDashboardCacheData,
  ): Promise<Dashboard>;
  parseCronExpression(dashboard: Dashboard): DashboardSchedule;
}

export class DashboardService implements IDashboardService {
  private projectService: IProjectService;
  private dashboardItemRepository: IDashboardItemRepository;
  private dashboardRepository: IDashboardRepository;

  constructor({
    projectService,
    dashboardItemRepository,
    dashboardRepository,
  }: {
    projectService: IProjectService;
    dashboardItemRepository: IDashboardItemRepository;
    dashboardRepository: IDashboardRepository;
  }) {
    this.projectService = projectService;
    this.dashboardItemRepository = dashboardItemRepository;
    this.dashboardRepository = dashboardRepository;
  }

  public async setDashboardSchedule(
    dashboardId: number,
    data: SetDashboardCacheData,
  ): Promise<Dashboard> {
    try {
      const { cacheEnabled, schedule } = data;
      // Validate input
      this.validateScheduleInput(data);

      // Check if dashboard exists
      const dashboard = await this.dashboardRepository.findOneBy({
        id: dashboardId,
      });
      if (!dashboard) {
        throw new Error(`Dashboard with id ${dashboardId} not found`);
      }
      if (!cacheEnabled) {
        return await this.dashboardRepository.updateOne(dashboardId, {
          cacheEnabled: false,
          scheduleFrequency: null,
          scheduleTimezone: null,
          scheduleCron: null,
          nextScheduledAt: null,
        });
      }
      // Initialize schedule-related variables
      let cronExpression: string | null = null;
      let nextScheduledAt: Date | null = null;

      // Process schedule if caching is enabled
      if (cacheEnabled && schedule.frequency !== ScheduleFrequencyEnum.NEVER) {
        cronExpression = this.generateCronExpression(schedule);
        nextScheduledAt = this.calculateNextRunTime(cronExpression);
      }

      // Update dashboard with new schedule
      return await this.dashboardRepository.updateOne(dashboardId, {
        cacheEnabled,
        scheduleFrequency: schedule.frequency,
        scheduleTimezone: schedule.timezone,
        scheduleCron: cronExpression,
        nextScheduledAt,
      });
    } catch (error) {
      logger.error(`Failed to set dashboard schedule: ${error.message}`);
      throw error;
    }
  }

  public async initDashboard(): Promise<Dashboard> {
    const project = await this.projectService.getCurrentProject();
    const existingDashboard = await this.dashboardRepository.findOneBy({
      projectId: project.id,
    });
    if (existingDashboard) return existingDashboard;
    // only support one dashboard for oss
    return await this.dashboardRepository.createOne({
      name: 'Dashboard',
      projectId: project.id,
    });
  }

  public async getCurrentDashboard(): Promise<Dashboard> {
    const project = await this.projectService.getCurrentProject();
    const dashboard = await this.dashboardRepository.findOneBy({
      projectId: project.id,
    });
    return { ...dashboard };
  }

  public async getDashboardItem(
    dashboardItemId: number,
  ): Promise<DashboardItem> {
    const item = await this.dashboardItemRepository.findOneBy({
      id: dashboardItemId,
    });
    if (!item) {
      throw new Error('Dashboard item not found.');
    }
    return item;
  }

  public async getDashboardItems(
    dashboardId: number,
  ): Promise<DashboardItem[]> {
    return await this.dashboardItemRepository.findAllBy({
      dashboardId,
    });
  }

  public async createDashboardItem(
    input: CreateDashboardItemInput,
  ): Promise<DashboardItem> {
    const layout = await this.calculateNewLayout(input.dashboardId);
    return await this.dashboardItemRepository.createOne({
      dashboardId: input.dashboardId,
      type: input.type,
      detail: {
        sql: input.sql,
        chartSchema: input.chartSchema,
      },
      layout,
    });
  }

  public async updateDashboardItem(
    dashboardItemId: number,
    input: UpdateDashboardItemInput,
  ): Promise<DashboardItem> {
    return await this.dashboardItemRepository.updateOne(dashboardItemId, {
      displayName: input.displayName,
    });
  }

  public async updateDashboardItemLayouts(
    layouts: UpdateDashboardItemLayouts,
  ): Promise<DashboardItem[]> {
    const updatedItems: DashboardItem[] = [];
    const isValidLayouts = layouts.every(
      (layout) =>
        layout.itemId &&
        layout.x >= 0 &&
        layout.y >= 0 &&
        layout.w > 0 &&
        layout.h > 0,
    );
    if (!isValidLayouts) {
      throw new Error('Invalid layouts boundaries.');
    }
    await Promise.all(
      layouts.map(async (layout) => {
        const updatedItem = await this.dashboardItemRepository.updateOne(
          layout.itemId,
          {
            layout: {
              x: layout.x,
              y: layout.y,
              w: layout.w,
              h: layout.h,
            },
          },
        );
        updatedItems.push(updatedItem);
      }),
    );
    return updatedItems;
  }

  public async deleteDashboardItem(dashboardItemId: number): Promise<boolean> {
    await this.dashboardItemRepository.deleteOne(dashboardItemId);
    return true;
  }

  private async calculateNewLayout(
    dashboardId: number,
  ): Promise<DashboardItemLayout> {
    const dashboardItems = await this.dashboardItemRepository.findAllBy({
      dashboardId,
    });
    const allLayouts = dashboardItems.map((item) => item.layout);
    if (allLayouts.length === 0) return { x: 0, y: 0, w: 3, h: 2 };

    const columnCount = 6;
    const halfLayoutX = columnCount / 2;
    // the current max y is the current row
    const maxY = Math.max(...allLayouts.map((layout) => layout.y));

    const latestLayout = allLayouts.filter((layout) => layout.y === maxY);
    const isNextRow =
      latestLayout.reduce((acc, layout) => acc + layout.x + layout.w, 0) >
      halfLayoutX;

    const x = isNextRow ? 0 : halfLayoutX;
    const y = isNextRow ? maxY + 2 : maxY;
    return { x, y, w: 3, h: 2 };
  }

  protected toUTC(schedule: DashboardSchedule): DashboardSchedule {
    // If no timezone is specified or it's a custom schedule, return as is
    if (
      !schedule.timezone ||
      schedule.frequency === ScheduleFrequencyEnum.CUSTOM
    ) {
      return schedule;
    }

    // Get timezone offset in minutes
    const offsetMinutes = getUTCOffsetMinutes(schedule.timezone);

    // Convert to UTC by subtracting the offset (if timezone is ahead of UTC)
    // or adding the offset (if timezone is behind UTC)
    let utcMinute = schedule.minute - offsetMinutes;
    let carryOver = 0;

    // Handle minute carry-over
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

    // Handle hour carry-over
    if (utcHour < 0) {
      dayAdjustment = Math.ceil(Math.abs(utcHour) / 24);
      utcHour = (utcHour + dayAdjustment * 24) % 24;
      dayAdjustment = -dayAdjustment;
    } else if (utcHour >= 24) {
      dayAdjustment = Math.floor(utcHour / 24);
      utcHour = utcHour % 24;
    }

    // For weekly schedules, adjust the day if needed
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

    // Return a new schedule object with UTC hours and minutes
    return {
      ...schedule,
      hour: utcHour,
      minute: utcMinute,
    };
  }

  protected toTimezone(schedule: DashboardSchedule): DashboardSchedule {
    const { timezone } = schedule;
    // If it's a custom schedule or no timezone is specified, return as is
    if (
      [ScheduleFrequencyEnum.CUSTOM, ScheduleFrequencyEnum.NEVER].includes(
        schedule.frequency,
      ) ||
      !timezone
    ) {
      return schedule;
    }

    // Get timezone offset in minutes
    const offsetMinutes = getUTCOffsetMinutes(timezone);

    // Convert from UTC to timezone by adding the offset (if timezone is ahead of UTC)
    // or subtracting the offset (if timezone is behind UTC)
    let localMinute = schedule.minute + offsetMinutes;
    let carryOver = 0;

    // Handle minute carry-over
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

    // Handle hour carry-over
    if (localHour < 0) {
      dayAdjustment = Math.ceil(Math.abs(localHour) / 24);
      localHour = (localHour + dayAdjustment * 24) % 24;
      dayAdjustment = -dayAdjustment;
    } else if (localHour >= 24) {
      dayAdjustment = Math.floor(localHour / 24);
      localHour = localHour % 24;
    }

    // For weekly schedules, adjust the day if needed
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

    // Return a new schedule object with local hours and minutes
    return {
      ...schedule,
      hour: localHour,
      minute: localMinute,
      timezone,
    };
  }

  protected generateCronExpression(schedule: DashboardSchedule): string | null {
    const { frequency, day, hour, minute } = this.toUTC(schedule);

    switch (frequency) {
      case ScheduleFrequencyEnum.DAILY:
        return `${minute} ${hour} * * *`;
      case ScheduleFrequencyEnum.WEEKLY:
        // e.g. 0 10 * * MON
        return `${minute} ${hour} * * ${day}`;
      case ScheduleFrequencyEnum.CUSTOM:
        return schedule.cron;
      case ScheduleFrequencyEnum.NEVER:
        return null;
      default:
        logger.warn(`Unsupported schedule frequency: ${frequency}`);
        return null;
    }
  }

  protected calculateNextRunTime(cronExpression: string): Date | null {
    try {
      const interval = CronExpressionParser.parse(cronExpression, {
        currentDate: new Date(),
      });
      return interval.next().toDate();
    } catch (error) {
      logger.error(`Failed to parse cron expression: ${error.message}`);
      return null;
    }
  }

  protected validateScheduleInput(data: SetDashboardCacheData): void {
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
      // can not less than 10 minutes, skip if is local
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
  }

  public parseCronExpression(dashboard: Dashboard): DashboardSchedule {
    if (!dashboard.scheduleCron) {
      return {
        frequency: dashboard.scheduleFrequency,
        hour: 0,
        minute: 0,
        day: null,
        timezone: dashboard.scheduleTimezone || '',
        cron: '',
      } as DashboardSchedule;
    }
    switch (dashboard.scheduleFrequency) {
      case ScheduleFrequencyEnum.CUSTOM:
        return {
          frequency: ScheduleFrequencyEnum.CUSTOM,
          hour: 0,
          minute: 0,
          day: null,
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
        return this.toTimezone({
          frequency: dashboard.scheduleFrequency,
          hour: parseInt(hour, 10),
          minute: parseInt(minute, 10),
          day:
            dashboard.scheduleFrequency === ScheduleFrequencyEnum.WEEKLY
              ? (dayOfWeek as CacheScheduleDayEnum)
              : null,
          timezone: dashboard.scheduleTimezone || '',
          cron: null,
        } as DashboardSchedule);
      }
      case ScheduleFrequencyEnum.NEVER: {
        return {
          frequency: ScheduleFrequencyEnum.NEVER,
          hour: null,
          minute: null,
          day: null,
          timezone: dashboard.scheduleTimezone || '',
          cron: null,
        } as DashboardSchedule;
      }
      default: {
        throw new Error('Invalid schedule frequency');
      }
    }
  }
}
