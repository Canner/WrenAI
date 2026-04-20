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
});
