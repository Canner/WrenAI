import crypto from 'crypto';
import { IQueryOptions, ISecretRepository, SecretRecord } from '../repositories';

const DEFAULT_KEY_VERSION = 1;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_DIGEST = 'sha512';
const ENCRYPTION_ITERATIONS = 100_000;
const ENCRYPTION_KEY_LENGTH = 32;
const ENCRYPTION_IV_LENGTH = 12;

export type SecretPayload = Record<string, any>;

export interface EncryptedSecretPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  aad: string | null;
  keyVersion: number;
}

export interface CreateSecretRecordInput {
  workspaceId: string;
  scopeType: string;
  scopeId: string;
  payload: SecretPayload;
  aad?: string | null;
  createdBy?: string | null;
  keyVersion?: number;
}

export interface UpdateSecretRecordInput {
  payload: SecretPayload;
  aad?: string | null;
}

export interface ISecretService {
  createSecretRecord(
    input: CreateSecretRecordInput,
    queryOptions?: IQueryOptions,
  ): Promise<SecretRecord>;
  updateSecretRecord(
    secretId: string,
    input: UpdateSecretRecordInput,
    queryOptions?: IQueryOptions,
  ): Promise<SecretRecord>;
  deleteSecretRecord(
    secretId: string,
    queryOptions?: IQueryOptions,
  ): Promise<number>;
  decryptSecretRecord(
    secretId: string,
    queryOptions?: IQueryOptions,
  ): Promise<SecretPayload>;
  encryptPayload(
    payload: SecretPayload,
    aad?: string | null,
    keyVersion?: number,
  ): EncryptedSecretPayload;
  decryptPayload(secretRecord: SecretRecord): SecretPayload;
}

export class SecretService implements ISecretService {
  private secretRepository: ISecretRepository;
  private encryptionPassword: string;
  private encryptionSalt: string;

  constructor({
    secretRepository,
    encryptionPassword,
    encryptionSalt,
  }: {
    secretRepository: ISecretRepository;
    encryptionPassword: string;
    encryptionSalt: string;
  }) {
    this.secretRepository = secretRepository;
    this.encryptionPassword = encryptionPassword;
    this.encryptionSalt = encryptionSalt;
  }

  public async createSecretRecord(
    input: CreateSecretRecordInput,
    queryOptions?: IQueryOptions,
  ): Promise<SecretRecord> {
    const aad =
      input.aad === undefined ? this.buildDefaultAAD(input) : input.aad ?? null;
    const encrypted = this.encryptPayload(
      input.payload,
      aad,
      input.keyVersion ?? DEFAULT_KEY_VERSION,
    );

    return await this.secretRepository.createOne(
      {
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        aad: encrypted.aad,
        keyVersion: encrypted.keyVersion,
        createdBy: input.createdBy,
      },
      queryOptions,
    );
  }

  public async updateSecretRecord(
    secretId: string,
    input: UpdateSecretRecordInput,
    queryOptions?: IQueryOptions,
  ): Promise<SecretRecord> {
    const secretRecord = await this.secretRepository.findOneBy(
      { id: secretId },
      queryOptions,
    );
    if (!secretRecord) {
      throw new Error(`Secret ${secretId} not found`);
    }

    const aad = input.aad === undefined ? secretRecord.aad ?? null : input.aad;
    const encrypted = this.encryptPayload(
      input.payload,
      aad,
      secretRecord.keyVersion,
    );

    return await this.secretRepository.updateOne(
      secretId,
      {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        aad: encrypted.aad,
        keyVersion: encrypted.keyVersion,
      },
      queryOptions,
    );
  }

  public async deleteSecretRecord(
    secretId: string,
    queryOptions?: IQueryOptions,
  ): Promise<number> {
    return await this.secretRepository.deleteOne(secretId, queryOptions);
  }

  public async decryptSecretRecord(
    secretId: string,
    queryOptions?: IQueryOptions,
  ): Promise<SecretPayload> {
    const secretRecord = await this.secretRepository.findOneBy(
      { id: secretId },
      queryOptions,
    );
    if (!secretRecord) {
      throw new Error(`Secret ${secretId} not found`);
    }

    return this.decryptPayload(secretRecord);
  }

  public encryptPayload(
    payload: SecretPayload,
    aad?: string | null,
    keyVersion = DEFAULT_KEY_VERSION,
  ): EncryptedSecretPayload {
    const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
    const cipher = crypto.createCipheriv(
      ENCRYPTION_ALGORITHM,
      this.createSecretKey(keyVersion),
      iv,
    );

    if (aad) {
      cipher.setAAD(Buffer.from(aad, 'utf8'));
    }

    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      aad: aad ?? null,
      keyVersion,
    };
  }

  public decryptPayload(secretRecord: SecretRecord): SecretPayload {
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.createSecretKey(secretRecord.keyVersion),
      Buffer.from(secretRecord.iv, 'base64'),
    );

    if (secretRecord.aad) {
      decipher.setAAD(Buffer.from(secretRecord.aad, 'utf8'));
    }

    decipher.setAuthTag(Buffer.from(secretRecord.authTag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(secretRecord.ciphertext, 'base64')),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8'));
  }

  private buildDefaultAAD(input: {
    workspaceId: string;
    scopeType: string;
    scopeId: string;
  }) {
    return JSON.stringify({
      workspaceId: input.workspaceId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    });
  }

  private createSecretKey(keyVersion: number) {
    return crypto.pbkdf2Sync(
      this.encryptionPassword,
      `${this.encryptionSalt}:${keyVersion}`,
      ENCRYPTION_ITERATIONS,
      ENCRYPTION_KEY_LENGTH,
      ENCRYPTION_DIGEST,
    );
  }
}
