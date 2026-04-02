import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  status: string;
  settings?: Record<string, any> | null;
  createdBy?: string | null;
}

export interface IWorkspaceRepository extends IBasicRepository<Workspace> {}

export class WorkspaceRepository
  extends BaseRepository<Workspace>
  implements IWorkspaceRepository
{
  private readonly jsonColumns = ['settings'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'workspace' });
  }

  protected override transformFromDBData = (data: any): Workspace => {
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

    return transformedData as Workspace;
  };

  protected override transformToDBData = (data: Partial<Workspace>) => {
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
