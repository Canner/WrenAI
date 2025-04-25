import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export enum DashboardCacheRefreshStatus {
  IN_PROGRESS = 'in_progress',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export interface DashboardCacheRefresh {
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

export interface IDashboardCacheRefreshRepository
  extends IBasicRepository<DashboardCacheRefresh> {}

export class DashboardCacheRefreshRepository
  extends BaseRepository<DashboardCacheRefresh>
  implements IDashboardCacheRefreshRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'dashboard_cache_refresh' });
  }
}
