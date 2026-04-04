import { DashboardResolver } from '../dashboardResolver';
import { ScheduleFrequencyEnum } from '@server/models/dashboard';

describe('DashboardResolver scope guards', () => {
  const createContext = () =>
    ({
      runtimeScope: {
        project: { id: 1 },
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1' },
        kbSnapshot: { id: 'snapshot-1' },
        deployHash: 'deploy-1',
        userId: 'user-1',
      },
      dashboardService: {
        getCurrentDashboard: jest.fn(),
        getCurrentDashboardForScope: jest.fn(),
        getDashboardItem: jest.fn(),
        createDashboardItem: jest.fn(),
        updateDashboardItem: jest.fn(),
        deleteDashboardItem: jest.fn(),
        updateDashboardItemLayouts: jest.fn(),
        setDashboardSchedule: jest.fn(),
      },
      scheduleService: {
        syncDashboardRefreshJob: jest.fn(),
      },
      queryService: {
        preview: jest.fn(),
      },
      askingService: {
        assertResponseScope: jest.fn(),
        getResponseScoped: jest.fn(),
      },
      projectService: {
        getProjectById: jest.fn(),
      },
      knowledgeBaseRepository: {
        findOneBy: jest.fn(),
      },
      deployService: {
        getDeployment: jest.fn(),
        getLastDeployment: jest.fn(),
      },
      kbSnapshotRepository: {
        findOneBy: jest.fn(),
      },
    }) as any;

  it('rejects updateDashboardItem for items outside the active dashboard', async () => {
    const resolver = new DashboardResolver();
    const ctx = createContext();
    ctx.dashboardService.getCurrentDashboardForScope.mockResolvedValue({
      id: 1,
      projectId: 1,
    });
    ctx.dashboardService.getDashboardItem.mockResolvedValue({
      id: 9,
      dashboardId: 2,
    });

    await expect(
      resolver.updateDashboardItem(
        null,
        { where: { id: 9 }, data: { displayName: 'Revenue' } },
        ctx,
      ),
    ).rejects.toThrow('Dashboard item not found. id: 9');

    expect(ctx.dashboardService.updateDashboardItem).not.toHaveBeenCalled();
  });

  it('rejects updateDashboardItemLayouts when any item is outside the active dashboard', async () => {
    const resolver = new DashboardResolver();
    const ctx = createContext();
    ctx.dashboardService.getCurrentDashboardForScope.mockResolvedValue({
      id: 1,
      projectId: 1,
    });
    ctx.dashboardService.getDashboardItem.mockImplementation(async (id: number) =>
      id === 1 ? { id, dashboardId: 1 } : { id, dashboardId: 2 },
    );

    await expect(
      resolver.updateDashboardItemLayouts(
        null,
        {
          data: {
            layouts: [
              { itemId: 1, x: 0, y: 0, w: 4, h: 4 },
              { itemId: 2, x: 4, y: 0, w: 4, h: 4 },
            ],
          },
        },
        ctx,
      ),
    ).rejects.toThrow('Dashboard item not found. id: 2');

    expect(ctx.dashboardService.updateDashboardItemLayouts).not.toHaveBeenCalled();
  });

  it('rejects previewItemSQL for items outside the active dashboard', async () => {
    const resolver = new DashboardResolver();
    const ctx = createContext();
    ctx.dashboardService.getCurrentDashboardForScope.mockResolvedValue({
      id: 1,
      projectId: 1,
      cacheEnabled: true,
    });
    ctx.dashboardService.getDashboardItem.mockResolvedValue({
      id: 5,
      dashboardId: 7,
      detail: { sql: 'select 1' },
    });

    await expect(
      resolver.previewItemSQL(
        null,
        { data: { itemId: 5, limit: 10, refresh: false } },
        ctx,
      ),
    ).rejects.toThrow('Dashboard item not found. id: 5');

    expect(ctx.queryService.preview).not.toHaveBeenCalled();
  });

  it('syncs dashboard refresh schedule jobs with runtime identity after updating dashboard schedule', async () => {
    const resolver = new DashboardResolver();
    const ctx = createContext();
    const nextScheduledAt = new Date('2026-04-03T09:00:00.000Z');
    ctx.dashboardService.getCurrentDashboardForScope.mockResolvedValue({
      id: 3,
      projectId: 1,
    });
    ctx.dashboardService.setDashboardSchedule.mockResolvedValue({
      id: 3,
      projectId: 1,
      cacheEnabled: true,
      scheduleCron: '0 9 * * *',
      scheduleTimezone: 'Asia/Shanghai',
      nextScheduledAt,
    });

    await resolver.setDashboardSchedule(
      null,
      {
        data: {
          cacheEnabled: true,
          schedule: {
            frequency: ScheduleFrequencyEnum.DAILY,
            hour: 9,
            minute: 0,
            day: null,
            timezone: 'Asia/Shanghai',
            cron: '',
          },
        },
      },
      ctx,
    );

    expect(ctx.scheduleService.syncDashboardRefreshJob).toHaveBeenCalledWith({
      dashboardId: 3,
      enabled: true,
      cronExpr: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      nextRunAt: nextScheduledAt,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      createdBy: 'user-1',
    });
  });

  it('syncs schedule jobs from dashboard binding when it differs from request scope', async () => {
    const resolver = new DashboardResolver();
    const ctx = createContext();
    const nextScheduledAt = new Date('2026-04-03T10:00:00.000Z');
    ctx.dashboardService.getCurrentDashboardForScope.mockResolvedValue({
      id: 5,
      projectId: 1,
    });
    ctx.dashboardService.setDashboardSchedule.mockResolvedValue({
      id: 5,
      projectId: 1,
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snapshot-2',
      deployHash: 'deploy-2',
      cacheEnabled: true,
      scheduleCron: '0 10 * * *',
      scheduleTimezone: 'UTC',
      nextScheduledAt,
    });
    ctx.knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-2',
      workspaceId: 'workspace-2',
    });

    await resolver.setDashboardSchedule(
      null,
      {
        data: {
          cacheEnabled: true,
          schedule: {
            frequency: ScheduleFrequencyEnum.DAILY,
            hour: 10,
            minute: 0,
            day: null,
            timezone: 'UTC',
            cron: '',
          },
        },
      },
      ctx,
    );

    expect(ctx.scheduleService.syncDashboardRefreshJob).toHaveBeenCalledWith({
      dashboardId: 5,
      enabled: true,
      cronExpr: '0 10 * * *',
      timezone: 'UTC',
      nextRunAt: nextScheduledAt,
      workspaceId: 'workspace-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snapshot-2',
      deployHash: 'deploy-2',
      createdBy: 'user-1',
    });
  });

  it('uses dashboard runtime binding instead of dashboard.projectId when creating dashboard items', async () => {
    const resolver = new DashboardResolver();
    const ctx = createContext();
    ctx.dashboardService.getCurrentDashboardForScope.mockResolvedValue({
      id: 7,
      projectId: 999,
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-bound',
    });
    ctx.askingService.getResponseScoped.mockResolvedValue({
      id: 12,
      projectId: null,
      deployHash: null,
      sql: 'select 1',
      chartDetail: {
        chartSchema: { mark: 'bar' },
      },
    });
    ctx.kbSnapshotRepository.findOneBy.mockResolvedValue({
      id: 'snapshot-1',
      legacyProjectId: 42,
      deployHash: 'deploy-from-snapshot',
    });
    ctx.projectService.getProjectById.mockResolvedValue({ id: 42, type: 'view' });
    ctx.deployService.getDeployment.mockResolvedValue({
      manifest: 'manifest-42',
    });
    ctx.dashboardService.createDashboardItem.mockResolvedValue({
      id: 88,
      dashboardId: 7,
      type: 'bar',
    });

    await resolver.createDashboardItem(
      null,
      { data: { responseId: 12, itemType: 'BAR' as any } },
      ctx,
    );

    expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(42);
    expect(ctx.deployService.getDeployment).toHaveBeenCalledWith(
      42,
      'deploy-bound',
    );
    expect(ctx.queryService.preview).toHaveBeenCalledWith('select 1', {
      project: { id: 42, type: 'view' },
      manifest: 'manifest-42',
      limit: 500,
      cacheEnabled: true,
      refresh: true,
    });
  });

  it('uses dashboard runtime binding instead of current project when previewing dashboard SQL', async () => {
    const resolver = new DashboardResolver();
    const ctx = createContext();
    ctx.dashboardService.getCurrentDashboardForScope.mockResolvedValue({
      id: 4,
      projectId: 999,
      kbSnapshotId: 'snapshot-2',
      deployHash: 'deploy-77',
      cacheEnabled: true,
    });
    ctx.dashboardService.getDashboardItem.mockResolvedValue({
      id: 3,
      dashboardId: 4,
      detail: { sql: 'select revenue from sales' },
    });
    ctx.kbSnapshotRepository.findOneBy.mockResolvedValue({
      id: 'snapshot-2',
      legacyProjectId: 77,
      deployHash: 'deploy-from-snapshot',
    });
    ctx.projectService.getProjectById.mockResolvedValue({ id: 77, type: 'view' });
    ctx.deployService.getDeployment.mockResolvedValue({
      manifest: 'manifest-77',
    });
    ctx.queryService.preview.mockResolvedValue({
      columns: [{ name: 'revenue' }],
      data: [[123]],
      cacheHit: false,
      cacheCreatedAt: null,
      cacheOverrodeAt: null,
      override: false,
    });

    const result = await resolver.previewItemSQL(
      null,
      { data: { itemId: 3, limit: 10, refresh: false } },
      ctx,
    );

    expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(77);
    expect(ctx.deployService.getDeployment).toHaveBeenCalledWith(
      77,
      'deploy-77',
    );
    expect(result.data).toEqual([{ revenue: 123 }]);
  });
});
