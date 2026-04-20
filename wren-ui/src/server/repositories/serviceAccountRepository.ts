import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface ServiceAccount {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  roleKey: string;
  status: string;
  createdBy?: string | null;
  lastUsedAt?: Date | string | null;
  metadata?: Record<string, any> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IServiceAccountRepository extends IBasicRepository<ServiceAccount> {}

export class ServiceAccountRepository
  extends BaseRepository<ServiceAccount>
  implements IServiceAccountRepository
{
  private readonly jsonColumns = ['metadata'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'service_account' });
  }

  protected override transformFromDBData = (data: any): ServiceAccount => {
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

    return transformedData as ServiceAccount;
  };

  protected override transformToDBData = (data: Partial<ServiceAccount>) => {
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
