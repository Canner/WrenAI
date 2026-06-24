import { DeployService } from '../deployService';
import { DeployStatusEnum } from '@server/repositories/deployLogRepository';

describe('DeployService', () => {
  let mockWrenAIAdaptor;

  let mockDeployLogRepository;
  let deployService;
  let mockTelemetry;

  beforeEach(() => {
    mockTelemetry = { sendEvent: jest.fn() };
    mockWrenAIAdaptor = { deploy: jest.fn(), delete: jest.fn() };
    mockDeployLogRepository = {
      findLastProjectDeployLog: jest.fn(),
      findLatestProjectDeployLog: jest.fn(),
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

  it('should skip deployment if an existing deployment with the same hash exists', async () => {
    const manifest = { key: 'value' };
    const projectId = 1;

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue({
      hash: deployService.createMDLHash(manifest, 1),
    });

    const response = await deployService.deploy(manifest, projectId);

    expect(response.status).toEqual(DeployStatusEnum.SUCCESS);
    expect(mockWrenAIAdaptor.deploy).not.toHaveBeenCalled();
  });

  it('should include datasource identity in deployment hash', () => {
    const manifest = { models: [{ name: 'orders', columns: [] }] };
    const project = {
      id: 1,
      type: 'mssql',
      version: '16',
      catalog: 'catalog',
      schema: 'dbo',
      sampleDataset: null,
      connectionInfo: {
        host: 'db-a',
        port: 1433,
        database: 'sales_a',
      },
    };

    const sameMdlDifferentDatabaseHash = deployService.createMDLHash(
      manifest,
      {
        ...project,
        connectionInfo: {
          ...project.connectionInfo,
          host: 'db-b',
          database: 'sales_b',
        },
      },
    );

    expect(deployService.createMDLHash(manifest, project)).not.toEqual(
      sameMdlDifferentDatabaseHash,
    );
  });

  it('should not report in-progress when the latest deployment is successful', async () => {
    mockDeployLogRepository.findLatestProjectDeployLog.mockResolvedValue({
      id: 2,
      status: DeployStatusEnum.SUCCESS,
    });

    const deployment = await deployService.getInProgressDeployment(1);

    expect(deployment).toBeNull();
    expect(
      mockDeployLogRepository.findLatestProjectDeployLog,
    ).toHaveBeenCalledWith(1);
    expect(mockDeployLogRepository.updateOne).not.toHaveBeenCalled();
  });

  it('should mark stale in-progress deployments failed', async () => {
    const oldDate = new Date(Date.now() - 11 * 60 * 1000);
    mockDeployLogRepository.findLatestProjectDeployLog.mockResolvedValue({
      id: 3,
      status: DeployStatusEnum.IN_PROGRESS,
      updatedAt: oldDate,
    });

    const deployment = await deployService.getInProgressDeployment(1);

    expect(deployment).toBeNull();
    expect(mockDeployLogRepository.updateOne).toHaveBeenCalledWith(3, {
      status: DeployStatusEnum.FAILED,
      error: 'Deployment timed out before completion.',
    });
  });

  it('should keep recent in-progress deployments active', async () => {
    const recentDate = new Date();
    const inProgressDeployment = {
      id: 4,
      status: DeployStatusEnum.IN_PROGRESS,
      updatedAt: recentDate,
    };
    mockDeployLogRepository.findLatestProjectDeployLog.mockResolvedValue(
      inProgressDeployment,
    );

    const deployment = await deployService.getInProgressDeployment(1);

    expect(deployment).toBe(inProgressDeployment);
    expect(mockDeployLogRepository.updateOne).not.toHaveBeenCalled();
  });

  it('should mark created deployment failed when deployment throws', async () => {
    const manifest = { key: 'value' };
    const projectId = 1;

    mockDeployLogRepository.findLastProjectDeployLog.mockResolvedValue(null);
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
