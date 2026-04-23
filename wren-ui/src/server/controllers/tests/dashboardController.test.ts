import { DashboardController } from '../dashboardController';
import {
  CacheScheduleDayEnum,
  ScheduleFrequencyEnum,
} from '@server/models/dashboard';

describe('DashboardController scope guards', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

  afterEach(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const createContext = () =>
    ({
      runtimeScope: {
        selector: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        },
        project: { id: 1 },
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
        kbSnapshot: { id: 'snapshot-1' },
        deployHash: 'deploy-1',
        userId: 'user-1',
      },
      authorizationActor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        workspaceRoleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
        isPlatformAdmin: false,
        platformRoleKeys: [],
      },
      auditEventRepository: {
        createOne: jest.fn(),
      },
      dashboardService: {
        listDashboardsForScope: jest.fn(),
        getCurrentDashboard: jest.fn(),
        getCurrentDashboardForScope: jest.fn(),
        getDashboardForScope: jest.fn(),
        getDashboardItems: jest.fn(),
        parseCronExpression: jest.fn(),
        createDashboardForScope: jest.fn(),
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
        getDeploymentByRuntimeIdentity: jest.fn(),
        getLastDeployment: jest.fn(),
      },
      kbSnapshotRepository: {
        findOneBy: jest.fn(),
      },
    }) as any;

  it('lists dashboards with runtime binding after knowledge base read authorization and records access audit', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.dashboardService.listDashboardsForScope.mockResolvedValue([
      { id: 1, projectId: null },
    ]);

    const result = await resolver.getDashboards(null, null, ctx);

    expect(ctx.dashboardService.listDashboardsForScope).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
      }),
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'knowledge_base',
        resourceId: 'kb-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_dashboards',
        },
      }),
    );
    expect(result).toEqual([{ id: 1, projectId: null }]);
  });

  it('lists dashboards with workspace binding when the request selector is workspace-only', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.runtimeScope.selector = {
      workspaceId: 'workspace-1',
    };
    ctx.dashboardService.listDashboardsForScope.mockResolvedValue([
      { id: 11, projectId: null },
    ]);

    const result = await resolver.getDashboards(null, null, ctx);

    expect(ctx.dashboardService.listDashboardsForScope).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: 'user-1',
      }),
    );
    expect(result).toEqual([{ id: 11, projectId: null }]);
  });

  it('rejects dashboard reads without knowledge base read permission', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      workspaceRoleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(resolver.getDashboards(null, null, ctx)).rejects.toThrow(
      'Knowledge base read permission required',
    );

    expect(ctx.dashboardService.listDashboardsForScope).not.toHaveBeenCalled();
  });

  it('rejects updateDashboardItem for items outside the active dashboard', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.dashboardService.getDashboardItem.mockResolvedValue({
      id: 9,
      dashboardId: 2,
    });
    ctx.dashboardService.getDashboardForScope.mockResolvedValue(null);

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
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.dashboardService.getDashboardItem.mockImplementation(
      async (id: number) =>
        id === 1 ? { id, dashboardId: 1 } : { id, dashboardId: 2 },
    );
    ctx.dashboardService.getDashboardForScope.mockImplementation(
      async (dashboardId: number) =>
        dashboardId === 1 ? { id: 1, projectId: 1 } : null,
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

    expect(
      ctx.dashboardService.updateDashboardItemLayouts,
    ).not.toHaveBeenCalled();
  });

  it('rejects previewItemSQL for items outside the active dashboard', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.dashboardService.getDashboardItem.mockResolvedValue({
      id: 5,
      dashboardId: 7,
      detail: { sql: 'select 1' },
    });
    ctx.dashboardService.getDashboardForScope.mockResolvedValue(null);

    await expect(
      resolver.previewItemSQL(
        null,
        { data: { itemId: 5, limit: 10, refresh: false } },
        ctx,
      ),
    ).rejects.toThrow('Dashboard item not found. id: 5');

    expect(ctx.queryService.preview).not.toHaveBeenCalled();
  });

  it('rejects previewItemSQL on outdated snapshots', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.runtimeScope.kbSnapshot = { id: 'snapshot-old' };
    ctx.runtimeScope.deployHash = 'deploy-old';
    ctx.runtimeScope.selector = {
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-old',
      deployHash: 'deploy-old',
    };
    ctx.dashboardService.getDashboardItem.mockResolvedValue({
      id: 5,
      dashboardId: 1,
      detail: { sql: 'select 1' },
    });
    ctx.dashboardService.getDashboardForScope.mockResolvedValue({
      id: 1,
      projectId: 1,
      cacheEnabled: true,
    });

    await expect(
      resolver.previewItemSQL(
        null,
        { data: { itemId: 5, limit: 10, refresh: false } },
        ctx,
      ),
    ).rejects.toThrow('This snapshot is outdated and cannot be executed');

    expect(ctx.queryService.preview).not.toHaveBeenCalled();
  });

  it('rejects createDashboard on outdated snapshots', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.runtimeScope.kbSnapshot = { id: 'snapshot-old' };
    ctx.runtimeScope.deployHash = 'deploy-old';
    ctx.runtimeScope.selector = {
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-old',
      deployHash: 'deploy-old',
    };

    await expect(
      resolver.createDashboard(null, { data: { name: '经营总览' } }, ctx),
    ).rejects.toThrow('This snapshot is outdated and cannot be executed');

    expect(ctx.dashboardService.createDashboardForScope).not.toHaveBeenCalled();
  });

  it('creates workspace dashboards without requiring executable snapshot binding', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.runtimeScope.selector = {
      workspaceId: 'workspace-1',
    };
    ctx.runtimeScope.project = null;
    ctx.runtimeScope.knowledgeBase = null;
    ctx.runtimeScope.kbSnapshot = null;
    ctx.runtimeScope.deployHash = null;
    ctx.dashboardService.createDashboardForScope.mockResolvedValue({
      id: 99,
      name: '经营总览',
      projectId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
    });

    const result = await resolver.createDashboard(
      null,
      { data: { name: '经营总览' } },
      ctx,
    );

    expect(ctx.dashboardService.createDashboardForScope).toHaveBeenCalledWith(
      { name: '经营总览' },
      null,
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: 'user-1',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 99,
        name: '经营总览',
      }),
    );
  });

  it('loads dashboard detail with workspace binding when the request selector is workspace-only', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.runtimeScope.selector = {
      workspaceId: 'workspace-1',
    };
    ctx.dashboardService.getDashboardForScope.mockResolvedValue({
      id: 41,
      projectId: null,
      name: '经营总览',
      nextScheduledAt: null,
    });
    ctx.dashboardService.getDashboardItems.mockResolvedValue([]);
    ctx.dashboardService.parseCronExpression.mockReturnValue(null);

    const result = await resolver.getDashboard(
      null,
      { where: { id: 41 } },
      ctx,
    );

    expect(ctx.dashboardService.getDashboardForScope).toHaveBeenCalledWith(
      41,
      null,
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: 'user-1',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 41,
        name: '经营总览',
      }),
    );
  });

  it('rejects setDashboardSchedule on outdated snapshots', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.runtimeScope.kbSnapshot = { id: 'snapshot-old' };
    ctx.runtimeScope.deployHash = 'deploy-old';

    await expect(
      resolver.setDashboardSchedule(
        null,
        {
          data: {
            cacheEnabled: true,
            schedule: {
              frequency: ScheduleFrequencyEnum.DAILY,
              hour: 9,
              minute: 0,
              day: CacheScheduleDayEnum.MON,
              timezone: 'Asia/Shanghai',
              cron: '',
            },
          },
        },
        ctx,
      ),
    ).rejects.toThrow('This snapshot is outdated and cannot be executed');

    expect(ctx.dashboardService.setDashboardSchedule).not.toHaveBeenCalled();
  });

  it('syncs workspace-scoped schedule jobs for unbound dashboards after updating dashboard schedule', async () => {
    const resolver = new DashboardController();
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
            day: CacheScheduleDayEnum.MON,
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
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      createdBy: 'user-1',
    });
  });

  it('syncs schedule jobs from dashboard binding when it differs from request scope', async () => {
    const resolver = new DashboardController();
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
            day: CacheScheduleDayEnum.MON,
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

  it('uses dashboard runtime binding and explicit dashboardId when creating dashboard items', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.dashboardService.getDashboardForScope.mockResolvedValue({
      id: 7,
      projectId: 999,
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-bound',
    });
    ctx.askingService.getResponseScoped.mockResolvedValue({
      id: 12,
      threadId: 34,
      question: '各供应商单产品成本趋势',
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-bound',
      sql: 'select 1',
      chartDetail: {
        chartSchema: { mark: 'bar' },
        renderHints: { preferredRenderer: 'svg' },
        canonicalizationVersion: 'chart-canonical-v1',
        validationErrors: ['fallback warning'],
      },
    });
    ctx.kbSnapshotRepository.findOneBy.mockResolvedValue({
      id: 'snapshot-1',
      projectBridgeId: 42,
      deployHash: 'deploy-from-snapshot',
    });
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 42,
      type: 'view',
    });
    ctx.deployService.getDeploymentByRuntimeIdentity.mockResolvedValue({
      projectId: 42,
      manifest: 'manifest-42',
    });
    ctx.dashboardService.createDashboardItem.mockResolvedValue({
      id: 88,
      dashboardId: 7,
      type: 'bar',
    });

    await resolver.createDashboardItem(
      null,
      { data: { responseId: 12, itemType: 'BAR' as any, dashboardId: 7 } },
      ctx,
    );

    expect(ctx.dashboardService.getDashboardForScope).toHaveBeenCalledWith(
      7,
      null,
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        createdBy: 'user-1',
      }),
    );

    expect(ctx.projectService.getProjectById).toHaveBeenCalledWith(42);
    expect(
      ctx.deployService.getDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-bound',
    });
    expect(ctx.queryService.preview).toHaveBeenCalledWith('select 1', {
      project: { id: 42, type: 'view' },
      manifest: 'manifest-42',
      limit: 500,
      cacheEnabled: true,
      refresh: true,
    });
    expect(ctx.dashboardService.createDashboardItem).toHaveBeenCalledWith({
      dashboardId: 7,
      type: 'BAR',
      sql: 'select 1',
      chartSchema: { mark: 'bar' },
      renderHints: { preferredRenderer: 'svg' },
      canonicalizationVersion: 'chart-canonical-v1',
      chartDataProfile: undefined,
      validationErrors: ['fallback warning'],
      sourceRuntimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-bound',
      },
      sourceResponseId: 12,
      sourceThreadId: 34,
      sourceQuestion: '各供应商单产品成本趋势',
    });
  });

  it('resolves the current dashboard from runtime binding even when the current project bridge is null', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.runtimeScope.project = { id: null };
    ctx.dashboardService.getCurrentDashboardForScope.mockResolvedValue({
      id: 17,
      projectId: 999,
      knowledgeBaseId: 'kb-1',
    });
    ctx.dashboardService.getDashboardItems = jest.fn().mockResolvedValue([]);
    ctx.dashboardService.parseCronExpression = jest.fn().mockReturnValue(null);

    await resolver.getDashboard(null, null, ctx);

    expect(
      ctx.dashboardService.getCurrentDashboardForScope,
    ).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        createdBy: 'user-1',
      }),
    );
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'dashboard',
        resourceId: '17',
        result: 'allowed',
        payloadJson: {
          operation: 'get_dashboard',
        },
      }),
    );
  });

  it('uses dashboard runtime binding instead of current project when previewing dashboard SQL', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.dashboardService.getDashboardForScope.mockResolvedValue({
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
      projectBridgeId: 77,
      deployHash: 'deploy-from-snapshot',
    });
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 77,
      type: 'view',
    });
    ctx.deployService.getDeploymentByRuntimeIdentity.mockResolvedValue({
      projectId: 77,
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
    expect(
      ctx.deployService.getDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-2',
      deployHash: 'deploy-77',
    });
    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'dashboard_item',
        resourceId: '3',
        result: 'allowed',
        payloadJson: {
          operation: 'preview_item_sql',
        },
      }),
    );
    expect(result.data).toEqual([{ revenue: 123 }]);
  });

  it('prefers item runtime identity when previewing workspace dashboard SQL', async () => {
    const resolver = new DashboardController();
    const ctx = createContext();
    ctx.runtimeScope.project = null;
    ctx.runtimeScope.knowledgeBase = null;
    ctx.runtimeScope.kbSnapshot = null;
    ctx.runtimeScope.deployHash = null;
    ctx.runtimeScope.selector = {
      workspaceId: 'workspace-1',
    };
    ctx.dashboardService.getDashboardItem.mockResolvedValue({
      id: 18,
      dashboardId: 4,
      detail: {
        sql: 'select gm from revenue',
        runtimeIdentity: {
          projectId: null,
          workspaceId: 'workspace-2',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snapshot-2',
          deployHash: 'deploy-2',
        },
      },
    });
    ctx.dashboardService.getDashboardForScope.mockResolvedValue({
      id: 4,
      projectId: null,
      cacheEnabled: true,
    });
    ctx.deployService.getDeploymentByRuntimeIdentity.mockResolvedValue({
      projectId: 77,
      manifest: 'manifest-77',
    });
    ctx.projectService.getProjectById.mockResolvedValue({
      id: 77,
      type: 'view',
    });
    ctx.queryService.preview.mockResolvedValue({
      columns: [{ name: 'gm' }],
      data: [[321]],
      cacheHit: false,
      cacheCreatedAt: null,
      cacheOverrodeAt: null,
      override: false,
    });

    const result = await resolver.previewItemSQL(
      null,
      { data: { itemId: 18, limit: 10, refresh: false } },
      ctx,
    );

    expect(
      ctx.deployService.getDeploymentByRuntimeIdentity,
    ).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snapshot-2',
      deployHash: 'deploy-2',
    });
    expect(result.data).toEqual([{ gm: 321 }]);
  });
});
