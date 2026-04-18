import { IQueryOptions } from '../repositories/baseRepository';
import {
  ISecretRepository,
  SecretRecord,
} from '../repositories/secretRepository';
import {
  EncryptedSecretPayload,
  ISecretService,
  SecretPayload,
} from './secretService';

export interface SecretReencryptFilters {
  workspaceId?: string;
  scopeType?: string;
  sourceKeyVersion?: number;
}

export interface SecretReencryptOptions extends SecretReencryptFilters {
  targetKeyVersion: number;
  execute?: boolean;
}

export interface SecretReencryptDependencies {
  secretRepository: ISecretRepository;
  sourceSecretService: Pick<ISecretService, 'decryptPayload'>;
  targetSecretService: Pick<ISecretService, 'encryptPayload'>;
}

export interface SecretReencryptPreview {
  id: string;
  workspaceId: string;
  scopeType: string;
  scopeId: string;
  fromKeyVersion: number;
  toKeyVersion: number;
}

export interface SecretReencryptSummary {
  dryRun: boolean;
  scanned: number;
  eligible: number;
  updated: number;
  skipped: number;
  targetKeyVersion: number;
  filters: SecretReencryptFilters;
  records: SecretReencryptPreview[];
}

interface SecretReencryptPreparedRecord {
  id: string;
  encrypted: EncryptedSecretPayload;
  preview: SecretReencryptPreview;
}

const filterSecretRecords = (
  records: SecretRecord[],
  options: SecretReencryptOptions,
) =>
  records.filter((record) => {
    if (options.workspaceId && record.workspaceId !== options.workspaceId) {
      return false;
    }

    if (options.scopeType && record.scopeType !== options.scopeType) {
      return false;
    }

    if (
      options.sourceKeyVersion !== undefined &&
      record.keyVersion !== options.sourceKeyVersion
    ) {
      return false;
    }

    return record.keyVersion !== options.targetKeyVersion;
  });

const prepareSecretRecord = (
  record: SecretRecord,
  options: SecretReencryptOptions,
  sourceSecretService: Pick<ISecretService, 'decryptPayload'>,
  targetSecretService: Pick<ISecretService, 'encryptPayload'>,
): SecretReencryptPreparedRecord => {
  const payload: SecretPayload = sourceSecretService.decryptPayload(record);
  const encrypted = targetSecretService.encryptPayload(
    payload,
    record.aad ?? null,
    options.targetKeyVersion,
  );

  return {
    id: record.id,
    encrypted,
    preview: {
      id: record.id,
      workspaceId: record.workspaceId,
      scopeType: record.scopeType,
      scopeId: record.scopeId,
      fromKeyVersion: record.keyVersion,
      toKeyVersion: options.targetKeyVersion,
    },
  };
};

export const reencryptSecrets = async (
  {
    secretRepository,
    sourceSecretService,
    targetSecretService,
  }: SecretReencryptDependencies,
  options: SecretReencryptOptions,
): Promise<SecretReencryptSummary> => {
  if (
    !Number.isInteger(options.targetKeyVersion) ||
    options.targetKeyVersion < 1
  ) {
    throw new Error('targetKeyVersion must be a positive integer');
  }

  const records = await secretRepository.findAll({
    order: 'created_at',
  } as IQueryOptions);
  const eligibleRecords = filterSecretRecords(records, options);
  const preparedRecords = eligibleRecords.map((record) =>
    prepareSecretRecord(
      record,
      options,
      sourceSecretService,
      targetSecretService,
    ),
  );

  if (options.execute) {
    const tx = await secretRepository.transaction();
    try {
      for (const record of preparedRecords) {
        await secretRepository.updateOne(
          record.id,
          {
            ciphertext: record.encrypted.ciphertext,
            iv: record.encrypted.iv,
            authTag: record.encrypted.authTag,
            aad: record.encrypted.aad,
            keyVersion: record.encrypted.keyVersion,
          },
          { tx },
        );
      }
      await secretRepository.commit(tx);
    } catch (error) {
      await secretRepository.rollback(tx);
      throw error;
    }
  }

  return {
    dryRun: !options.execute,
    scanned: records.length,
    eligible: preparedRecords.length,
    updated: options.execute ? preparedRecords.length : 0,
    skipped: records.length - preparedRecords.length,
    targetKeyVersion: options.targetKeyVersion,
    filters: {
      workspaceId: options.workspaceId,
      scopeType: options.scopeType,
      sourceKeyVersion: options.sourceKeyVersion,
    },
    records: preparedRecords.map((record) => record.preview),
  };
};
