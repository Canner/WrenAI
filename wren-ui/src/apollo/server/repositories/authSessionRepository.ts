import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface AuthSession {
  id: string;
  userId: string;
  authIdentityId: string;
  sessionTokenHash: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  lastSeenAt?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  impersonatorUserId?: string | null;
  impersonationReason?: string | null;
}

export interface IAuthSessionRepository extends IBasicRepository<AuthSession> {}

export class AuthSessionRepository
  extends BaseRepository<AuthSession>
  implements IAuthSessionRepository
{
  private readonly jsonColumns: string[] = [];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'auth_session' });
  }

  protected override transformFromDBData = (data: any): AuthSession => {
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

    return transformedData as AuthSession;
  };

  protected override transformToDBData = (data: Partial<AuthSession>) => {
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
