import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export enum DashboardCacheRefreshStatus {
  IN_PROGRESS = 'in_progress',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export interface DashboardItemRefreshJob {
  id: number;
  hash: string;
  dashboardId: number;
  dashboardItemId: number;
  startedAt: Date;
  finishedAt: Date | null;
  status: DashboardCacheRefreshStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDashboardItemRefreshJobRepository
  extends IBasicRepository<DashboardItemRefreshJob> {}

export class DashboardItemRefreshJobRepository
  extends BaseRepository<DashboardItemRefreshJob>
  implements IDashboardItemRefreshJobRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'dashboard_item_refresh_job' });
  }
}
