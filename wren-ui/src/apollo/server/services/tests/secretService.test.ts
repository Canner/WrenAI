import { SecretService } from '../secretService';

describe('SecretService', () => {
  let secretRepository: any;
  let service: SecretService;

  beforeEach(() => {
    secretRepository = {
      createOne: jest.fn().mockImplementation(async (payload: any) => payload),
      findOneBy: jest.fn(),
      updateOne: jest
        .fn()
        .mockImplementation(async (_id: string, payload: any) => payload),
      deleteOne: jest.fn().mockResolvedValue(1),
    };

    service = new SecretService({
      secretRepository,
      encryptionPassword: 'test-password',
      encryptionSalt: 'test-salt',
    });
  });

  it('stores encrypted payload and decrypts it back', async () => {
    const payload = {
      apiKey: 'secret-api-key',
      endpoint: 'https://example.com',
    };

    const secretRecord = await service.createSecretRecord({
      workspaceId: 'workspace-1',
      scopeType: 'connector',
      scopeId: 'connector-1',
      payload,
      createdBy: 'user-1',
    });

    expect(secretRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        scopeType: 'connector',
        scopeId: 'connector-1',
        keyVersion: 1,
        createdBy: 'user-1',
      }),
      undefined,
    );

    const storedPayload = secretRepository.createOne.mock.calls[0][0];
    expect(storedPayload.ciphertext).not.toContain('secret-api-key');
    expect(storedPayload.iv).toBeTruthy();
    expect(storedPayload.authTag).toBeTruthy();
    expect(storedPayload.aad).toBe(
      JSON.stringify({
        workspaceId: 'workspace-1',
        scopeType: 'connector',
        scopeId: 'connector-1',
      }),
    );

    secretRepository.findOneBy.mockResolvedValue({
      ...secretRecord,
      ...storedPayload,
    });

    await expect(service.decryptSecretRecord(secretRecord.id)).resolves.toEqual(
      payload,
    );
  });

  it('re-encrypts updated payload and keeps aad by default', async () => {
    const existingSecret = await service.createSecretRecord({
      workspaceId: 'workspace-1',
      scopeType: 'connector',
      scopeId: 'connector-1',
      payload: { apiKey: 'old-secret' },
      aad: 'connector-metadata',
    });

    secretRepository.findOneBy.mockResolvedValue(existingSecret);
    secretRepository.updateOne.mockImplementation(
      async (_id: string, payload: any) => ({
        ...existingSecret,
        ...payload,
      }),
    );

    const updated = await service.updateSecretRecord('secret-1', {
      payload: { apiKey: 'new-secret' },
    });

    expect(secretRepository.updateOne).toHaveBeenCalledWith(
      'secret-1',
      expect.objectContaining({
        aad: 'connector-metadata',
        keyVersion: 1,
      }),
      undefined,
    );
    expect(updated.ciphertext).not.toContain('new-secret');
    expect(service.decryptPayload(updated)).toEqual({ apiKey: 'new-secret' });
  });

  it('persists explicit key version and decrypts with the same master key', async () => {
    const secretRecord = await service.createSecretRecord({
      workspaceId: 'workspace-1',
      scopeType: 'skill',
      scopeId: 'skill-1',
      payload: { token: 'v2-secret' },
      keyVersion: 2,
    });

    expect(secretRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        keyVersion: 2,
      }),
      undefined,
    );

    secretRepository.findOneBy.mockResolvedValue(secretRecord);

    await expect(service.decryptSecretRecord(secretRecord.id)).resolves.toEqual({
      token: 'v2-secret',
    });
  });

  it('rejects decrypting ciphertext with a different master key', async () => {
    const secretRecord = await service.createSecretRecord({
      workspaceId: 'workspace-1',
      scopeType: 'connector',
      scopeId: 'connector-1',
      payload: { apiKey: 'rotating-secret' },
    });

    const wrongKeyService = new SecretService({
      secretRepository,
      encryptionPassword: 'wrong-password',
      encryptionSalt: 'wrong-salt',
    });

    expect(() => wrongKeyService.decryptPayload(secretRecord)).toThrow();
  });

  it('deletes a secret record by id', async () => {
    await expect(service.deleteSecretRecord('secret-1')).resolves.toBe(1);
    expect(secretRepository.deleteOne).toHaveBeenCalledWith(
      'secret-1',
      undefined,
    );
  });
});
