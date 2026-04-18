import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface SSOSession {
  id: string;
  state: string;
  workspaceId: string;
  identityProviderConfigId: string;
  redirectTo?: string | null;
  codeVerifier: string;
  nonce: string;
  providerRequestId?: string | null;
  providerStateJson?: Record<string, any> | null;
  expiresAt: Date | string;
  consumedAt?: Date | string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface ISSOSessionRepository extends IBasicRepository<SSOSession> {}

export class SSOSessionRepository
  extends BaseRepository<SSOSession>
  implements ISSOSessionRepository
{
  private readonly jsonColumns = ['providerStateJson'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'sso_session' });
  }

  protected override transformFromDBData = (data: any): SSOSession => {
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

    return transformedData as SSOSession;
  };

  protected override transformToDBData = (data: Partial<SSOSession>) => {
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
