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
});
