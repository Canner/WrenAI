import { DashboardService } from '../dashboardService';
import {
  CacheScheduleDayEnum,
  DashboardSchedule,
  ScheduleFrequencyEnum,
  SetDashboardCacheData,
} from '@server/models/dashboard';

export class TestDashboardService extends DashboardService {
  public testGenerateCronExpression(schedule: any): string | null {
    return this.generateCronExpression(schedule as DashboardSchedule);
  }

  public testCalculateNextRunTime(cronExpression: string): Date | null {
    return this.calculateNextRunTime(cronExpression);
  }

  public testToUTC(schedule: any): DashboardSchedule {
    return this.toUTC(schedule as DashboardSchedule);
  }

  public testToTimezone(schedule: any): DashboardSchedule {
    return this.toTimezone(schedule as DashboardSchedule);
  }

  public testValidateScheduleInput(data: any): void {
    return this.validateScheduleInput(data as SetDashboardCacheData);
  }
}

export const createScheduleData = (
  frequency: ScheduleFrequencyEnum,
  options: {
    hour?: number;
    minute?: number;
    day?: CacheScheduleDayEnum;
    timezone?: string;
    cron?: string;
    cacheEnabled?: boolean;
  } = {},
): SetDashboardCacheData => ({
  cacheEnabled: options.cacheEnabled ?? true,
  schedule: {
    frequency,
    hour: options.hour ?? 0,
    minute: options.minute ?? 0,
    day: options.day ?? CacheScheduleDayEnum.MON,
    timezone: options.timezone ?? '',
    cron: options.cron ?? '',
  },
});

export const createDashboardServiceHarness = () => {
  const mockTransaction = { id: 'tx-1' };
  const mockDashboardItemRepository = {
    findOneBy: jest.fn(),
    findAllBy: jest.fn(),
    createOne: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  };
  const mockDashboardRepository = {
    transaction: jest.fn().mockResolvedValue(mockTransaction),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    findOneBy: jest.fn(),
    findAllBy: jest.fn(),
    createOne: jest.fn(),
    updateOne: jest.fn(),
  };

  const dashboardService = new TestDashboardService({
    dashboardItemRepository: mockDashboardItemRepository as any,
    dashboardRepository: mockDashboardRepository as any,
  });

  return {
    dashboardService,
    mockDashboardItemRepository,
    mockDashboardRepository,
    mockTransaction,
  };
};
