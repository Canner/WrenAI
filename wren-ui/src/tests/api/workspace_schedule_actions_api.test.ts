export {};

const mockResolveRequestScope = jest.fn();
const mockFindScheduleJob = jest.fn();
const mockFindScheduleRuns = jest.fn();
const mockFindDashboard = jest.fn();
const mockSetDashboardSchedule = jest.fn();
const mockSyncDashboardRefreshJob = jest.fn();
const mockRunJobNow = jest.fn();
const mockFindKbSnapshot = jest.fn();
const mockFindKnowledgeBase = jest.fn();
const mockValidateSession = jest.fn();
const mockGetSessionTokenFromRequest = jest.fn();
const mockCreateAuditEvent = jest.fn();

jest.mock('@/common', () => ({
  components: {
    authService: { validateSession: mockValidateSession },
    runtimeScopeResolver: { resolveRequestScope: mockResolveRequestScope },
    scheduleJobRepository: { findOneBy: mockFindScheduleJob },
    scheduleJobRunRepository: { findAllBy: mockFindScheduleRuns },
    dashboardRepository: { findOneBy: mockFindDashboard },
    dashboardService: { setDashboardSchedule: mockSetDashboardSchedule },
    scheduleService: { syncDashboardRefreshJob: mockSyncDashboardRefreshJob },
    scheduleWorker: { runJobNow: mockRunJobNow },
    kbSnapshotRepository: { findOneBy: mockFindKbSnapshot },
    knowledgeBaseRepository: { findOneBy: mockFindKnowledgeBase },
    auditEventRepository: { createOne: mockCreateAuditEvent },
  },
}));

jest.mock('@server/context/actorClaims', () => ({
  getSessionTokenFromRequest: (...args: any[]) =>
    mockGetSessionTokenFromRequest(...args),
}));

describe('workspace schedule action routes', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      body: {},
      query: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => {
    const res: any = {
      statusCode: 200,
      body: undefined,
      setHeader: jest.fn(),
      status: jest.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      json: jest.fn((payload: any) => {
        res.body = payload;
        return res;
      }),
    };
    return res;
  };

  const runtimeScope = {
    workspace: { id: 'ws-1', name: 'Workspace Alpha' },
    knowledgeBase: { id: 'kb-1', name: 'Sales Insight', workspaceId: 'ws-1' },
    kbSnapshot: {
      id: 'snap-1',
      knowledgeBaseId: 'kb-1',
      deployHash: 'deploy-1',
      projectBridgeId: 21,
    },
    deployHash: 'deploy-1',
    userId: 'user-1',
    actorClaims: {
      workspaceId: 'ws-1',
      workspaceMemberId: 'member-1',
      roleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
    },
    project: null,
    deployment: null,
  };

  const scheduleJob = {
    id: 'job-1',
    workspaceId: 'ws-1',
    knowledgeBaseId: 'kb-1',
    kbSnapshotId: 'snap-1',
    deployHash: 'deploy-1',
    targetType: 'dashboard_refresh',
    targetId: '11',
    cronExpr: '0 * * * *',
    timezone: 'UTC',
    status: 'active',
    nextRunAt: '2026-04-08T10:00:00.000Z',
    lastRunAt: '2026-04-08T09:00:00.000Z',
    lastError: null,
  };

  const workspaceScopedScheduleJob = {
    ...scheduleJob,
    knowledgeBaseId: null,
    kbSnapshotId: null,
    deployHash: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSessionTokenFromRequest.mockReturnValue('session-token');
    mockValidateSession.mockResolvedValue({
      session: { id: 'session-1' },
      user: { id: 'user-1', email: 'owner@example.com' },
      workspace: { id: 'ws-1', name: 'Workspace Alpha' },
      membership: { id: 'member-1', roleKey: 'owner' },
      actorClaims: {
        workspaceId: 'ws-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
      },
    });
    mockResolveRequestScope.mockResolvedValue(runtimeScope);
    mockFindScheduleJob.mockResolvedValue(scheduleJob);
    mockFindKbSnapshot.mockResolvedValue(runtimeScope.kbSnapshot);
    mockFindKnowledgeBase.mockResolvedValue(runtimeScope.knowledgeBase);
  });

  it('disables a dashboard refresh schedule by switching it to manual refresh', async () => {
    const handler = (
      await import('../../pages/api/v1/workspace/schedules/[id]')
    ).default;
    const req = createReq({
      method: 'PATCH',
      query: { id: 'job-1' },
      body: { action: 'disable' },
    });
    const res = createRes();

    mockFindDashboard.mockResolvedValue({
      id: 11,
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      createdBy: 'user-1',
      scheduleTimezone: 'UTC',
    });
    mockSetDashboardSchedule.mockResolvedValue({
      id: 11,
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      createdBy: 'user-1',
      cacheEnabled: true,
      scheduleFrequency: 'NEVER',
      scheduleTimezone: 'UTC',
      scheduleCron: null,
      nextScheduledAt: null,
    });
    mockSyncDashboardRefreshJob.mockResolvedValue({
      ...scheduleJob,
      status: 'inactive',
      nextRunAt: null,
    });

    await handler(req, res);

    expect(mockSetDashboardSchedule).toHaveBeenCalledWith(11, {
      cacheEnabled: true,
      schedule: {
        frequency: 'NEVER',
        day: null,
        hour: 0,
        minute: 0,
        cron: null,
        timezone: 'UTC',
      },
    });
    expect(mockSyncDashboardRefreshJob).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardId: 11,
        enabled: false,
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.job.status).toBe('inactive');
    expect(res.body.dashboard.scheduleFrequency).toBe('NEVER');
  });

  it('updates a dashboard refresh schedule with a new cron plan', async () => {
    const handler = (
      await import('../../pages/api/v1/workspace/schedules/[id]')
    ).default;
    const req = createReq({
      method: 'PATCH',
      query: { id: 'job-1' },
      body: {
        action: 'update',
        data: {
          cacheEnabled: true,
          schedule: {
            frequency: 'DAILY',
            day: null,
            hour: 9,
            minute: 30,
            cron: null,
            timezone: 'Asia/Shanghai',
          },
        },
      },
    });
    const res = createRes();

    mockFindDashboard.mockResolvedValue({
      id: 11,
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      createdBy: 'user-1',
      scheduleTimezone: 'UTC',
    });
    mockSetDashboardSchedule.mockResolvedValue({
      id: 11,
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
      createdBy: 'user-1',
      cacheEnabled: true,
      scheduleFrequency: 'DAILY',
      scheduleTimezone: 'Asia/Shanghai',
      scheduleCron: '30 9 * * *',
      nextScheduledAt: '2026-04-09T01:30:00.000Z',
    });
    mockSyncDashboardRefreshJob.mockResolvedValue({
      ...scheduleJob,
      status: 'active',
      cronExpr: '30 9 * * *',
      timezone: 'Asia/Shanghai',
      nextRunAt: '2026-04-09T01:30:00.000Z',
    });

    await handler(req, res);

    expect(mockSetDashboardSchedule).toHaveBeenCalledWith(11, {
      cacheEnabled: true,
      schedule: {
        frequency: 'DAILY',
        day: null,
        hour: 9,
        minute: 30,
        cron: null,
        timezone: 'Asia/Shanghai',
      },
    });
    expect(mockSyncDashboardRefreshJob).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardId: 11,
        enabled: true,
        cronExpr: '30 9 * * *',
        timezone: 'Asia/Shanghai',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.job.status).toBe('active');
    expect(res.body.dashboard.scheduleCron).toBe('30 9 * * *');
  });

  it('allows updating a workspace-scoped dashboard refresh job even when a knowledge base is active in runtime scope', async () => {
    const handler = (
      await import('../../pages/api/v1/workspace/schedules/[id]')
    ).default;
    const req = createReq({
      method: 'PATCH',
      query: { id: 'job-1' },
      body: { action: 'disable' },
    });
    const res = createRes();

    mockFindScheduleJob.mockResolvedValue(workspaceScopedScheduleJob);
    mockFindDashboard.mockResolvedValue({
      id: 11,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      createdBy: 'user-1',
      scheduleTimezone: 'UTC',
    });
    mockSetDashboardSchedule.mockResolvedValue({
      id: 11,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      createdBy: 'user-1',
      cacheEnabled: true,
      scheduleFrequency: 'NEVER',
      scheduleTimezone: 'UTC',
      scheduleCron: null,
      nextScheduledAt: null,
    });
    mockSyncDashboardRefreshJob.mockResolvedValue({
      ...workspaceScopedScheduleJob,
      status: 'inactive',
      nextRunAt: null,
    });

    await handler(req, res);

    expect(mockSyncDashboardRefreshJob).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardId: 11,
        enabled: false,
        workspaceId: 'ws-1',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.job.knowledgeBaseId).toBeNull();
  });

  it('runs a schedule job immediately and returns the latest run state', async () => {
    const handler = (
      await import('../../pages/api/v1/workspace/schedules/[id]/run')
    ).default;
    const req = createReq({
      method: 'POST',
      query: { id: 'job-1' },
    });
    const res = createRes();

    mockRunJobNow.mockResolvedValue(undefined);
    mockFindScheduleJob
      .mockResolvedValueOnce(scheduleJob)
      .mockResolvedValueOnce({
        ...scheduleJob,
        lastRunAt: '2026-04-08T10:01:00.000Z',
      });
    mockFindScheduleRuns.mockResolvedValue([
      {
        id: 'run-1',
        scheduleJobId: 'job-1',
        status: 'succeeded',
        startedAt: '2026-04-08T10:00:00.000Z',
        finishedAt: '2026-04-08T10:01:00.000Z',
        traceId: 'trace-1',
        detailJson: {
          refreshedItems: 2,
        },
      },
    ]);

    await handler(req, res);

    expect(mockRunJobNow).toHaveBeenCalledWith(scheduleJob);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.lastRun).toEqual(
      expect.objectContaining({
        id: 'run-1',
        status: 'succeeded',
        traceId: 'trace-1',
      }),
    );
  });

  it('returns 500 when immediate execution finishes with a failed run', async () => {
    const handler = (
      await import('../../pages/api/v1/workspace/schedules/[id]/run')
    ).default;
    const req = createReq({
      method: 'POST',
      query: { id: 'job-1' },
    });
    const res = createRes();

    mockRunJobNow.mockResolvedValue(undefined);
    mockFindScheduleJob
      .mockResolvedValueOnce(scheduleJob)
      .mockResolvedValueOnce({
        ...scheduleJob,
        lastRunAt: '2026-04-08T10:01:00.000Z',
        lastError: 'refresh failed',
      });
    mockFindScheduleRuns.mockResolvedValue([
      {
        id: 'run-1',
        scheduleJobId: 'job-1',
        status: 'failed',
        startedAt: '2026-04-08T10:00:00.000Z',
        finishedAt: '2026-04-08T10:01:00.000Z',
        errorMessage: 'refresh failed',
        detailJson: null,
      },
    ]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body.error).toBe('refresh failed');
    expect(res.body.lastRun.status).toBe('failed');
  });

  it('allows running a workspace-scoped dashboard refresh job from a knowledge-base runtime page', async () => {
    const handler = (
      await import('../../pages/api/v1/workspace/schedules/[id]/run')
    ).default;
    const req = createReq({
      method: 'POST',
      query: { id: 'job-1' },
    });
    const res = createRes();

    mockFindScheduleJob
      .mockResolvedValueOnce(workspaceScopedScheduleJob)
      .mockResolvedValueOnce({
        ...workspaceScopedScheduleJob,
        lastRunAt: '2026-04-08T10:01:00.000Z',
      });
    mockFindScheduleRuns.mockResolvedValue([
      {
        id: 'run-1',
        scheduleJobId: 'job-1',
        status: 'succeeded',
        startedAt: '2026-04-08T10:00:00.000Z',
        finishedAt: '2026-04-08T10:01:00.000Z',
        traceId: 'trace-1',
        detailJson: {
          refreshedItems: 2,
        },
      },
    ]);

    await handler(req, res);

    expect(mockRunJobNow).toHaveBeenCalledWith(workspaceScopedScheduleJob);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.job.knowledgeBaseId).toBeNull();
  });
});
