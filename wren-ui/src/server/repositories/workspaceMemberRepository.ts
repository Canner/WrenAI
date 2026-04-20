import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  roleKey: string;
  status: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IWorkspaceMemberRepository extends IBasicRepository<WorkspaceMember> {}

export class WorkspaceMemberRepository
  extends BaseRepository<WorkspaceMember>
  implements IWorkspaceMemberRepository
{
  private readonly jsonColumns: string[] = [];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'workspace_member' });
  }

  protected override transformFromDBData = (data: any): WorkspaceMember => {
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

    return transformedData as WorkspaceMember;
  };

  protected override transformToDBData = (data: Partial<WorkspaceMember>) => {
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
