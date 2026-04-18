import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface User {
  id: string;
  email: string;
  displayName: string;
  locale?: string | null;
  status: string;
  lastLoginAt?: Date | null;
  isPlatformAdmin?: boolean;
  defaultWorkspaceId?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IUserRepository extends IBasicRepository<User> {}

export class UserRepository
  extends BaseRepository<User>
  implements IUserRepository
{
  private readonly jsonColumns: string[] = [];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'user' });
  }

  protected override transformFromDBData = (data: any): User => {
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

    return transformedData as User;
  };

  protected override transformToDBData = (data: Partial<User>) => {
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
