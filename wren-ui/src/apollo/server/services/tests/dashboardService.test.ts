import { DashboardService } from '../dashboardService';
import { ScheduleFrequencyEnum } from '@server/models/dashboard';
import { CacheScheduleDayEnum } from '@server/models/dashboard';
import {
  SetDashboardCacheData,
  DashboardSchedule,
} from '@server/models/dashboard';

// Create a test class that extends DashboardService to access protected methods
class TestDashboardService extends DashboardService {
  public testGenerateCronExpression(
    schedule: DashboardSchedule,
  ): string | null {
    return this.generateCronExpression(schedule);
  }

  public testCalculateNextRunTime(cronExpression: string): Date | null {
    return this.calculateNextRunTime(cronExpression);
  }

  public testToUTC(schedule: DashboardSchedule): DashboardSchedule {
    return this.toUTC(schedule);
  }

  public testToTimezone(schedule: DashboardSchedule): DashboardSchedule {
    return this.toTimezone(schedule);
  }

  public testValidateScheduleInput(data: SetDashboardCacheData): void {
    return this.validateScheduleInput(data);
  }
}

describe('DashboardService', () => {
  let dashboardService: TestDashboardService;
  let mockProjectService;
  let mockDashboardItemRepository;
  let mockDashboardRepository;

  const createScheduleData = (
    frequency: ScheduleFrequencyEnum,
    options: {
      hour?: number;
      minute?: number;
      day?: CacheScheduleDayEnum;
      timezone?: string;
      cron?: string;
      cacheEnabled?: boolean;
    } = {},
  ): SetDashboardCacheData => {
    return {
      cacheEnabled: options.cacheEnabled ?? true,
      schedule: {
        frequency,
        hour: options.hour ?? 0,
        minute: options.minute ?? 0,
        day: options.day ?? CacheScheduleDayEnum.MON,
        timezone: options.timezone ?? '',
        cron: options.cron ?? '',
      },
    };
  };

  beforeEach(() => {
    mockProjectService = {
      getCurrentProject: jest.fn(),
    };
    mockDashboardItemRepository = {
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
    };
    mockDashboardRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };

    dashboardService = new TestDashboardService({
      projectService: mockProjectService,
      dashboardItemRepository: mockDashboardItemRepository,
      dashboardRepository: mockDashboardRepository,
    });
  });

  describe('generateCronExpression', () => {
    it('should generate correct cron expression for daily schedule', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.DAILY,
        hour: 14,
        minute: 30,
        timezone: '',
        day: null,
        cron: null,
      };

      const result = dashboardService.testGenerateCronExpression(schedule);
      expect(result).toBe('30 14 * * *');
    });

    it('should generate correct cron expression for weekly schedule', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.MON,
        hour: 9,
        minute: 0,
        timezone: '',
        cron: null,
      };

      const result = dashboardService.testGenerateCronExpression(schedule);
      expect(result).toBe('0 9 * * MON');
    });

    it('should return custom cron expression for custom schedule', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.CUSTOM,
        cron: '0 0 * * *',
        timezone: '',
        day: null,
        hour: 0,
        minute: 0,
      };

      const result = dashboardService.testGenerateCronExpression(schedule);
      expect(result).toBe('0 0 * * *');
    });

    it('should return null for never schedule', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.NEVER,
        timezone: '',
        day: null,
        hour: 0,
        minute: 0,
        cron: null,
      };

      const result = dashboardService.testGenerateCronExpression(schedule);
      expect(result).toBeNull();
    });
  });

  describe('calculateNextRunTime', () => {
    it('should return null for invalid cron expression', () => {
      const result = dashboardService.testCalculateNextRunTime('invalid-cron');
      expect(result).toBeNull();
    });

    it('should calculate next run time for daily schedule', () => {
      const cronExpression = '0 12 * * *'; // Every day at 12:00 PM
      const result = dashboardService.testCalculateNextRunTime(cronExpression);

      const now = Date.now();
      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBeGreaterThan(now);

      // Verify the time is correct (within 1 minute of expected time)
      const expectedTime = new Date();
      expectedTime.setHours(12, 0, 0, 0);
      if (expectedTime < new Date()) {
        expectedTime.setDate(expectedTime.getDate() + 1);
      }
      expect(
        Math.abs((result?.getTime() ?? 0) - expectedTime.getTime()),
      ).toBeLessThan(60000);
    });

    it('should calculate next run time for weekly schedule', () => {
      const cronExpression = '0 12 * * 1'; // Every Monday at 12:00 PM
      const result = dashboardService.testCalculateNextRunTime(cronExpression);

      expect(result).toBeInstanceOf(Date);
      const now = Date.now();
      expect(result!.getTime()).toBeGreaterThan(now);

      // Verify it's a Monday
      expect(result?.getDay()).toBe(1); // 1 represents Monday
    });

    it('should calculate next run time for custom schedule', () => {
      const cronExpression = '0 */2 * * *'; // Every 2 hours
      const result = dashboardService.testCalculateNextRunTime(cronExpression);

      expect(result).toBeInstanceOf(Date);
      const now = Date.now();
      expect(result!.getTime()).toBeGreaterThan(now);

      // Verify the time is in 2-hour intervals
      const hours = result?.getHours() ?? 0;
      expect(hours % 2).toBe(0);
    });

    it('should handle timezone conversion correctly', () => {
      // Test with a schedule that would be affected by timezone conversion
      const schedule = {
        frequency: ScheduleFrequencyEnum.DAILY,
        timezone: 'America/New_York',
        hour: 12,
        minute: 0,
        day: CacheScheduleDayEnum.MON,
        cron: '',
      };

      const cronExpression =
        dashboardService.testGenerateCronExpression(schedule);
      const result = dashboardService.testCalculateNextRunTime(
        cronExpression ?? '',
      );

      expect(result).toBeInstanceOf(Date);
      const now = Date.now();
      expect(result!.getTime()).toBeGreaterThan(now);
    });
  });

  describe('toUTC', () => {
    beforeEach(() => {
      // Mock the current date to a fixed value for consistent testing
      jest.useFakeTimers().setSystemTime(new Date('2024-04-22T10:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return original schedule if no timezone is specified', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.DAILY,
        hour: 14,
        minute: 30,
        timezone: '',
        day: null,
        cron: null,
      };

      const result = dashboardService.testToUTC(schedule);
      expect(result).toEqual(schedule);
    });

    it('should convert daily schedule from local time to UTC', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.DAILY,
        hour: 14,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
        day: null,
        cron: null,
      };
      const result = dashboardService.testToUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 18, // 14 + 4 = 18 UTC
        minute: 30,
      });
    });

    it('should convert weekly schedule from local time to UTC without day change', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.MON,
        hour: 14,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
        cron: null,
      };

      const result = dashboardService.testToUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 18, // 14 + 4 = 18 UTC
        minute: 30,
        day: CacheScheduleDayEnum.MON, // Same day because 18:30 UTC is still Monday
      });
    });

    it('should adjust day forward for weekly schedule when UTC time crosses midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.MON,
        hour: 23,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
        cron: null,
      };

      const result = dashboardService.testToUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 3, // 23 + 4 = 3 UTC (next day)
        minute: 30,
        day: CacheScheduleDayEnum.TUE, // Day changes to Tuesday
      });
    });

    it('should adjust day forward from Saturday to Sunday when UTC time crosses midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.SAT,
        hour: 23,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
        cron: null,
      };

      const result = dashboardService.testToUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 3, // 23 + 4 = 3 UTC (next day)
        minute: 30,
        day: CacheScheduleDayEnum.SUN, // Day wraps around from Saturday to Sunday
      });
    });

    it('should adjust day backward for weekly schedule when UTC time is on previous day', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.MON,
        hour: 1,
        minute: 30,
        timezone: 'Asia/Tokyo', // UTC+9
        cron: null,
      };

      const result = dashboardService.testToUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 16, // 1 - 9 = 16 UTC (previous day)
        minute: 30,
        day: CacheScheduleDayEnum.SUN, // Day changes to Sunday
      });
    });

    it('should adjust day backward from Sunday to Saturday when UTC time crosses midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.SUN,
        hour: 1,
        minute: 30,
        timezone: 'Asia/Tokyo', // UTC+9
        cron: null,
      };

      const result = dashboardService.testToUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 16, // 1 - 9 = 16 UTC (previous day)
        minute: 30,
        day: CacheScheduleDayEnum.SAT, // Day wraps around from Sunday to Saturday
      });
    });

    it('should handle custom schedule without timezone conversion', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.CUSTOM,
        cron: '0 0 * * *',
        timezone: 'America/New_York',
        day: null,
        hour: 0,
        minute: 0,
      };

      const result = dashboardService.testToUTC(schedule);
      expect(result).toEqual(schedule);
    });

    it('should handle timezone with non-hour offset (UTC+2:15)', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.DAILY,
        hour: 14,
        minute: 30,
        timezone: 'Asia/Kolkata', // UTC+5:30
        day: null,
        cron: null,
      };

      const result = dashboardService.testToUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 9, // 14 - 5 = 9 UTC
        minute: 0, // 30 - 30 = 0 UTC
      });
    });

    it('should handle timezone with non-hour offset crossing midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.MON,
        hour: 23,
        minute: 45,
        timezone: 'Asia/Kolkata', // UTC+5:30
        cron: null,
      };

      const result = dashboardService.testToUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 18, // 23 - 5 = 18 UTC
        minute: 15, // 45 - 30 = 15 UTC
        day: CacheScheduleDayEnum.MON, // Same day because 18:15 UTC is still Monday
      });
    });
  });

  describe('toTimezone', () => {
    beforeEach(() => {
      // Mock the current date to a fixed value for consistent testing
      jest.useFakeTimers().setSystemTime(new Date('2024-04-22T10:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return original schedule if no timezone is specified', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.DAILY,
        hour: 14,
        minute: 30,
        day: null,
        timezone: '',
        cron: null,
      };

      const result = dashboardService.testToTimezone(schedule);
      expect(result).toEqual(schedule);
    });

    it('should convert daily schedule from UTC to local time', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.DAILY,
        hour: 18,
        minute: 30,
        day: null,
        timezone: 'America/New_York', // UTC-4
        cron: null,
      };
      const result = dashboardService.testToTimezone(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 14, // 18 - 4 = 14 local time
        minute: 30,
      });
    });

    it('should convert weekly schedule from UTC to local time without day change', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.MON,
        hour: 18,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
        cron: null,
      };

      const result = dashboardService.testToTimezone(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 14, // 18 - 4 = 14 local time
        minute: 30,
        day: CacheScheduleDayEnum.MON, // Same day because 14:30 local is still Monday
      });
    });

    it('should adjust day forward for weekly schedule when local time crosses midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.MON,
        hour: 3,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
        cron: null,
      };

      const result = dashboardService.testToTimezone(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 23, // 3 + 4 = 23 local time (previous day)
        minute: 30,
        day: CacheScheduleDayEnum.SUN, // Day changes to Sunday
      });
    });

    it('should adjust day forward from Saturday to Sunday when local time crosses midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.SAT,
        hour: 3,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
        cron: null,
      };

      const result = dashboardService.testToTimezone(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 23, // 3 + 4 = 23 local time (previous day)
        minute: 30,
        day: CacheScheduleDayEnum.FRI, // Day wraps around from Saturday to Friday
      });
    });

    it('should adjust day backward for weekly schedule when local time is on next day', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.MON,
        hour: 16,
        minute: 30,
        timezone: 'Asia/Tokyo', // UTC+9
        cron: null,
      };

      const result = dashboardService.testToTimezone(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 1, // 16 - 9 = 1 local time (next day)
        minute: 30,
        day: CacheScheduleDayEnum.TUE, // Day changes to Tuesday
      });
    });

    it('should adjust day backward from Sunday to Monday when local time crosses midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.SUN,
        hour: 16,
        minute: 30,
        timezone: 'Asia/Tokyo', // UTC+9
        cron: null,
      };

      const result = dashboardService.testToTimezone(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 1, // 16 - 9 = 1 local time (next day)
        minute: 30,
        day: CacheScheduleDayEnum.MON, // Day wraps around from Sunday to Monday
      });
    });

    it('should handle custom schedule without timezone conversion', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.CUSTOM,
        minute: null,
        hour: null,
        day: null,
        cron: '0 0 * * *',
        timezone: 'America/New_York',
      };

      const result = dashboardService.testToTimezone(schedule);
      expect(result).toEqual(schedule);
    });

    it('should handle timezone with non-hour offset (UTC+2:15)', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.DAILY,
        hour: 9,
        minute: 0,
        day: null,
        timezone: 'Asia/Kolkata', // UTC+5:30
        cron: null,
      };

      const result = dashboardService.testToTimezone(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 14, // 9 + 5 = 14 local time
        minute: 30, // 0 + 30 = 30 local time
      });
    });

    it('should handle timezone with non-hour offset crossing midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.WEEKLY,
        day: CacheScheduleDayEnum.MON,
        hour: 18,
        minute: 15,
        timezone: 'Asia/Kolkata', // UTC+5:30
        cron: null,
      };

      const result = dashboardService.testToTimezone(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 23, // 18 + 5 = 23 local time
        minute: 45, // 15 + 30 = 45 local time
        day: CacheScheduleDayEnum.MON, // Same day because 23:45 local is still Monday
      });
    });
  });

  describe('validateScheduleInput', () => {
    it('should throw error for weekly schedule without day', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.WEEKLY,
          hour: 12,
          minute: 0,
          timezone: '',
          day: null,
          cron: null,
        },
      };

      expect(() => {
        dashboardService.testValidateScheduleInput(data);
      }).toThrow('Day of week is required for weekly schedule');
    });

    it('should throw error for custom schedule without cron expression', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.CUSTOM,
          hour: 12,
          minute: 0,
          timezone: '',
          day: null,
          cron: null,
        },
      };

      expect(() => {
        dashboardService.testValidateScheduleInput(data);
      }).toThrow('Cron expression is required for custom schedule');
    });

    it('should throw error for invalid hour', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.DAILY,
          hour: 24,
          minute: 0,
          timezone: '',
          day: null,
          cron: null,
        },
      };

      expect(() => {
        dashboardService.testValidateScheduleInput(data);
      }).toThrow('Hour must be between 0 and 23');
    });

    it('should throw error for invalid minute', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.DAILY,
          hour: 12,
          minute: 60,
          timezone: '',
          day: null,
          cron: null,
        },
      };

      expect(() => {
        dashboardService.testValidateScheduleInput(data);
      }).toThrow('Minute must be between 0 and 59');
    });

    it('should throw error for invalid timezone', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.DAILY,
          hour: 12,
          minute: 0,
          timezone: 'Invalid/Timezone',
          day: null,
          cron: null,
        },
      };

      expect(() => {
        dashboardService.testValidateScheduleInput(data);
      }).toThrow('Invalid timezone: Invalid/Timezone');
    });

    it('should throw error for custom schedule with interval less than 10 minutes', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.CUSTOM,
          cron: '*/5 * * * *', // Every 5 minutes
          timezone: '',
          day: null,
          hour: 0,
          minute: 0,
        },
      };

      expect(() => {
        dashboardService.testValidateScheduleInput(data);
      }).toThrow('Custom cron expression must be at least 10 minutes apart');
    });

    it('should not throw error for valid daily schedule', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.DAILY,
          hour: 12,
          minute: 0,
          timezone: '',
          day: CacheScheduleDayEnum.MON,
          cron: '',
        },
      };

      expect(() => {
        dashboardService.testValidateScheduleInput(data);
      }).not.toThrow();
    });

    it('should not throw error for valid weekly schedule', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.WEEKLY,
          day: CacheScheduleDayEnum.MON,
          hour: 12,
          minute: 0,
          timezone: '',
          cron: null,
        },
      };

      expect(() => {
        dashboardService.testValidateScheduleInput(data);
      }).not.toThrow();
    });

    it('should not throw error for valid custom schedule', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.CUSTOM,
          cron: '0 */15 * * *', // Every 15 minutes
          timezone: '',
          day: null,
          hour: 0,
          minute: 0,
        },
      };

      expect(() => {
        dashboardService.testValidateScheduleInput(data);
      }).not.toThrow();
    });

    it('should not throw error for valid schedule with timezone', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.DAILY,
          hour: 12,
          minute: 0,
          timezone: 'America/New_York',
          day: null,
          cron: null,
        },
      };

      expect(() => {
        dashboardService.testValidateScheduleInput(data);
      }).not.toThrow();
    });
  });

  describe('setDashboardSchedule', () => {
    beforeEach(() => {
      mockDashboardRepository.findOneBy.mockReset();
      mockDashboardRepository.updateOne.mockReset();
    });

    it('should throw error if dashboard not found', async () => {
      mockDashboardRepository.findOneBy.mockResolvedValue(null);

      const data = createScheduleData(ScheduleFrequencyEnum.DAILY, {
        hour: 12,
        minute: 0,
      });

      await expect(
        dashboardService.setDashboardSchedule(1, data),
      ).rejects.toThrow('Dashboard with id 1 not found');
    });

    it('should update dashboard with daily schedule', async () => {
      const mockDashboard = {
        id: 1,
        projectId: 1,
        name: 'Test Dashboard',
      };
      mockDashboardRepository.findOneBy.mockResolvedValue(mockDashboard);
      mockDashboardRepository.updateOne.mockResolvedValue({
        ...mockDashboard,
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.DAILY,
        scheduleCron: '0 12 * * *',
        nextScheduledAt: expect.any(Date),
        scheduleTimezone: '',
      });

      const data = createScheduleData(ScheduleFrequencyEnum.DAILY, {
        hour: 12,
        minute: 0,
      });

      await dashboardService.setDashboardSchedule(1, data);

      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(1, {
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.DAILY,
        scheduleCron: '0 12 * * *',
        nextScheduledAt: expect.any(Date),
        scheduleTimezone: '',
      });
    });

    it('should update dashboard with weekly schedule', async () => {
      const mockDashboard = {
        id: 1,
        projectId: 1,
        name: 'Test Dashboard',
      };
      mockDashboardRepository.findOneBy.mockResolvedValue(mockDashboard);
      mockDashboardRepository.updateOne.mockResolvedValue({
        ...mockDashboard,
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.WEEKLY,
        scheduleCron: '0 12 * * MON',
        nextScheduledAt: expect.any(Date),
        scheduleTimezone: '',
      });

      const data = createScheduleData(ScheduleFrequencyEnum.WEEKLY, {
        day: CacheScheduleDayEnum.MON,
        hour: 12,
        minute: 0,
      });

      await dashboardService.setDashboardSchedule(1, data);

      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(1, {
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.WEEKLY,
        scheduleCron: '0 12 * * MON',
        nextScheduledAt: expect.any(Date),
        scheduleTimezone: '',
      });
    });

    it('should update dashboard with custom schedule', async () => {
      const mockDashboard = {
        id: 1,
        projectId: 1,
        name: 'Test Dashboard',
      };
      mockDashboardRepository.findOneBy.mockResolvedValue(mockDashboard);
      mockDashboardRepository.updateOne.mockResolvedValue({
        ...mockDashboard,
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.CUSTOM,
        scheduleCron: '0 */15 * * *',
        nextScheduledAt: expect.any(Date),
        scheduleTimezone: '',
      });

      const data = createScheduleData(ScheduleFrequencyEnum.CUSTOM, {
        cron: '0 */15 * * *',
      });

      await dashboardService.setDashboardSchedule(1, data);

      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(1, {
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.CUSTOM,
        scheduleCron: '0 */15 * * *',
        nextScheduledAt: expect.any(Date),
        scheduleTimezone: '',
      });
    });

    it('should update dashboard with disabled cache', async () => {
      const mockDashboard = {
        id: 1,
        projectId: 1,
        name: 'Test Dashboard',
      };
      mockDashboardRepository.findOneBy.mockResolvedValue(mockDashboard);
      mockDashboardRepository.updateOne.mockResolvedValue({
        ...mockDashboard,
        cacheEnabled: false,
        scheduleFrequency: null,
        scheduleCron: null,
        nextScheduledAt: null,
        scheduleTimezone: null,
      });

      const data = createScheduleData(ScheduleFrequencyEnum.NEVER, {
        cacheEnabled: false,
      });

      await dashboardService.setDashboardSchedule(1, data);

      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(1, {
        cacheEnabled: false,
        scheduleFrequency: null,
        scheduleCron: null,
        nextScheduledAt: null,
        scheduleTimezone: null,
      });
    });

    it('should handle timezone conversion in schedule', async () => {
      const mockDashboard = {
        id: 1,
        projectId: 1,
        name: 'Test Dashboard',
      };
      mockDashboardRepository.findOneBy.mockResolvedValue(mockDashboard);
      mockDashboardRepository.updateOne.mockResolvedValue({
        ...mockDashboard,
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.DAILY,
        scheduleCron: '0 16 * * *', // 12:00 PM EST = 16:00 UTC
        nextScheduledAt: expect.any(Date),
        scheduleTimezone: 'America/New_York',
      });

      const data = createScheduleData(ScheduleFrequencyEnum.DAILY, {
        hour: 12,
        minute: 0,
        timezone: 'America/New_York',
      });

      await dashboardService.setDashboardSchedule(1, data);

      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(1, {
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.DAILY,
        scheduleCron: '0 16 * * *',
        nextScheduledAt: expect.any(Date),
        scheduleTimezone: 'America/New_York',
      });
    });

    it('should handle error during update', async () => {
      const mockDashboard = {
        id: 1,
        projectId: 1,
        name: 'Test Dashboard',
      };
      mockDashboardRepository.findOneBy.mockResolvedValue(mockDashboard);
      mockDashboardRepository.updateOne.mockRejectedValue(
        new Error('Update failed'),
      );

      const data = createScheduleData(ScheduleFrequencyEnum.DAILY, {
        hour: 12,
        minute: 0,
      });

      await expect(
        dashboardService.setDashboardSchedule(1, data),
      ).rejects.toThrow('Update failed');
    });
  });
});
