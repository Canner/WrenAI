import { DashboardCacheBackgroundTracker } from '../dashboardCacheBackgroundTracker';
import { DashboardCacheRefreshStatus } from '@server/repositories';

describe('DashboardCacheBackgroundTracker', () => {
  const dashboard = {
    id: 1,
    projectId: 42,
    kbSnapshotId: 'snapshot-1',
    deployHash: 'deploy-42',
    cacheEnabled: true,
    scheduleCron: '0 * * * *',
    nextScheduledAt: new Date('2026-04-02T00:00:00Z'),
  };

  let dashboardRepository: any;
  let dashboardItemRepository: any;
  let dashboardItemRefreshJobRepository: any;
  let kbSnapshotRepository: any;
  let projectService: any;
  let deployService: any;
  let queryService: any;
  let tracker: DashboardCacheBackgroundTracker;
  let setIntervalSpy: jest.SpyInstance;

  beforeEach(() => {
    setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation((() => 1) as any);

    dashboardRepository = {
      findOneBy: jest.fn().mockResolvedValue(dashboard),
      findAllBy: jest.fn(),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    dashboardItemRepository = {
      findAllBy: jest.fn().mockResolvedValue([
        {
          id: 9,
          dashboardId: 1,
          detail: { sql: 'SELECT * FROM orders' },
        },
      ]),
    };
    dashboardItemRefreshJobRepository = {
      createOne: jest.fn().mockResolvedValue({ id: 'job-1' }),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    kbSnapshotRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'snapshot-1',
        projectBridgeId: 42,
        deployHash: 'deploy-42',
      }),
    };
    projectService = {
      getProjectById: jest.fn().mockResolvedValue({ id: 42, type: 'view' }),
    };
    deployService = {
      getDeploymentByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ projectId: 42, manifest: 'mock-mdl' }),
    };
    queryService = {
      preview: jest.fn().mockResolvedValue({}),
    };

    tracker = new DashboardCacheBackgroundTracker({
      dashboardRepository,
      dashboardItemRepository,
      dashboardItemRefreshJobRepository,
      kbSnapshotRepository,
      projectService,
      deployService,
      queryService,
    });
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
  });

  it('refreshes cache using the dashboard-bound project and deployment', async () => {
    await (tracker as any).refreshDashboardCache(dashboard);

    expect(projectService.getProjectById).toHaveBeenCalledWith(42);
    expect(kbSnapshotRepository.findOneBy).toHaveBeenCalledWith({
      id: 'snapshot-1',
    });
    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-42',
    });
    expect(queryService.preview).toHaveBeenCalledWith('SELECT * FROM orders', {
      project: { id: 42, type: 'view' },
      manifest: 'mock-mdl',
      cacheEnabled: true,
      refresh: true,
    });
    expect(dashboardItemRefreshJobRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardId: 1,
        dashboardItemId: 9,
        status: DashboardCacheRefreshStatus.IN_PROGRESS,
      }),
    );
    expect(dashboardItemRefreshJobRepository.updateOne).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        status: DashboardCacheRefreshStatus.SUCCESS,
      }),
    );
    expect(dashboardRepository.updateOne).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        nextScheduledAt: expect.any(Date),
      }),
    );
  });

  it('refreshes a dashboard by id for schedule worker executors', async () => {
    const refreshedItems = await tracker.refreshDashboardById(1);

    expect(dashboardRepository.findOneBy).toHaveBeenCalledWith({ id: 1 });
    expect(refreshedItems).toBe(1);
    expect(queryService.preview).toHaveBeenCalledWith('SELECT * FROM orders', {
      project: { id: 42, type: 'view' },
      manifest: 'mock-mdl',
      cacheEnabled: true,
      refresh: true,
    });
  });

  it('uses item runtime identity when refreshing workspace dashboards', async () => {
    dashboardRepository.findOneBy.mockResolvedValue({
      id: 2,
      projectId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      cacheEnabled: true,
      scheduleCron: '0 * * * *',
      nextScheduledAt: new Date('2026-04-02T00:00:00Z'),
    });
    dashboardItemRepository.findAllBy.mockResolvedValue([
      {
        id: 10,
        dashboardId: 2,
        detail: {
          sql: 'SELECT gross_margin FROM metrics',
          runtimeIdentity: {
            workspaceId: 'workspace-2',
            knowledgeBaseId: 'kb-2',
            kbSnapshotId: 'snapshot-2',
            deployHash: 'deploy-2',
            projectId: null,
          },
        },
      },
    ]);
    deployService.getDeploymentByRuntimeIdentity.mockResolvedValue({
      projectId: 88,
      manifest: 'item-mdl',
    });
    projectService.getProjectById.mockResolvedValue({
      id: 88,
      type: 'view',
    });

    const refreshedItems = await tracker.refreshDashboardById(2);

    expect(refreshedItems).toBe(1);
    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snapshot-2',
      deployHash: 'deploy-2',
    });
    expect(queryService.preview).toHaveBeenCalledWith(
      'SELECT gross_margin FROM metrics',
      {
        project: { id: 88, type: 'view' },
        manifest: 'item-mdl',
        cacheEnabled: true,
        refresh: true,
      },
    );
  });

  it('only refreshes dashboards whose schedule is due', async () => {
    dashboardRepository.findAllBy.mockResolvedValue([
      {
        ...dashboard,
        id: 1,
        nextScheduledAt: new Date(Date.now() - 60_000),
      },
      {
        ...dashboard,
        id: 2,
        projectId: 99,
        nextScheduledAt: new Date(Date.now() + 60_000),
      },
    ]);

    const refreshSpy = jest.spyOn(tracker as any, 'refreshDashboardCache');

    await (tracker as any).checkAndRefreshCaches();

    expect(dashboardRepository.findAllBy).toHaveBeenCalledWith({
      cacheEnabled: true,
    });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        projectId: 42,
      }),
    );
  });
});
