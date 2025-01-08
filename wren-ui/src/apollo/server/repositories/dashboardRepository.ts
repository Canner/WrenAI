import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface Dashboard {
  id: number;
  projectId: number;
  name: string;
}

export interface IDashboardRepository extends IBasicRepository<Dashboard> {}

export class DashboardRepository
  extends BaseRepository<Dashboard>
  implements IDashboardRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'dashboard' });
  }
}
