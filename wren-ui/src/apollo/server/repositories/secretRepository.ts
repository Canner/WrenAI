import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface SecretRecord {
  id: string;
  workspaceId: string;
  scopeType: string;
  scopeId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  aad?: string | null;
  keyVersion: number;
  createdBy?: string | null;
}

export interface ISecretRepository extends IBasicRepository<SecretRecord> {}

export class SecretRepository
  extends BaseRepository<SecretRecord>
  implements ISecretRepository
{
  private readonly jsonColumns = [];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'secret_record' });
  }

  protected override transformFromDBData = (data: any): SecretRecord => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformedData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonColumns.includes(key) && typeof value === 'string') {
        return value ? JSON.parse(value) : value;
      }
      return value;
    });

    return transformedData as SecretRecord;
  };

  protected override transformToDBData = (data: Partial<SecretRecord>) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonColumns.includes(key) && typeof value !== 'string') {
        return JSON.stringify(value);
      }
      return value;
    });

    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}
