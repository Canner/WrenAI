import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import {
  ConnectionSchemaChange,
  ConnectionSchemaResolve,
} from '@server/managers/connectionSchemaDetector';

export interface SchemaChange {
  id: number; // ID
  projectId: number; // Reference to project.id
  change: ConnectionSchemaChange; // Schema change
  resolve: ConnectionSchemaResolve; // Save resolve
  createdAt: string; // Created at
  updateAt: string; // Updated at
}

export interface ISchemaChangeRepository
  extends IBasicRepository<SchemaChange> {
  findLastSchemaChange(projectId: number): Promise<SchemaChange | null>;
}

export class SchemaChangeRepository
  extends BaseRepository<SchemaChange>
  implements ISchemaChangeRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'schema_change' });
  }

  public async findLastSchemaChange(projectId: number) {
    const res = await this.knex
      .select('*')
      .from(this.tableName)
      .where(this.transformToDBData({ projectId }))
      .orderBy('created_at', 'desc')
      .first();
    return (res && this.transformFromDBData(res)) || null;
  }

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (['change', 'resolve'].includes(key)) {
        return value ? JSON.stringify(value) : null;
      }
      return value;
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };

  protected override transformFromDBData = (data: any): SchemaChange => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (['change', 'resolve'].includes(key)) {
        // Older stringified payloads are still parsed for compatibility;
        // PostgreSQL jsonb rows already return objects.
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    }) as SchemaChange;
    return formattedData;
  };
}
