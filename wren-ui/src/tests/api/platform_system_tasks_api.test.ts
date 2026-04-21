import {
  createReq,
  createRes,
  mockBuildAuthorizationActorFromValidatedSession,
  mockGetDashboard,
  mockGetKnowledgeBase,
  mockGetKbSnapshot,
  mockGetScheduleJob,
  mockGetWorkspace,
  mockListScheduleRuns,
  mockListScheduleJobs,
  mockListScheduleRunsByJobIds,
  mockRunJobNow,
  mockSetDashboardSchedule,
  mockSyncDashboardRefreshJob,
  mockValidateSession,
  platformAdminActor,
  platformAdminSession,
  resetPlatformApiTestEnv,
} from './platform_api.testSupport';

const grantPlatformWorkspaceAdminSystemTaskManage = () => {
  mockValidateSession.mockResolvedValue({
    ...platformAdminSession,
    workspace: {
      ...platformAdminSession.workspace,
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
    },
    membership: null,
    user: {
      ...platformAdminSession.user,
      isPlatformAdmin: false,
    },
    actorClaims: {
      ...platformAdminSession.actorClaims,
      workspaceId: 'workspace-2',
      workspaceMemberId: null,
      roleKeys: [],
      permissionScopes: ['platform:*'],
      grantedActions: [
        'platform.workspace.read',
        'platform.system_task.read',
        'platform.system_task.manage',
      ],
      workspaceRoleSource: 'role_binding',
      isPlatformAdmin: false,
      platformRoleKeys: ['platform_workspace_admin'],
    },
  });
  mockBuildAuthorizationActorFromValidatedSession.mockReturnValue({
    ...platformAdminActor,
    workspaceId: 'workspace-2',
    workspaceMemberId: null,
    workspaceRoleKeys: [],
    permissionScopes: ['platform:*'],
    grantedActions: [
      'platform.workspace.read',
      'platform.system_task.read',
      'platform.system_task.manage',
    ],
    isPlatformAdmin: false,
    platformRoleKeys: ['platform_workspace_admin'],
  });
};

describe('platform system tasks api route', () => {
  beforeEach(() => {
    resetPlatformApiTestEnv();
  });

  it('GET /platform/system-tasks returns workspace job overview for platform readers', async () => {
    const handler = (
      await import('../../pages/api/v1/platform/system-tasks/index')
    ).default;
    const req = createReq({
      headers: { cookie: 'wren_session=session-token' },
      query: { workspaceId: 'workspace-2' },
    });
    const res = createRes();

    mockGetWorkspace.mockResolvedValue({
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
      kind: 'regular',
    });
    mockListScheduleJobs.mockResolvedValue([
      {
        id: 'job-1',
        targetType: 'dashboard_refresh',
        targetId: '42',
        cronExpr: '0 2 * * *',
        timezone: 'UTC',
        status: 'active',
        nextRunAt: '2026-04-21T02:00:00.000Z',
        lastRunAt: '2026-04-20T02:00:00.000Z',
        lastError: null,
      },
    ]);
    mockGetDashboard.mockResolvedValue({
      id: 42,
      name: 'Revenue Dashboard',
      cacheEnabled: true,
      scheduleFrequency: 'DAILY',
      scheduleCron: '0 2 * * *',
      scheduleTimezone: 'UTC',
    });
    mockListScheduleRunsByJobIds.mockResolvedValue([
      {
        id: 'run-1',
        scheduleJobId: 'job-1',
        status: 'succeeded',
        startedAt: '2026-04-20T02:00:00.000Z',
        finishedAt: '2026-04-20T02:00:12.000Z',
        traceId: 'trace-1',
        errorMessage: null,
        detailJson: { trigger: 'scheduled' },
      },
    ]);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.workspace).toEqual({
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
    });
    expect(res.body.stats).toEqual({
      jobCount: 1,
      activeJobCount: 1,
      runCount: 1,
      latestRunStatus: 'succeeded',
    });
    expect(res.body.jobs).toEqual([
      expect.objectContaining({
        id: 'job-1',
        targetName: 'Revenue Dashboard',
        status: 'active',
      }),
    ]);
    expect(res.body.recentRuns).toEqual([
      expect.objectContaining({
        id: 'run-1',
        targetName: 'Revenue Dashboard',
        status: 'succeeded',
      }),
    ]);
  });

  it('PATCH /platform/system-tasks/[id] updates a dashboard refresh plan', async () => {
    const handler = (
      await import('../../pages/api/v1/platform/system-tasks/[id]')
    ).default;
    const req = createReq({
      method: 'PATCH',
      headers: { cookie: 'wren_session=session-token' },
      query: { id: 'job-1', workspaceId: 'workspace-2' },
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

    mockGetScheduleJob.mockResolvedValue({
      id: 'job-1',
      workspaceId: 'workspace-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
      targetType: 'dashboard_refresh',
      targetId: '42',
      cronExpr: '0 2 * * *',
      timezone: 'UTC',
      status: 'active',
      nextRunAt: '2026-04-21T02:00:00.000Z',
      lastRunAt: '2026-04-20T02:00:00.000Z',
      lastError: null,
    });
    mockGetWorkspace.mockResolvedValue({
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
      kind: 'regular',
    });
    mockGetDashboard.mockResolvedValue({
      id: 42,
      name: 'Revenue Dashboard',
      createdBy: 'user-2',
      cacheEnabled: true,
      scheduleFrequency: 'DAILY',
      scheduleCron: '30 9 * * *',
      scheduleTimezone: 'Asia/Shanghai',
      nextScheduledAt: '2026-04-21T01:30:00.000Z',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
    });
    mockSetDashboardSchedule.mockResolvedValue({
      id: 42,
      name: 'Revenue Dashboard',
      createdBy: 'user-2',
      cacheEnabled: true,
      scheduleFrequency: 'DAILY',
      scheduleCron: '30 9 * * *',
      scheduleTimezone: 'Asia/Shanghai',
      nextScheduledAt: '2026-04-21T01:30:00.000Z',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
    });
    mockGetKbSnapshot.mockResolvedValue({
      id: 'snap-2',
      knowledgeBaseId: 'kb-2',
      deployHash: 'deploy-2',
    });
    mockGetKnowledgeBase.mockResolvedValue({
      id: 'kb-2',
      workspaceId: 'workspace-2',
      name: 'Finance KB',
    });
    mockSyncDashboardRefreshJob.mockResolvedValue({
      id: 'job-1',
      workspaceId: 'workspace-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
      targetType: 'dashboard_refresh',
      targetId: '42',
      cronExpr: '30 9 * * *',
      timezone: 'Asia/Shanghai',
      status: 'active',
      nextRunAt: '2026-04-21T01:30:00.000Z',
      lastRunAt: '2026-04-20T02:00:00.000Z',
      lastError: null,
    });

    await handler(req, res);

    expect(mockSetDashboardSchedule).toHaveBeenCalledWith(42, {
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
        dashboardId: 42,
        workspaceId: 'workspace-2',
        knowledgeBaseId: 'kb-2',
        kbSnapshotId: 'snap-2',
        deployHash: 'deploy-2',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.job).toEqual(
      expect.objectContaining({
        id: 'job-1',
        cronExpr: '30 9 * * *',
      }),
    );
  });

  it('PATCH /platform/system-tasks/[id] also allows platform workspace admins with system task manage capability', async () => {
    const handler = (
      await import('../../pages/api/v1/platform/system-tasks/[id]')
    ).default;
    const req = createReq({
      method: 'PATCH',
      headers: { cookie: 'wren_session=session-token' },
      query: { id: 'job-1', workspaceId: 'workspace-2' },
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

    grantPlatformWorkspaceAdminSystemTaskManage();
    mockGetScheduleJob.mockResolvedValue({
      id: 'job-1',
      workspaceId: 'workspace-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
      targetType: 'dashboard_refresh',
      targetId: '42',
      cronExpr: '0 2 * * *',
      timezone: 'UTC',
      status: 'active',
      nextRunAt: '2026-04-21T02:00:00.000Z',
      lastRunAt: '2026-04-20T02:00:00.000Z',
      lastError: null,
    });
    mockGetWorkspace.mockResolvedValue({
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
      kind: 'regular',
    });
    mockGetDashboard.mockResolvedValue({
      id: 42,
      name: 'Revenue Dashboard',
      createdBy: 'user-2',
      cacheEnabled: true,
      scheduleFrequency: 'DAILY',
      scheduleCron: '30 9 * * *',
      scheduleTimezone: 'Asia/Shanghai',
      nextScheduledAt: '2026-04-21T01:30:00.000Z',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
    });
    mockSetDashboardSchedule.mockResolvedValue({
      id: 42,
      name: 'Revenue Dashboard',
      createdBy: 'user-2',
      cacheEnabled: true,
      scheduleFrequency: 'DAILY',
      scheduleCron: '30 9 * * *',
      scheduleTimezone: 'Asia/Shanghai',
      nextScheduledAt: '2026-04-21T01:30:00.000Z',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
    });
    mockGetKbSnapshot.mockResolvedValue({
      id: 'snap-2',
      knowledgeBaseId: 'kb-2',
      deployHash: 'deploy-2',
    });
    mockGetKnowledgeBase.mockResolvedValue({
      id: 'kb-2',
      workspaceId: 'workspace-2',
      name: 'Finance KB',
    });
    mockSyncDashboardRefreshJob.mockResolvedValue({
      id: 'job-1',
      workspaceId: 'workspace-2',
      knowledgeBaseId: 'kb-2',
      kbSnapshotId: 'snap-2',
      deployHash: 'deploy-2',
      targetType: 'dashboard_refresh',
      targetId: '42',
      cronExpr: '30 9 * * *',
      timezone: 'Asia/Shanghai',
      status: 'active',
      nextRunAt: '2026-04-21T01:30:00.000Z',
      lastRunAt: '2026-04-20T02:00:00.000Z',
      lastError: null,
    });

    await handler(req, res);

    expect(mockSetDashboardSchedule).toHaveBeenCalledWith(42, {
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
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.job).toEqual(
      expect.objectContaining({
        id: 'job-1',
        cronExpr: '30 9 * * *',
      }),
    );
  });

  it('POST /platform/system-tasks/[id]/run executes the selected job immediately', async () => {
    const handler = (
      await import('../../pages/api/v1/platform/system-tasks/[id]/run')
    ).default;
    const req = createReq({
      method: 'POST',
      headers: { cookie: 'wren_session=session-token' },
      query: { id: 'job-1', workspaceId: 'workspace-2' },
    });
    const res = createRes();

    mockGetScheduleJob
      .mockResolvedValueOnce({
        id: 'job-1',
        workspaceId: 'workspace-2',
        targetType: 'dashboard_refresh',
        targetId: '42',
        cronExpr: '0 2 * * *',
        timezone: 'UTC',
        status: 'active',
        nextRunAt: '2026-04-21T02:00:00.000Z',
        lastRunAt: '2026-04-20T02:00:00.000Z',
        lastError: null,
      })
      .mockResolvedValueOnce({
        id: 'job-1',
        workspaceId: 'workspace-2',
        targetType: 'dashboard_refresh',
        targetId: '42',
        cronExpr: '0 2 * * *',
        timezone: 'UTC',
        status: 'active',
        nextRunAt: '2026-04-21T02:00:00.000Z',
        lastRunAt: '2026-04-20T03:00:00.000Z',
        lastError: null,
      });
    mockGetWorkspace.mockResolvedValue({
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
      kind: 'regular',
    });
    mockRunJobNow.mockResolvedValue(undefined);
    mockListScheduleRuns.mockResolvedValue([
      {
        id: 'run-2',
        scheduleJobId: 'job-1',
        status: 'succeeded',
        startedAt: '2026-04-20T03:00:00.000Z',
        finishedAt: '2026-04-20T03:00:10.000Z',
        traceId: 'trace-2',
        detailJson: { trigger: 'manual' },
      },
    ]);

    await handler(req, res);

    expect(mockRunJobNow).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'job-1',
        workspaceId: 'workspace-2',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.lastRun).toEqual(
      expect.objectContaining({
        id: 'run-2',
        status: 'succeeded',
      }),
    );
  });

  it('POST /platform/system-tasks/[id]/run also allows platform workspace admins with system task manage capability', async () => {
    const handler = (
      await import('../../pages/api/v1/platform/system-tasks/[id]/run')
    ).default;
    const req = createReq({
      method: 'POST',
      headers: { cookie: 'wren_session=session-token' },
      query: { id: 'job-1', workspaceId: 'workspace-2' },
    });
    const res = createRes();

    grantPlatformWorkspaceAdminSystemTaskManage();
    mockGetScheduleJob
      .mockResolvedValueOnce({
        id: 'job-1',
        workspaceId: 'workspace-2',
        targetType: 'dashboard_refresh',
        targetId: '42',
        cronExpr: '0 2 * * *',
        timezone: 'UTC',
        status: 'active',
        nextRunAt: '2026-04-21T02:00:00.000Z',
        lastRunAt: '2026-04-20T02:00:00.000Z',
        lastError: null,
      })
      .mockResolvedValueOnce({
        id: 'job-1',
        workspaceId: 'workspace-2',
        targetType: 'dashboard_refresh',
        targetId: '42',
        cronExpr: '0 2 * * *',
        timezone: 'UTC',
        status: 'active',
        nextRunAt: '2026-04-21T02:00:00.000Z',
        lastRunAt: '2026-04-20T03:00:00.000Z',
        lastError: null,
      });
    mockGetWorkspace.mockResolvedValue({
      id: 'workspace-2',
      name: 'Finance Workspace',
      slug: 'finance',
      kind: 'regular',
    });
    mockRunJobNow.mockResolvedValue(undefined);
    mockListScheduleRuns.mockResolvedValue([
      {
        id: 'run-2',
        scheduleJobId: 'job-1',
        status: 'succeeded',
        startedAt: '2026-04-20T03:00:00.000Z',
        finishedAt: '2026-04-20T03:00:10.000Z',
        traceId: 'trace-2',
        detailJson: { trigger: 'manual' },
      },
    ]);

    await handler(req, res);

    expect(mockRunJobNow).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'job-1',
        workspaceId: 'workspace-2',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.lastRun).toEqual(
      expect.objectContaining({
        id: 'run-2',
        status: 'succeeded',
      }),
    );
  });
});
