import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

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
}
