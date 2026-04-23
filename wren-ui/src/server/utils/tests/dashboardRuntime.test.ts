import { resolveDashboardExecutionContext } from '../dashboardRuntime';

describe('dashboardRuntime', () => {
  it('builds persisted runtime identity from dashboard runtime plus request fallback', async () => {
    const kbSnapshotRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'snapshot-1',
        knowledgeBaseId: 'kb-1',
        deployHash: 'deploy-snapshot',
      }),
    } as any;
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({ id: 42, language: 'EN' }),
    } as any;
    const deployService = {
      getDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue({
        projectId: 42,
        hash: 'deploy-response',
        manifest: { models: [] },
      }),
    } as any;

    const result = await resolveDashboardExecutionContext({
      dashboard: {
        id: 7,
        projectId: null,
        knowledgeBaseId: null,
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
      } as any,
      kbSnapshotRepository,
      projectService,
      deployService,
      requestRuntimeIdentity: {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-request',
        kbSnapshotId: 'snapshot-request',
        deployHash: 'deploy-request',
        actorUserId: 'user-1',
      },
      responseRuntimeIdentity: {
        deployHash: 'deploy-response',
      },
    });

    expect(result.runtimeIdentity).toEqual({
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-response',
      actorUserId: 'user-1',
    });
    expect(projectService.getProjectById).toHaveBeenCalledWith(42);
    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-response',
    });
  });

  it('keeps the dashboard-specific missing project error when no project bridge can be resolved', async () => {
    await expect(
      resolveDashboardExecutionContext({
        dashboard: {
          id: 9,
          projectId: null,
          knowledgeBaseId: null,
          kbSnapshotId: null,
          deployHash: null,
        } as any,
        kbSnapshotRepository: {
          findOneBy: jest.fn().mockResolvedValue(null),
        } as any,
        projectService: {
          getProjectById: jest.fn(),
        } as any,
        deployService: {
          getDeploymentByRuntimeIdentity: jest.fn(),
        } as any,
        requestRuntimeIdentity: null,
        responseRuntimeIdentity: null,
      }),
    ).rejects.toThrow('Dashboard 9 is missing a project runtime binding');
  });

  it('prefers explicit item runtime identity over dashboard runtime fallback', async () => {
    const kbSnapshotRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'snapshot-dashboard',
        knowledgeBaseId: 'kb-dashboard',
        deployHash: 'deploy-dashboard',
      }),
    } as any;
    const projectService = {
      getProjectById: jest.fn().mockResolvedValue({ id: 77, language: 'EN' }),
    } as any;
    const deployService = {
      getDeploymentByRuntimeIdentity: jest.fn().mockResolvedValue({
        projectId: 77,
        hash: 'deploy-item',
        manifest: { models: [] },
      }),
    } as any;

    const result = await resolveDashboardExecutionContext({
      dashboard: {
        id: 11,
        projectId: null,
        knowledgeBaseId: 'kb-dashboard',
        kbSnapshotId: 'snapshot-dashboard',
        deployHash: 'deploy-dashboard',
      } as any,
      kbSnapshotRepository,
      projectService,
      deployService,
      requestRuntimeIdentity: {
        projectId: null,
        workspaceId: 'workspace-request',
        knowledgeBaseId: 'kb-request',
        kbSnapshotId: 'snapshot-request',
        deployHash: 'deploy-request',
        actorUserId: 'user-1',
      },
      runtimeIdentitySource: {
        projectId: null,
        workspaceId: 'workspace-item',
        knowledgeBaseId: 'kb-item',
        kbSnapshotId: 'snapshot-item',
        deployHash: 'deploy-item',
      },
    });

    expect(result.runtimeIdentity).toEqual({
      projectId: 77,
      workspaceId: 'workspace-item',
      knowledgeBaseId: 'kb-item',
      kbSnapshotId: 'snapshot-item',
      deployHash: 'deploy-item',
      actorUserId: 'user-1',
    });
    expect(deployService.getDeploymentByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-item',
      knowledgeBaseId: 'kb-item',
      kbSnapshotId: 'snapshot-item',
      deployHash: 'deploy-item',
    });
  });
});
