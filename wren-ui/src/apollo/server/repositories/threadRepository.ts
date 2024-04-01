import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface Thread {
  id: number; // ID
  projectId: number; // Reference to project.id
  sql: string; // SQL
  summary: string; // Thread summary
}

export interface IThreadRepository extends IBasicRepository<Thread> {}

export class ThreadRepository
  extends BaseRepository<Thread>
  implements IThreadRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread' });
  }
}
