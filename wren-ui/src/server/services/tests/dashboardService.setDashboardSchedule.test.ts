import {
  CacheScheduleDayEnum,
  ScheduleFrequencyEnum,
} from '@server/models/dashboard';
import {
  createDashboardServiceHarness,
  createScheduleData,
  TestDashboardService,
} from './dashboardService.testSupport';

describe('DashboardService', () => {
  let dashboardService: TestDashboardService;
  let mockDashboardRepository: any;

  beforeEach(() => {
    ({ dashboardService, mockDashboardRepository } =
      createDashboardServiceHarness());
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
