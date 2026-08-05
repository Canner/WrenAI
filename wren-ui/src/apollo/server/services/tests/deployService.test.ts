import { DeployService } from '../deployService';
import { DeployStatusEnum } from '@server/repositories/deployLogRepository';

describe('DeployService', () => {
  let mockWrenAIAdaptor;

  let mockDeployLogRepository;
  let deployService;
  let mockTelemetry;

  beforeEach(() => {
    mockTelemetry = { sendEvent: jest.fn() };
    mockWrenAIAdaptor = { deploy: jest.fn() };
    mockWrenAIAdaptor.getDeployStatus = jest.fn();
    mockDeployLogRepository = {
      findLastProjectDeployLog: jest.fn(),
      findInProgressProjectDeployLog: jest.fn(),
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
    const projectId = 1;

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 123 });

    const response = await deployService.deploy(manifest, projectId);

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockWrenAIAdaptor.deploy).toHaveBeenCalledWith({
      manifest,
      hash: deployService.createMDLHash(manifest, projectId),
      projectId,
    });
    expect(mockDeployLogRepository.updateOne).toHaveBeenCalledWith(123, {
      status: DeployStatusEnum.SUCCESS,
      error: undefined,
    });
  });

  it('should return failed status if ai-service deployment fails', async () => {
    const manifest = { key: 'value' };
    const projectId = 1;

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockWrenAIAdaptor.deploy.mockResolvedValue({
      status: 'FAILED',
      error: 'AI error',
    });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 123 });

    const response = await deployService.deploy(manifest, projectId);

    expect(response.status).toEqual(DeployStatusEnum.FAILED);
    expect(response.error).toEqual('AI error');
  });

  it('should mark deployment failed if ai-service deployment throws', async () => {
    const manifest = { key: 'value' };
    const projectId = 1;

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 123 });
    mockWrenAIAdaptor.deploy.mockRejectedValue(new Error('AI unavailable'));

    const response = await deployService.deploy(manifest, projectId);

    expect(response.status).toEqual(DeployStatusEnum.FAILED);
    expect(response.error).toEqual('AI unavailable');
    expect(mockDeployLogRepository.updateOne).toHaveBeenCalledWith(123, {
      status: DeployStatusEnum.FAILED,
      error: 'AI unavailable',
    });
  });

  it('should refresh ai-service deployment if an existing deployment with the same hash exists', async () => {
    const manifest = { key: 'value' };
    const projectId = 1;
    const hash = deployService.createMDLHash(manifest, 1);

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue({
      id: 123,
      hash,
    });
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });

    const response = await deployService.deploy(manifest, projectId);

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockWrenAIAdaptor.deploy).toHaveBeenCalledWith({
      manifest,
      hash,
      projectId,
    });
    expect(mockDeployLogRepository.updateOne).toHaveBeenCalledWith(123, {
      status: DeployStatusEnum.SUCCESS,
      error: undefined,
    });
  });

  it('should return the deployment hash when ai-service already has the exact deployment prepared', async () => {
    const manifest = { key: 'value' };
    const hash = deployService.createMDLHash(manifest, 1);
    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue({
      hash,
      manifest,
    });
    mockWrenAIAdaptor.getDeployStatus.mockResolvedValue('FINISHED');

    const preparedHash = await deployService.ensureDeploymentPrepared(1);

    expect(preparedHash).toEqual(hash);
    expect(mockWrenAIAdaptor.getDeployStatus).toHaveBeenCalledWith(
      hash,
      1,
    );
    expect(mockWrenAIAdaptor.deploy).not.toHaveBeenCalled();
  });

  it('should wait for an existing ai-service indexing deployment instead of redeploying it', async () => {
    const manifest = { key: 'value' };
    const hash = deployService.createMDLHash(manifest, 1);
    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue({
      id: 123,
      hash,
      manifest,
    });
    mockWrenAIAdaptor.getDeployStatus
      .mockResolvedValueOnce('INDEXING')
      .mockResolvedValueOnce('FINISHED');
    deployService = new DeployService({
      telemetry: mockTelemetry,
      wrenAIAdaptor: mockWrenAIAdaptor,
      deployLogRepository: mockDeployLogRepository,
      deploymentPollingIntervalMs: 0,
      deploymentMaxAttempts: 3,
    });

    const preparedHash = await deployService.ensureDeploymentPrepared(1);

    expect(preparedHash).toEqual(hash);
    expect(mockWrenAIAdaptor.getDeployStatus).toHaveBeenCalledTimes(2);
    expect(mockWrenAIAdaptor.deploy).not.toHaveBeenCalled();
  });

  it('should fail instead of redeploying when an existing ai-service indexing deployment times out', async () => {
    const manifest = { key: 'value' };
    const hash = deployService.createMDLHash(manifest, 1);
    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue({
      id: 123,
      hash,
      manifest,
    });
    mockWrenAIAdaptor.getDeployStatus.mockResolvedValue('INDEXING');
    deployService = new DeployService({
      telemetry: mockTelemetry,
      wrenAIAdaptor: mockWrenAIAdaptor,
      deployLogRepository: mockDeployLogRepository,
      deploymentPollingIntervalMs: 0,
      deploymentMaxAttempts: 2,
    });

    await expect(deployService.ensureDeploymentPrepared(1)).rejects.toThrow(
      'did not finish indexing before timeout',
    );
    expect(mockWrenAIAdaptor.deploy).not.toHaveBeenCalled();
  });

  it('should redeploy the saved manifest when ai-service no longer has the exact deployment prepared', async () => {
    const manifest = { key: 'value' };
    const hash = deployService.createMDLHash(manifest, 1);
    mockDeployLogRepository.findLastProjectDeployLog
      .mockResolvedValueOnce({
        id: 123,
        hash,
        manifest,
      })
      .mockResolvedValueOnce({
        id: 123,
        hash,
        manifest,
      });
    mockWrenAIAdaptor.getDeployStatus.mockRejectedValue(new Error('not found'));
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });

    const preparedHash = await deployService.ensureDeploymentPrepared(1);

    expect(preparedHash).toEqual(hash);
    expect(mockWrenAIAdaptor.deploy).toHaveBeenCalledWith({
      manifest,
      hash,
      projectId: 1,
    });
  });

  it('should return the current manifest hash after redeploying a stale saved hash', async () => {
    const manifest = { key: 'value' };
    const activeHash = deployService.createMDLHash(manifest, 1);

    mockDeployLogRepository.findLastProjectDeployLog
      .mockResolvedValueOnce({
        id: 123,
        hash: 'legacy-saved-hash',
        manifest,
      })
      .mockResolvedValueOnce({
        id: 456,
        hash: activeHash,
        manifest,
      });
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 456 });

    const preparedHash = await deployService.ensureDeploymentPrepared(1);

    expect(preparedHash).toEqual(activeHash);
    expect(mockWrenAIAdaptor.getDeployStatus).not.toHaveBeenCalled();
    expect(mockWrenAIAdaptor.deploy).toHaveBeenCalledWith({
      manifest,
      hash: activeHash,
      projectId: 1,
    });
  });

  it('should create the same deployment hash for equivalent manifests', () => {
    const manifest = {
      models: [
        {
          name: 'orders',
          columns: [{ name: 'id' }, { name: 'amount' }],
        },
        {
          name: 'customers',
          columns: [{ name: 'id' }, { name: 'name' }],
        },
      ],
    };
    const reorderedManifest = {
      models: [
        {
          columns: [{ name: 'name' }, { name: 'id' }],
          name: 'customers',
        },
        {
          columns: [{ name: 'amount' }, { name: 'id' }],
          name: 'orders',
        },
      ],
    };

    expect(deployService.createMDLHash(manifest, 1)).toEqual(
      deployService.createMDLHash(reorderedManifest, 1),
    );
  });

  it('should treat equivalent deployed manifests as the same deployment', () => {
    const manifest = {
      models: [
        {
          name: 'orders',
          columns: [{ name: 'id' }, { name: 'amount' }],
        },
        {
          name: 'customers',
          columns: [{ name: 'id' }, { name: 'name' }],
        },
      ],
    };
    const reorderedManifest = {
      models: [
        {
          columns: [{ name: 'name' }, { name: 'id' }],
          name: 'customers',
        },
        {
          columns: [{ name: 'amount' }, { name: 'id' }],
          name: 'orders',
        },
      ],
    };

    expect(
      deployService.isSameDeployment(manifest, 1, {
        hash: 'different-hash-version',
        manifest: reorderedManifest,
      }),
    ).toBe(true);
  });

  it('should not treat changed deployed manifests as the same deployment', () => {
    const manifest = {
      models: [{ name: 'orders', columns: [{ name: 'id' }] }],
    };
    const changedManifest = {
      models: [{ name: 'orders', columns: [{ name: 'id' }, { name: 'amount' }] }],
    };

    expect(
      deployService.isSameDeployment(manifest, 1, {
        hash: 'different-hash-version',
        manifest: changedManifest,
      }),
    ).toBe(false);
  });

  it('should clear stale in-progress deployments', async () => {
    const oldDate = new Date(Date.now() - 11 * 60 * 1000);
    mockDeployLogRepository.findInProgressProjectDeployLog.mockResolvedValue({
      id: 122,
      status: DeployStatusEnum.IN_PROGRESS,
      updatedAt: oldDate,
    });

    const deployment = await deployService.getInProgressDeployment(1);

    expect(deployment).toBeNull();
    expect(mockDeployLogRepository.updateOne).toHaveBeenCalledWith(122, {
      status: DeployStatusEnum.FAILED,
      error: 'Deployment timed out before completion.',
    });
  });

  it('should clear previous in-progress deployment before creating a new one', async () => {
    const manifest = { key: 'value' };
    const projectId = 1;

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockDeployLogRepository.findInProgressProjectDeployLog.mockResolvedValue({
      id: 122,
      status: DeployStatusEnum.IN_PROGRESS,
      updatedAt: new Date(),
    });
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 123 });
    mockWrenAIAdaptor.deploy.mockResolvedValue({ status: 'SUCCESS' });

    const response = await deployService.deploy(manifest, projectId);

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockDeployLogRepository.updateOne).toHaveBeenCalledWith(122, {
      status: DeployStatusEnum.FAILED,
      error: 'Deployment was superseded by a new deployment.',
    });
    expect(mockDeployLogRepository.updateOne).toHaveBeenCalledWith(123, {
      status: DeployStatusEnum.SUCCESS,
      error: undefined,
    });
  });

  it('should mark created deployment failed when deployment throws', async () => {
    const manifest = { key: 'value' };
    const projectId = 1;

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
    mockDeployLogRepository.findInProgressProjectDeployLog.mockResolvedValue(null);
    mockDeployLogRepository.createOne.mockResolvedValue({ id: 123 });
    mockWrenAIAdaptor.deploy.mockRejectedValue(new Error('network error'));

    const response = await deployService.deploy(manifest, projectId);

    expect(response.status).toEqual(DeployStatusEnum.FAILED);
    expect(mockDeployLogRepository.updateOne).toHaveBeenCalledWith(123, {
      status: DeployStatusEnum.FAILED,
      error: 'network error',
    });
  });
});
