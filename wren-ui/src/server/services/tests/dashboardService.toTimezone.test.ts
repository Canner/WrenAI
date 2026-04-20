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
});
