import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { camelCase, isPlainObject, mapKeys, snakeCase } from 'lodash';

export interface SqlPair {
  id: number; // ID
  projectId: number; // Reference to project.id
  sql: string; // SQL query
  question: string; // Natural language question
}

export interface ISqlPairRepository extends IBasicRepository<SqlPair> {}

export class SqlPairRepository
  extends BaseRepository<SqlPair>
  implements ISqlPairRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'sql_pair' });
  }

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    return mapKeys(data, (_value, key) => snakeCase(key));
  };

  protected override transformFromDBData = (data: any): SqlPair => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    return mapKeys(data, (_value, key) => camelCase(key)) as SqlPair;
  };
}
