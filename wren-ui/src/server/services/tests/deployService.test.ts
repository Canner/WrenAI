import { DeployService } from '../deployService';
import { DeployStatusEnum } from '@server/repositories/deployLogRepository';

describe('DeployService', () => {
  let mockWrenAIAdaptor: any;

  let mockDeployLogRepository: any;
  let deployService: any;
  let mockTelemetry: any;
  const runtimeIdentity = { projectId: 1, workspaceId: 'workspace-1' };

  beforeEach(() => {
    mockTelemetry = { sendEvent: jest.fn() };
    mockWrenAIAdaptor = { deploy: jest.fn() };
    mockDeployLogRepository = {
      findLastProjectDeployLog: jest.fn(),
      findInProgressProjectDeployLog: jest.fn(),
      findLatestDeployLogByHash: jest.fn(),
      findLastRuntimeDeployLog: jest.fn(),
      findInProgressRuntimeDeployLog: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };

    deployService = new DeployService({
      telemetry: mockTelemetry,
      wrenAIAdaptor: mockWrenAIAdaptor,
      deployLogRepository: mockDeployLogRepository,
    });
  });

  it('should successfully deploy when there is no existing deployment with the same hash', async () => {
    const manifest = { key: 'value' };

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 123 });

    const response = await deployService.deploy(
      manifest,
      runtimeIdentity,
      false,
    );

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockWrenAIAdaptor.deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest,
        runtimeIdentity: expect.objectContaining({
          workspaceId: runtimeIdentity.workspaceId,
          deployHash: expect.any(String),
        }),
      }),
    );
    expect(mockDeployLogRepository.updateOne).toHaveBeenCalledWith(123, {
      status: DeployStatusEnum.SUCCESS,
      error: undefined,
    });
  });

  it('should return failed status if ai-service deployment fails', async () => {
    const manifest = { key: 'value' };

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockWrenAIAdaptor.deploy.mockResolvedValue({
      status: 'FAILED',
      error: 'AI error',
    });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 123 });

    const response = await deployService.deploy(
      manifest,
      runtimeIdentity,
      false,
    );

    expect(response.status).toEqual(DeployStatusEnum.FAILED);
    expect(response.error).toEqual('AI error');
  });

  it('should skip deployment if an existing deployment with the same hash exists', async () => {
    const manifest = { key: 'value' };

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue({
      hash: deployService.createMDLHashByRuntimeIdentity(
        manifest,
        runtimeIdentity,
      ),
    });

    const response = await deployService.deploy(
      manifest,
      runtimeIdentity,
      false,
    );

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockWrenAIAdaptor.deploy).not.toHaveBeenCalled();
  });

  it('prefers canonical workspace identity over a stale project bridge when generating MDL hashes', () => {
    const manifest = { key: 'value' };

    expect(
      deployService.createMDLHashByRuntimeIdentity(manifest, {
        projectId: 1,
        workspaceId: 'workspace-1',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
      }),
    ).toEqual(
      deployService.createMDLHashByRuntimeIdentity(manifest, {
        projectId: 999,
        workspaceId: 'workspace-1',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
      }),
    );
  });

  it('uses canonical runtime scope keys when generating MDL hashes', () => {
    const manifest = { key: 'value' };

    expect(
      deployService.createMDLHashByRuntimeIdentity(manifest, {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    ).toEqual(
      deployService.createMDLHashByRuntimeIdentity(manifest, {
        projectId: 999,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
  });

  it('deploys when only deploy hash is available and project bridge is resolved from deployment history', async () => {
    const manifest = { key: 'value' };

    mockDeployLogRepository.findLatestDeployLogByHash.mockResolvedValue({
      id: 8,
      projectId: 77,
      hash: 'deploy-4',
    });
    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 124 });

    const response = await deployService.deploy(
      manifest,
      {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-4',
      } as any,
      false,
    );

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockDeployLogRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 77,
        hash: deployService.createMDLHashByRuntimeIdentity(manifest, {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-4',
        }),
      }),
    );
  });

  it('prefers the explicit runtime project when deploying a canonical workspace scope', async () => {
    const manifest = { key: 'value' };

    mockDeployLogRepository.findLastRuntimeDeployLog.mockResolvedValue({
      id: 10,
      projectId: 6,
      hash: 'deploy-old',
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
    });
    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 125 });

    const response = await deployService.deploy(
      manifest,
      {
        projectId: 7,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: null,
        deployHash: null,
      } as any,
      true,
    );

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockDeployLogRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 7,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
      }),
    );
    expect(
      mockDeployLogRepository.findLastRuntimeDeployLog,
    ).not.toHaveBeenCalled();
  });

  it('should resolve last deployment by runtime identity', async () => {
    const deployment = { id: 5, projectId: 1, hash: 'deploy-1' };
    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(
      deployment,
    );

    await expect(
      deployService.getLastDeploymentByRuntimeIdentity({
        projectId: 1,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
      } as any),
    ).resolves.toEqual(deployment);
  });

  it('should resolve last deployment by canonical runtime identity without a project bridge', async () => {
    const deployment = {
      id: 15,
      projectId: 77,
      hash: 'deploy-runtime-1',
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
    };
    mockDeployLogRepository.findLastRuntimeDeployLog.mockResolvedValue(
      deployment,
    );

    await expect(
      deployService.getLastDeploymentByRuntimeIdentity({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
      } as any),
    ).resolves.toEqual(deployment);

    expect(
      mockDeployLogRepository.findLastProjectDeployLog,
    ).not.toHaveBeenCalled();
    expect(
      mockDeployLogRepository.findLastRuntimeDeployLog,
    ).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: null,
      actorUserId: null,
    });
  });

  it('should resolve last deployment by deploy hash when project bridge is absent', async () => {
    const deployment = { id: 8, projectId: 77, hash: 'deploy-4' };
    mockDeployLogRepository.findLatestDeployLogByHash.mockResolvedValue(
      deployment,
    );

    await expect(
      deployService.getLastDeploymentByRuntimeIdentity({
        projectId: null,
        deployHash: 'deploy-4',
      } as any),
    ).resolves.toEqual(deployment);
  });

  it('prefers deploy hash over project bridge when resolving the last deployment', async () => {
    const deployment = { id: 9, projectId: 77, hash: 'deploy-5' };
    mockDeployLogRepository.findLatestDeployLogByHash.mockResolvedValue(
      deployment,
    );

    await expect(
      deployService.getLastDeploymentByRuntimeIdentity({
        ...runtimeIdentity,
        deployHash: 'deploy-5',
      }),
    ).resolves.toEqual(deployment);

    expect(
      mockDeployLogRepository.findLastProjectDeployLog,
    ).not.toHaveBeenCalled();
  });

  it('should resolve deployment by runtime identity and deploy hash', async () => {
    const deployment = { id: 6, projectId: 1, hash: 'deploy-2' };
    mockDeployLogRepository.findLatestDeployLogByHash.mockResolvedValue(
      deployment,
    );

    await expect(
      deployService.getDeploymentByRuntimeIdentity({
        ...runtimeIdentity,
        deployHash: 'deploy-2',
      }),
    ).resolves.toEqual(deployment);
  });

  it('should resolve deployment by deploy hash even when project bridge is absent', async () => {
    const deployment = { id: 7, projectId: 99, hash: 'deploy-3' };
    mockDeployLogRepository.findLatestDeployLogByHash.mockResolvedValue(
      deployment,
    );

    await expect(
      deployService.getDeploymentByRuntimeIdentity({
        deployHash: 'deploy-3',
      } as any),
    ).resolves.toEqual(deployment);
    expect(
      mockDeployLogRepository.findLatestDeployLogByHash,
    ).toHaveBeenCalledWith('deploy-3', {
      status: DeployStatusEnum.SUCCESS,
    });
  });

  it('prefers deploy hash over project bridge when resolving deployment', async () => {
    const deployment = { id: 10, projectId: 88, hash: 'deploy-6' };
    mockDeployLogRepository.findLatestDeployLogByHash.mockResolvedValue(
      deployment,
    );

    await expect(
      deployService.getDeploymentByRuntimeIdentity({
        ...runtimeIdentity,
        deployHash: 'deploy-6',
      }),
    ).resolves.toEqual(deployment);

    expect(
      mockDeployLogRepository.findLastProjectDeployLog,
    ).not.toHaveBeenCalled();
  });

  it('prefers the latest successful deploy log when duplicate rows share the same deploy hash', async () => {
    const deployment = { id: 12, projectId: 7, hash: 'deploy-dup' };
    mockDeployLogRepository.findLatestDeployLogByHash.mockResolvedValue(
      deployment,
    );

    await expect(
      deployService.getDeploymentByRuntimeIdentity({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-dup',
      } as any),
    ).resolves.toEqual(deployment);

    expect(
      mockDeployLogRepository.findLatestDeployLogByHash,
    ).toHaveBeenCalledWith('deploy-dup', {
      status: DeployStatusEnum.SUCCESS,
    });
  });

  it('returns the exact deploy-hash match when that deployment is already in progress', async () => {
    const deployment = {
      id: 11,
      projectId: 77,
      hash: 'deploy-7',
      status: DeployStatusEnum.IN_PROGRESS,
    };
    mockDeployLogRepository.findLatestDeployLogByHash.mockResolvedValue(
      deployment,
    );

    await expect(
      deployService.getInProgressDeploymentByRuntimeIdentity({
        ...runtimeIdentity,
        deployHash: 'deploy-7',
      }),
    ).resolves.toEqual(deployment);

    expect(
      mockDeployLogRepository.findInProgressProjectDeployLog,
    ).not.toHaveBeenCalled();
  });

  it('prefers deploy hash when resolving in-progress deployment by runtime identity', async () => {
    const deployment = { id: 11, projectId: 77, hash: 'deploy-7' };
    const inProgress = { id: 12, projectId: 77, hash: 'deploy-8' };
    mockDeployLogRepository.findLatestDeployLogByHash.mockResolvedValue(
      deployment,
    );
    mockDeployLogRepository.findInProgressProjectDeployLog.mockResolvedValue(
      inProgress,
    );

    await expect(
      deployService.getInProgressDeploymentByRuntimeIdentity({
        ...runtimeIdentity,
        deployHash: 'deploy-7',
      }),
    ).resolves.toEqual(inProgress);
  });

  it('should resolve in-progress deployment by canonical runtime identity without a project bridge', async () => {
    const inProgress = {
      id: 22,
      projectId: 77,
      hash: 'deploy-runtime-2',
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
    };
    mockDeployLogRepository.findInProgressRuntimeDeployLog.mockResolvedValue(
      inProgress,
    );

    await expect(
      deployService.getInProgressDeploymentByRuntimeIdentity({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
      } as any),
    ).resolves.toEqual(inProgress);

    expect(
      mockDeployLogRepository.findInProgressProjectDeployLog,
    ).not.toHaveBeenCalled();
  });

  it('returns null for runtime deployment reads when neither deploy hash nor project bridge is available', async () => {
    await expect(
      deployService.getLastDeploymentByRuntimeIdentity({
        projectId: null,
        deployHash: null,
      } as any),
    ).resolves.toBeNull();
    await expect(
      deployService.getDeploymentByRuntimeIdentity({
        projectId: null,
        deployHash: null,
      } as any),
    ).resolves.toBeNull();
    await expect(
      deployService.getInProgressDeploymentByRuntimeIdentity({
        projectId: null,
        deployHash: null,
      } as any),
    ).resolves.toBeNull();
  });

  it('does not reuse a stale runtimeIdentity.projectId for canonical runtime deployment reads', async () => {
    await expect(
      deployService.getLastDeploymentByRuntimeIdentity({
        projectId: 999,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
      } as any),
    ).resolves.toBeNull();
    await expect(
      deployService.getDeploymentByRuntimeIdentity({
        projectId: 999,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
      } as any),
    ).resolves.toBeNull();
    await expect(
      deployService.getInProgressDeploymentByRuntimeIdentity({
        projectId: 999,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
      } as any),
    ).resolves.toBeNull();

    expect(
      mockDeployLogRepository.findLastProjectDeployLog,
    ).not.toHaveBeenCalled();
    expect(
      mockDeployLogRepository.findInProgressProjectDeployLog,
    ).not.toHaveBeenCalled();
  });

  it('prefers deployment history over a stale runtimeIdentity.projectId during deploy', async () => {
    const manifest = { key: 'value' };

    mockDeployLogRepository.findLatestDeployLogByHash.mockResolvedValue({
      id: 20,
      projectId: 77,
      hash: 'deploy-9',
    });
    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 125 });

    const response = await deployService.deploy(
      manifest,
      {
        projectId: 1,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-9',
      } as any,
      false,
    );

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockDeployLogRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 77,
      }),
    );
    expect(
      mockDeployLogRepository.findLastProjectDeployLog,
    ).toHaveBeenCalledWith(77);
  });

  it('should reject deploy when runtime identity project bridge is missing', async () => {
    await expect(
      deployService.deploy(
        { key: 'value' } as any,
        { workspaceId: 'workspace-1' } as any,
        false,
      ),
    ).resolves.toEqual({
      status: DeployStatusEnum.FAILED,
      error: 'deploy requires runtimeIdentity compatibility scope',
    });
    expect(mockDeployLogRepository.createOne).not.toHaveBeenCalled();
  });

  it('should resolve deploy project id from canonical runtime deployment history when project bridge is missing', async () => {
    const manifest = { key: 'value' };

    mockDeployLogRepository.findLastRuntimeDeployLog.mockResolvedValue({
      id: 30,
      projectId: 77,
      hash: 'deploy-runtime-3',
    });
    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 126 });

    const response = await deployService.deploy(
      manifest,
      {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
      } as any,
      false,
    );

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockDeployLogRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 77,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: expect.any(String),
      }),
    );
  });

  // Add more tests here to cover other scenarios and error handling
});
