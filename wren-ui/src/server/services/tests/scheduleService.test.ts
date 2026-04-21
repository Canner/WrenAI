import {
  ScheduleService,
  DASHBOARD_REFRESH_TARGET_TYPE,
} from '../scheduleService';

describe('ScheduleService', () => {
  let scheduleJobRepository: any;
  let scheduleService: ScheduleService;

  beforeEach(() => {
    scheduleJobRepository = {
      findAllBy: jest.fn(),
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };

    scheduleService = new ScheduleService({
      scheduleJobRepository,
      generateId: () => 'job-new',
    });
  });

  it('creates a dashboard refresh job with runtime identity when enabled', async () => {
    const nextRunAt = new Date('2026-04-03T10:00:00.000Z');
    scheduleJobRepository.findAllBy.mockResolvedValue([]);
    scheduleJobRepository.createOne.mockResolvedValue({
      id: 'job-new',
      targetId: '7',
    });

    await scheduleService.syncDashboardRefreshJob({
      dashboardId: 7,
      enabled: true,
      cronExpr: '0 10 * * *',
      timezone: 'Asia/Shanghai',
      nextRunAt,
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      createdBy: 'user-1',
    });

    expect(scheduleJobRepository.createOne).toHaveBeenCalledWith({
      id: 'job-new',
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      targetType: DASHBOARD_REFRESH_TARGET_TYPE,
      targetId: '7',
      cronExpr: '0 10 * * *',
      timezone: 'Asia/Shanghai',
      status: 'active',
      nextRunAt,
      lastError: null,
      createdBy: 'user-1',
      lastRunAt: null,
    });
  });

  it('updates an existing dashboard refresh job when enabled', async () => {
    const nextRunAt = new Date('2026-04-03T11:00:00.000Z');
    scheduleJobRepository.findAllBy.mockResolvedValue([
      {
        id: 'job-existing',
        targetId: '8',
      },
    ]);
    scheduleJobRepository.updateOne.mockResolvedValue({
      id: 'job-existing',
    });

    await scheduleService.syncDashboardRefreshJob({
      dashboardId: 8,
      enabled: true,
      cronExpr: '0 11 * * *',
      timezone: '',
      nextRunAt,
      workspaceId: 'ws-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
    });

    expect(scheduleJobRepository.updateOne).toHaveBeenCalledWith(
      'job-existing',
      {
        workspaceId: 'ws-2',
        knowledgeBaseId: 'kb-2',
        kbSnapshotId: 'snap-2',
        deployHash: 'deploy-2',
        cronExpr: '0 11 * * *',
        timezone: 'UTC',
        status: 'active',
        nextRunAt,
        lastError: null,
      },
    );
  });

  it('deactivates an existing dashboard refresh job when disabled', async () => {
    scheduleJobRepository.findAllBy.mockResolvedValue([
      {
        id: 'job-disable',
        targetId: '9',
      },
    ]);
    scheduleJobRepository.updateOne.mockResolvedValue({
      id: 'job-disable',
      status: 'inactive',
    });

    await scheduleService.syncDashboardRefreshJob({
      dashboardId: 9,
      enabled: false,
      workspaceId: 'ws-3',
      knowledgeBaseId: 'kb-3',
      kbSnapshotId: 'snap-3',
      deployHash: 'deploy-3',
    });

    expect(scheduleJobRepository.updateOne).toHaveBeenCalledWith(
      'job-disable',
      {
        workspaceId: 'ws-3',
        knowledgeBaseId: 'kb-3',
        kbSnapshotId: 'snap-3',
        deployHash: 'deploy-3',
        status: 'inactive',
        nextRunAt: null,
        lastError: null,
      },
    );
  });

  it('rejects enabled schedules without full runtime binding', async () => {
    scheduleJobRepository.findAllBy.mockResolvedValue([]);

    await expect(
      scheduleService.syncDashboardRefreshJob({
        dashboardId: 10,
        enabled: true,
        cronExpr: '0 12 * * *',
        workspaceId: 'ws-4',
        knowledgeBaseId: 'kb-4',
        kbSnapshotId: null,
        deployHash: 'deploy-4',
      }),
    ).rejects.toThrow('snapshot runtime binding');
  });

  it('deactivates duplicate dashboard refresh jobs when syncing an existing schedule', async () => {
    const nextRunAt = new Date('2026-04-03T11:00:00.000Z');
    scheduleJobRepository.findAllBy.mockResolvedValue([
      {
        id: 'job-primary',
        targetId: '8',
      },
      {
        id: 'job-duplicate',
        targetId: '8',
      },
    ]);
    scheduleJobRepository.updateOne.mockImplementation(
      async (id: string, patch: Record<string, any>) => ({
        id,
        ...patch,
      }),
    );

    await scheduleService.syncDashboardRefreshJob({
      dashboardId: 8,
      enabled: true,
      cronExpr: '0 11 * * *',
      timezone: 'UTC',
      nextRunAt,
      workspaceId: 'ws-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
    });

    expect(scheduleJobRepository.updateOne).toHaveBeenNthCalledWith(
      1,
      'job-primary',
      {
        workspaceId: 'ws-2',
        knowledgeBaseId: 'kb-2',
        kbSnapshotId: 'snap-2',
        deployHash: 'deploy-2',
        cronExpr: '0 11 * * *',
        timezone: 'UTC',
        status: 'active',
        nextRunAt,
        lastError: null,
      },
    );
    expect(scheduleJobRepository.updateOne).toHaveBeenNthCalledWith(
      2,
      'job-duplicate',
      {
        workspaceId: 'ws-2',
        knowledgeBaseId: 'kb-2',
        kbSnapshotId: 'snap-2',
        deployHash: 'deploy-2',
        status: 'inactive',
        nextRunAt: null,
        lastError: 'Duplicate dashboard refresh job superseded by job-primary',
      },
    );
  });

  it('recovers from unique violations by updating the newly-created canonical job', async () => {
    const nextRunAt = new Date('2026-04-03T10:00:00.000Z');
    scheduleJobRepository.findAllBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'job-recovered',
          targetId: '7',
        },
      ]);
    scheduleJobRepository.createOne.mockRejectedValue({ code: '23505' });
    scheduleJobRepository.updateOne.mockResolvedValue({
      id: 'job-recovered',
      targetId: '7',
    });

    await scheduleService.syncDashboardRefreshJob({
      dashboardId: 7,
      enabled: true,
      cronExpr: '0 10 * * *',
      timezone: 'Asia/Shanghai',
      nextRunAt,
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      createdBy: 'user-1',
    });

    expect(scheduleJobRepository.updateOne).toHaveBeenCalledWith(
      'job-recovered',
      {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
        cronExpr: '0 10 * * *',
        timezone: 'Asia/Shanghai',
        status: 'active',
        nextRunAt,
        lastError: null,
      },
    );
  });
});
