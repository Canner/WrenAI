import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface ApiToken {
  id: string;
  workspaceId: string;
  serviceAccountId?: string | null;
  userId?: string | null;
  name: string;
  prefix: string;
  tokenHash: string;
  scopeType: string;
  scopeId: string;
  expiresAt?: Date | string | null;
  revokedAt?: Date | string | null;
  lastUsedAt?: Date | string | null;
  status: string;
  createdBy?: string | null;
  metadata?: Record<string, any> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IApiTokenRepository extends IBasicRepository<ApiToken> {}

export class ApiTokenRepository
  extends BaseRepository<ApiToken>
  implements IApiTokenRepository
{
  private readonly jsonColumns = ['metadata'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'api_token' });
  }

  protected override transformFromDBData = (data: any): ApiToken => {
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

    return transformedData as ApiToken;
  };

  protected override transformToDBData = (data: Partial<ApiToken>) => {
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
