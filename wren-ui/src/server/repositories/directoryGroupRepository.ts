import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface DirectoryGroup {
  id: string;
  workspaceId: string;
  identityProviderConfigId?: string | null;
  externalId?: string | null;
  displayName: string;
  source: string;
  status: string;
  metadata?: Record<string, any> | null;
  createdBy?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IDirectoryGroupRepository
  extends IBasicRepository<DirectoryGroup> {}

export class DirectoryGroupRepository
  extends BaseRepository<DirectoryGroup>
  implements IDirectoryGroupRepository
{
  private readonly jsonColumns = ['metadata'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'directory_group' });
  }

  protected override transformFromDBData = (data: any): DirectoryGroup => {
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

    return transformedData as DirectoryGroup;
  };

  protected override transformToDBData = (data: Partial<DirectoryGroup>) => {
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
