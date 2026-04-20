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
});
