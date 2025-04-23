import { DashboardService } from '../dashboardService';
import { ScheduleFrequencyEnum } from '@server/models/dashboard';
import { CacheScheduleDayEnum } from '@server/models/dashboard';
import { SetDashboardCacheData } from '@server/models/dashboard';

describe('DashboardService', () => {
  let dashboardService: DashboardService;
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

    dashboardService = new DashboardService({
      projectService: mockProjectService,
      dashboardItemRepository: mockDashboardItemRepository,
      dashboardRepository: mockDashboardRepository,
    });
  });

  describe('generateCronExpression', () => {
    it('should generate correct cron expression for daily schedule', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Daily,
        hour: 14,
        minute: 30,
      };

      const result = (dashboardService as any).generateCronExpression(schedule);
      expect(result).toBe('30 14 * * *');
    });

    it('should generate correct cron expression for weekly schedule', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Weekly,
        day: 'MON',
        hour: 9,
        minute: 0,
      };

      const result = (dashboardService as any).generateCronExpression(schedule);
      expect(result).toBe('0 9 * * MON');
    });

    it('should return custom cron expression for custom schedule', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Custom,
        cron: '0 0 * * *',
      };

      const result = (dashboardService as any).generateCronExpression(schedule);
      expect(result).toBe('0 0 * * *');
    });

    it('should return null for never schedule', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Never,
      };

      const result = (dashboardService as any).generateCronExpression(schedule);
      expect(result).toBeNull();
    });
  });

  describe('calculateNextRunTime', () => {
    it('should return null for invalid cron expression', () => {
      const result = dashboardService['calculateNextRunTime']('invalid-cron');
      expect(result).toBeNull();
    });

    it('should calculate next run time for daily schedule', () => {
      const cronExpression = '0 12 * * *'; // Every day at 12:00 PM
      const result = dashboardService['calculateNextRunTime'](cronExpression);

      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBeGreaterThan(new Date().getTime());

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
      const result = dashboardService['calculateNextRunTime'](cronExpression);

      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBeGreaterThan(new Date().getTime());

      // Verify it's a Monday
      expect(result?.getDay()).toBe(1); // 1 represents Monday
    });

    it('should calculate next run time for custom schedule', () => {
      const cronExpression = '0 */2 * * *'; // Every 2 hours
      const result = dashboardService['calculateNextRunTime'](cronExpression);

      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBeGreaterThan(new Date().getTime());

      // Verify the time is in 2-hour intervals
      const hours = result?.getHours() ?? 0;
      expect(hours % 2).toBe(0);
    });

    it('should handle timezone conversion correctly', () => {
      // Test with a schedule that would be affected by timezone conversion
      const schedule = {
        frequency: ScheduleFrequencyEnum.Daily,
        timezone: 'America/New_York',
        hour: 12,
        minute: 0,
        day: CacheScheduleDayEnum.MON,
        cron: '',
      };

      const cronExpression =
        dashboardService['generateCronExpression'](schedule);
      const result = dashboardService['calculateNextRunTime'](
        cronExpression ?? '',
      );

      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBeGreaterThan(new Date().getTime());
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
        frequency: ScheduleFrequencyEnum.Daily,
        hour: 14,
        minute: 30,
      };

      const result = (dashboardService as any).toUTC(schedule);
      expect(result).toEqual(schedule);
    });

    it('should convert daily schedule from local time to UTC', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Daily,
        hour: 14,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
      };
      const result = (dashboardService as any).toUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 18, // 14 + 4 = 18 UTC
        minute: 30,
      });
    });

    it('should convert weekly schedule from local time to UTC without day change', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Weekly,
        day: CacheScheduleDayEnum.MON,
        hour: 14,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
      };

      const result = (dashboardService as any).toUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 18, // 14 + 4 = 18 UTC
        minute: 30,
        day: CacheScheduleDayEnum.MON, // Same day because 18:30 UTC is still Monday
      });
    });

    it('should adjust day forward for weekly schedule when UTC time crosses midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Weekly,
        day: CacheScheduleDayEnum.MON,
        hour: 23,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
      };

      const result = (dashboardService as any).toUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 3, // 23 + 4 = 3 UTC (next day)
        minute: 30,
        day: CacheScheduleDayEnum.TUE, // Day changes to Tuesday
      });
    });

    it('should adjust day forward from Saturday to Sunday when UTC time crosses midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Weekly,
        day: CacheScheduleDayEnum.SAT,
        hour: 23,
        minute: 30,
        timezone: 'America/New_York', // UTC-4
      };

      const result = (dashboardService as any).toUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 3, // 23 + 4 = 3 UTC (next day)
        minute: 30,
        day: CacheScheduleDayEnum.SUN, // Day wraps around from Saturday to Sunday
      });
    });

    it('should adjust day backward for weekly schedule when UTC time is on previous day', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Weekly,
        day: CacheScheduleDayEnum.MON,
        hour: 1,
        minute: 30,
        timezone: 'Asia/Tokyo', // UTC+9
      };

      const result = (dashboardService as any).toUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 16, // 1 - 9 = 16 UTC (previous day)
        minute: 30,
        day: CacheScheduleDayEnum.SUN, // Day changes to Sunday
      });
    });

    it('should adjust day backward from Sunday to Saturday when UTC time crosses midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Weekly,
        day: CacheScheduleDayEnum.SUN,
        hour: 1,
        minute: 30,
        timezone: 'Asia/Tokyo', // UTC+9
      };

      const result = (dashboardService as any).toUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 16, // 1 - 9 = 16 UTC (previous day)
        minute: 30,
        day: CacheScheduleDayEnum.SAT, // Day wraps around from Sunday to Saturday
      });
    });

    it('should handle custom schedule without timezone conversion', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Custom,
        cron: '0 0 * * *',
        timezone: 'America/New_York',
      };

      const result = (dashboardService as any).toUTC(schedule);
      expect(result).toEqual(schedule);
    });

    it('should handle timezone with non-hour offset (UTC+2:15)', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Daily,
        hour: 14,
        minute: 30,
        timezone: 'Asia/Kolkata', // UTC+5:30
      };

      const result = (dashboardService as any).toUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 9, // 14 - 5 = 9 UTC
        minute: 0, // 30 - 30 = 0 UTC
      });
    });

    it('should handle timezone with non-hour offset crossing midnight', () => {
      const schedule = {
        frequency: ScheduleFrequencyEnum.Weekly,
        day: CacheScheduleDayEnum.MON,
        hour: 23,
        minute: 45,
        timezone: 'Asia/Kolkata', // UTC+5:30
      };

      const result = (dashboardService as any).toUTC(schedule);
      expect(result).toEqual({
        ...schedule,
        hour: 18, // 23 - 5 = 18 UTC
        minute: 15, // 45 - 30 = 15 UTC
        day: CacheScheduleDayEnum.MON, // Same day because 18:15 UTC is still Monday
      });
    });
  });

  describe('validateScheduleInput', () => {
    it('should throw error for weekly schedule without day', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.Weekly,
          hour: 12,
          minute: 0,
        },
      };

      expect(() => {
        (dashboardService as any).validateScheduleInput(data);
      }).toThrow('Day of week is required for weekly schedule');
    });

    it('should throw error for custom schedule without cron expression', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.Custom,
          hour: 12,
          minute: 0,
        },
      };

      expect(() => {
        (dashboardService as any).validateScheduleInput(data);
      }).toThrow('Cron expression is required for custom schedule');
    });

    it('should throw error for invalid hour', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.Daily,
          hour: 24,
          minute: 0,
        },
      };

      expect(() => {
        (dashboardService as any).validateScheduleInput(data);
      }).toThrow('Hour must be between 0 and 23');
    });

    it('should throw error for invalid minute', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.Daily,
          hour: 12,
          minute: 60,
        },
      };

      expect(() => {
        (dashboardService as any).validateScheduleInput(data);
      }).toThrow('Minute must be between 0 and 59');
    });

    it('should throw error for invalid timezone', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.Daily,
          hour: 12,
          minute: 0,
          timezone: 'Invalid/Timezone',
        },
      };

      expect(() => {
        (dashboardService as any).validateScheduleInput(data);
      }).toThrow('Invalid timezone: Invalid/Timezone');
    });

    it('should throw error for custom schedule with interval less than 10 minutes', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.Custom,
          cron: '*/5 * * * *', // Every 5 minutes
        },
      };

      expect(() => {
        (dashboardService as any).validateScheduleInput(data);
      }).toThrow('Custom cron expression must be at least 10 minutes apart');
    });

    it('should not throw error for valid daily schedule', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.Daily,
          hour: 12,
          minute: 0,
          timezone: '',
          day: CacheScheduleDayEnum.MON,
          cron: '',
        },
      };

      expect(() => {
        (dashboardService as any).validateScheduleInput(data);
      }).not.toThrow();
    });

    it('should not throw error for valid weekly schedule', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.Weekly,
          day: CacheScheduleDayEnum.MON,
          hour: 12,
          minute: 0,
        },
      };

      expect(() => {
        (dashboardService as any).validateScheduleInput(data);
      }).not.toThrow();
    });

    it('should not throw error for valid custom schedule', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.Custom,
          cron: '0 */15 * * *', // Every 15 minutes
        },
      };

      expect(() => {
        (dashboardService as any).validateScheduleInput(data);
      }).not.toThrow();
    });

    it('should not throw error for valid schedule with timezone', () => {
      const data = {
        cacheEnabled: true,
        schedule: {
          frequency: ScheduleFrequencyEnum.Daily,
          hour: 12,
          minute: 0,
          timezone: 'America/New_York',
        },
      };

      expect(() => {
        (dashboardService as any).validateScheduleInput(data);
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

      const data = createScheduleData(ScheduleFrequencyEnum.Daily, {
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
        scheduleFrequency: ScheduleFrequencyEnum.Daily,
        scheduleCron: '0 12 * * *',
        nextScheduledAt: expect.any(Date),
      });

      const data = createScheduleData(ScheduleFrequencyEnum.Daily, {
        hour: 12,
        minute: 0,
      });

      await dashboardService.setDashboardSchedule(1, data);

      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(1, {
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.Daily,
        scheduleCron: '0 12 * * *',
        nextScheduledAt: expect.any(Date),
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
        scheduleFrequency: ScheduleFrequencyEnum.Weekly,
        scheduleCron: '0 12 * * MON',
        nextScheduledAt: expect.any(Date),
      });

      const data = createScheduleData(ScheduleFrequencyEnum.Weekly, {
        day: CacheScheduleDayEnum.MON,
        hour: 12,
        minute: 0,
      });

      await dashboardService.setDashboardSchedule(1, data);

      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(1, {
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.Weekly,
        scheduleCron: '0 12 * * MON',
        nextScheduledAt: expect.any(Date),
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
        scheduleFrequency: ScheduleFrequencyEnum.Custom,
        scheduleCron: '0 */15 * * *',
        nextScheduledAt: expect.any(Date),
      });

      const data = createScheduleData(ScheduleFrequencyEnum.Custom, {
        cron: '0 */15 * * *',
      });

      await dashboardService.setDashboardSchedule(1, data);

      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(1, {
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.Custom,
        scheduleCron: '0 */15 * * *',
        nextScheduledAt: expect.any(Date),
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
        scheduleFrequency: ScheduleFrequencyEnum.Never,
        scheduleCron: null,
        nextScheduledAt: null,
      });

      const data = createScheduleData(ScheduleFrequencyEnum.Never, {
        cacheEnabled: false,
      });

      await dashboardService.setDashboardSchedule(1, data);

      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(1, {
        cacheEnabled: false,
        scheduleFrequency: ScheduleFrequencyEnum.Never,
        scheduleCron: null,
        nextScheduledAt: null,
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
        scheduleFrequency: ScheduleFrequencyEnum.Daily,
        scheduleCron: '0 16 * * *', // 12:00 PM EST = 16:00 UTC
        nextScheduledAt: expect.any(Date),
      });

      const data = createScheduleData(ScheduleFrequencyEnum.Daily, {
        hour: 12,
        minute: 0,
        timezone: 'America/New_York',
      });

      await dashboardService.setDashboardSchedule(1, data);

      expect(mockDashboardRepository.updateOne).toHaveBeenCalledWith(1, {
        cacheEnabled: true,
        scheduleFrequency: ScheduleFrequencyEnum.Daily,
        scheduleCron: '0 16 * * *',
        nextScheduledAt: expect.any(Date),
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

      const data = createScheduleData(ScheduleFrequencyEnum.Daily, {
        hour: 12,
        minute: 0,
      });

      await expect(
        dashboardService.setDashboardSchedule(1, data),
      ).rejects.toThrow('Update failed');
    });
  });
});
