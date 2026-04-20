import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface AuthIdentity {
  id: string;
  userId: string;
  providerType: string;
  providerSubject: string;
  identityProviderConfigId?: string | null;
  issuer?: string | null;
  externalSubject?: string | null;
  passwordHash?: string | null;
  passwordAlgo?: string | null;
  emailVerifiedAt?: Date | null;
  metadata?: Record<string, any> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IAuthIdentityRepository extends IBasicRepository<AuthIdentity> {}

export class AuthIdentityRepository
  extends BaseRepository<AuthIdentity>
  implements IAuthIdentityRepository
{
  private readonly jsonColumns = ['metadata'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'auth_identity' });
  }

  protected override transformFromDBData = (data: any): AuthIdentity => {
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

    return transformedData as AuthIdentity;
  };

  protected override transformToDBData = (data: Partial<AuthIdentity>) => {
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
