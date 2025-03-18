import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface SqlPair {
  id: number; // ID
  projectId: number; // Reference to project.id
  sql: string; // SQL query
  question: string; // Natural language question
  createdAt?: string; // Date and time when the SQL pair was created
  updatedAt?: string; // Date and time when the SQL pair was last updated
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
