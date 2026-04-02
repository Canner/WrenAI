import { ConnectorService } from '../connectorService';

describe('ConnectorService', () => {
  let connectorRepository: any;
  let workspaceRepository: any;
  let knowledgeBaseRepository: any;
  let secretService: any;
  let service: ConnectorService;
  const tx = { id: 'tx' };

  beforeEach(() => {
    connectorRepository = {
      transaction: jest.fn().mockResolvedValue(tx),
      commit: jest.fn(),
      rollback: jest.fn(),
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
      createOne: jest.fn().mockImplementation(async (payload: any) => payload),
      updateOne: jest
        .fn()
        .mockImplementation(async (_id: string, payload: any) => payload),
      deleteOne: jest.fn().mockResolvedValue(1),
    };
    workspaceRepository = {
      findOneBy: jest.fn(),
    };
    knowledgeBaseRepository = {
      findOneBy: jest.fn(),
    };
    secretService = {
      createSecretRecord: jest.fn(),
      updateSecretRecord: jest.fn(),
      deleteSecretRecord: jest.fn(),
      decryptSecretRecord: jest.fn(),
    };

    service = new ConnectorService({
      connectorRepository,
      workspaceRepository,
      knowledgeBaseRepository,
      secretService,
    });
  });

  it('creates connector and persists secret reference', async () => {
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-1',
      workspaceId: 'workspace-1',
    });
    secretService.createSecretRecord.mockResolvedValue({ id: 'secret-1' });

    const connector = await service.createConnector({
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      type: 'http_api',
      displayName: 'Orders API',
      config: { baseUrl: 'https://api.example.com' },
      secret: { apiKey: 'top-secret' },
      createdBy: 'user-1',
    });

    expect(secretService.createSecretRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        scopeType: 'connector',
        payload: { apiKey: 'top-secret' },
        createdBy: 'user-1',
        scopeId: expect.any(String),
      }),
      { tx },
    );
    expect(connectorRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        type: 'http_api',
        displayName: 'Orders API',
        configJson: { baseUrl: 'https://api.example.com' },
        secretRecordId: 'secret-1',
        createdBy: 'user-1',
      }),
      { tx },
    );
    expect(connector.secretRecordId).toBe('secret-1');
    expect(connectorRepository.commit).toHaveBeenCalledWith(tx);
  });

  it('updates connector secret and mutable fields', async () => {
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-1',
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      type: 'http_api',
      displayName: 'Orders API',
      configJson: { baseUrl: 'https://old.example.com' },
      secretRecordId: 'secret-1',
      createdBy: 'user-1',
    });
    knowledgeBaseRepository.findOneBy.mockResolvedValue({
      id: 'kb-2',
      workspaceId: 'workspace-1',
    });
    connectorRepository.updateOne.mockImplementation(
      async (_id: string, payload: any) => ({
        id: 'connector-1',
        workspaceId: 'workspace-1',
        ...payload,
      }),
    );

    const connector = await service.updateConnector('connector-1', {
      knowledgeBaseId: 'kb-2',
      displayName: 'Orders API v2',
      config: { baseUrl: 'https://new.example.com' },
      secret: { apiKey: 'rotated-key' },
    });

    expect(secretService.updateSecretRecord).toHaveBeenCalledWith(
      'secret-1',
      { payload: { apiKey: 'rotated-key' } },
      { tx },
    );
    expect(connectorRepository.updateOne).toHaveBeenCalledWith(
      'connector-1',
      expect.objectContaining({
        knowledgeBaseId: 'kb-2',
        displayName: 'Orders API v2',
        configJson: { baseUrl: 'https://new.example.com' },
      }),
      { tx },
    );
    expect(connector.displayName).toBe('Orders API v2');
    expect(connectorRepository.commit).toHaveBeenCalledWith(tx);
  });

  it('deletes connector and cascades to secret service', async () => {
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-1',
      workspaceId: 'workspace-1',
      secretRecordId: 'secret-1',
    });

    await service.deleteConnector('connector-1');

    expect(connectorRepository.deleteOne).toHaveBeenCalledWith('connector-1', {
      tx,
    });
    expect(secretService.deleteSecretRecord).toHaveBeenCalledWith('secret-1', {
      tx,
    });
    expect(connectorRepository.commit).toHaveBeenCalledWith(tx);
  });

  it('rejects connector creation when workspace is missing', async () => {
    workspaceRepository.findOneBy.mockResolvedValue(null);

    await expect(
      service.createConnector({
        workspaceId: 'workspace-missing',
        type: 'http_api',
        displayName: 'Broken',
      }),
    ).rejects.toThrow('Workspace workspace-missing not found');

    expect(connectorRepository.rollback).toHaveBeenCalledWith(tx);
  });

  it('resolves decrypted connector secret', async () => {
    connectorRepository.findOneBy.mockResolvedValue({
      id: 'connector-1',
      workspaceId: 'workspace-1',
      type: 'http_api',
      displayName: 'Orders API',
      secretRecordId: 'secret-1',
    });
    secretService.decryptSecretRecord.mockResolvedValue({
      apiKey: 'resolved-secret',
    });

    await expect(service.getResolvedConnector('connector-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'connector-1',
        secret: { apiKey: 'resolved-secret' },
      }),
    );
  });
});
