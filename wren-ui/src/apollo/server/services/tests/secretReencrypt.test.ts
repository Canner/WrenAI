import { SecretRecord } from '../../repositories';
import { SecretService } from '../secretService';
import { reencryptSecrets } from '../secretReencrypt';

describe('reencryptSecrets', () => {
  let repository: any;
  let sourceSecretService: SecretService;
  let targetSecretService: SecretService;

  const buildRecord = (
    overrides: Partial<SecretRecord> = {},
    service = sourceSecretService,
  ): SecretRecord => {
    const encrypted = service.encryptPayload(
      { apiKey: overrides.id || 'secret' },
      overrides.aad ?? 'aad',
      overrides.keyVersion ?? 1,
    );

    return {
      id: overrides.id || 'secret-1',
      workspaceId: overrides.workspaceId || 'workspace-1',
      scopeType: overrides.scopeType || 'connector',
      scopeId: overrides.scopeId || 'scope-1',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      aad: encrypted.aad,
      keyVersion: encrypted.keyVersion,
      createdBy: overrides.createdBy || 'user-1',
    };
  };

  beforeEach(() => {
    repository = {
      findAll: jest.fn(),
      updateOne: jest.fn().mockResolvedValue(undefined),
      transaction: jest.fn().mockResolvedValue('tx-1'),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    sourceSecretService = new SecretService({
      secretRepository: repository,
      encryptionPassword: 'source-password',
      encryptionSalt: 'source-salt',
    });
    targetSecretService = new SecretService({
      secretRepository: repository,
      encryptionPassword: 'target-password',
      encryptionSalt: 'target-salt',
    });
  });

  it('builds a dry-run summary without mutating records', async () => {
    repository.findAll.mockResolvedValue([
      buildRecord({ id: 'secret-1', keyVersion: 1 }),
      buildRecord({ id: 'secret-2', keyVersion: 2 }),
    ]);

    const summary = await reencryptSecrets(
      {
        secretRepository: repository,
        sourceSecretService,
        targetSecretService,
      },
      {
        targetKeyVersion: 3,
        sourceKeyVersion: 1,
      },
    );

    expect(summary).toEqual({
      dryRun: true,
      scanned: 2,
      eligible: 1,
      updated: 0,
      skipped: 1,
      targetKeyVersion: 3,
      filters: {
        workspaceId: undefined,
        scopeType: undefined,
        sourceKeyVersion: 1,
      },
      records: [
        {
          id: 'secret-1',
          workspaceId: 'workspace-1',
          scopeType: 'connector',
          scopeId: 'scope-1',
          fromKeyVersion: 1,
          toKeyVersion: 3,
        },
      ],
    });
    expect(repository.updateOne).not.toHaveBeenCalled();
  });

  it('updates eligible records in a transaction during execute mode', async () => {
    const record = buildRecord({ id: 'secret-1', keyVersion: 1 });
    repository.findAll.mockResolvedValue([record]);

    const summary = await reencryptSecrets(
      {
        secretRepository: repository,
        sourceSecretService,
        targetSecretService,
      },
      {
        execute: true,
        targetKeyVersion: 5,
        workspaceId: 'workspace-1',
      },
    );

    expect(repository.transaction).toHaveBeenCalled();
    expect(repository.updateOne).toHaveBeenCalledWith(
      'secret-1',
      expect.objectContaining({
        keyVersion: 5,
        aad: 'aad',
      }),
      { tx: 'tx-1' },
    );
    expect(repository.commit).toHaveBeenCalledWith('tx-1');
    expect(repository.rollback).not.toHaveBeenCalled();
    expect(summary.updated).toBe(1);
    expect(summary.dryRun).toBe(false);
  });

  it('rolls back when one record cannot be decrypted', async () => {
    const undecryptableRecord = buildRecord({ id: 'secret-1', keyVersion: 1 });
    repository.findAll.mockResolvedValue([undecryptableRecord]);

    const brokenSourceSecretService = new SecretService({
      secretRepository: repository,
      encryptionPassword: 'wrong-password',
      encryptionSalt: 'wrong-salt',
    });

    await expect(
      reencryptSecrets(
        {
          secretRepository: repository,
          sourceSecretService: brokenSourceSecretService,
          targetSecretService,
        },
        {
          execute: true,
          targetKeyVersion: 2,
        },
      ),
    ).rejects.toThrow();

    expect(repository.transaction).not.toHaveBeenCalled();
    expect(repository.updateOne).not.toHaveBeenCalled();
  });
});
