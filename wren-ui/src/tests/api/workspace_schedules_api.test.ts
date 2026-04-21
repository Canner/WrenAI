export {};

const mockResolveRequestScope = jest.fn();
const mockListScheduleJobs = jest.fn();
const mockListScheduleRunsByJobIds = jest.fn();
const mockGetDashboard = jest.fn();
const mockCreateAuditEvent = jest.fn();

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: { resolveRequestScope: mockResolveRequestScope },
    scheduleJobRepository: { findAllBy: mockListScheduleJobs },
    scheduleJobRunRepository: {
      findAllByScheduleJobIds: mockListScheduleRunsByJobIds,
    },
    dashboardRepository: { findOneBy: mockGetDashboard },
    auditEventRepository: { createOne: mockCreateAuditEvent },
  },
}));

describe('pages/api/v1/workspace/schedules', () => {
  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'GET',
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns workspace schedule overview scoped to the active knowledge base', async () => {
    const handler = (await import('../../pages/api/v1/workspace/schedules'))
      .default;
    const req = createReq();
    const res = createRes();

    mockResolveRequestScope.mockResolvedValue({
      workspace: { id: 'ws-1', name: 'Workspace Alpha', slug: 'alpha' },
      knowledgeBase: { id: 'kb-1', name: 'Sales Insight', slug: 'sales' },
      kbSnapshot: { id: 'snap-1', deployHash: 'deploy-123' },
      userId: 'user-1',
      actorClaims: {
        workspaceId: 'ws-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
      },
    });
    mockListScheduleJobs.mockResolvedValue([
      {
        id: 'job-1',
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        targetType: 'dashboard_refresh',
        targetId: '11',
        cronExpr: '0 * * * *',
        timezone: 'UTC',
        status: 'active',
        nextRunAt: '2026-04-08T10:00:00.000Z',
        lastRunAt: '2026-04-08T09:00:00.000Z',
        lastError: null,
      },
      {
        id: 'job-2',
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        targetType: 'dashboard_refresh',
        targetId: '12',
        cronExpr: '30 6 * * *',
        timezone: 'Asia/Shanghai',
        status: 'inactive',
        nextRunAt: null,
        lastRunAt: '2026-04-07T12:00:00.000Z',
        lastError: 'refresh failed',
      },
    ]);
    mockListScheduleRunsByJobIds.mockResolvedValue([
      {
        id: 'run-1',
        scheduleJobId: 'job-2',
        status: 'failed',
        startedAt: '2026-04-07T12:00:00.000Z',
        finishedAt: '2026-04-07T12:01:00.000Z',
        errorMessage: 'refresh failed',
        detailJson: {
          runtimeIdentity: {
            workspaceId: 'ws-1',
            knowledgeBaseId: 'kb-1',
            deployHash: 'deploy-123',
          },
        },
      },
      {
        id: 'run-2',
        scheduleJobId: 'job-1',
        status: 'succeeded',
        startedAt: '2026-04-08T09:00:00.000Z',
        finishedAt: '2026-04-08T09:01:00.000Z',
        traceId: 'trace-1',
        detailJson: {
          runtimeIdentity: {
            workspaceId: 'ws-1',
            knowledgeBaseId: 'kb-1',
            deployHash: 'deploy-123',
          },
        },
      },
    ]);
    mockGetDashboard
      .mockResolvedValueOnce({ id: 11, name: '营收总览' })
      .mockResolvedValueOnce({ id: 12, name: '库存概览' });

    await handler(req, res);

    expect(mockListScheduleJobs).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
    });
    expect(mockListScheduleRunsByJobIds).toHaveBeenCalledWith([
      'job-1',
      'job-2',
    ]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({
      workspace: { id: 'ws-1', name: 'Workspace Alpha', slug: 'alpha' },
      currentKnowledgeBase: {
        id: 'kb-1',
        name: 'Sales Insight',
        slug: 'sales',
      },
      currentKbSnapshot: {
        id: 'snap-1',
        deployHash: 'deploy-123',
      },
      stats: {
        jobCount: 2,
        activeJobCount: 1,
        runCount: 2,
        latestRunStatus: 'succeeded',
      },
      jobs: [
        expect.objectContaining({
          id: 'job-1',
          targetName: '营收总览',
          targetTypeLabel: '看板缓存刷新',
          status: 'active',
        }),
        expect.objectContaining({
          id: 'job-2',
          targetName: '库存概览',
          status: 'inactive',
          lastError: 'refresh failed',
        }),
      ],
      recentRuns: [
        expect.objectContaining({
          id: 'run-2',
          targetName: '营收总览',
          status: 'succeeded',
          traceId: 'trace-1',
        }),
        expect.objectContaining({
          id: 'run-1',
          targetName: '库存概览',
          status: 'failed',
          errorMessage: 'refresh failed',
        }),
      ],
    });
  });

  it('rejects unsupported methods', async () => {
    const handler = (await import('../../pages/api/v1/workspace/schedules'))
      .default;
    const req = createReq({ method: 'POST' });
    const res = createRes();

    await handler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });
});
