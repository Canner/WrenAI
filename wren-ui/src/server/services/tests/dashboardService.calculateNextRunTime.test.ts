import {
  CacheScheduleDayEnum,
  ScheduleFrequencyEnum,
} from '@server/models/dashboard';
import {
  createDashboardServiceHarness,
  TestDashboardService,
} from './dashboardService.testSupport';

describe('DashboardService', () => {
  let dashboardService: TestDashboardService;

  beforeEach(() => {
    ({ dashboardService } = createDashboardServiceHarness());
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
});
