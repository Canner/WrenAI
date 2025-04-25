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
  extends IBasicRepository<DashboardCacheRefresh> {
  findLatestByDashboardId(
    dashboardId: number,
  ): Promise<DashboardCacheRefresh | null>;
  findLatestByDashboardItemId(
    dashboardItemId: number,
  ): Promise<DashboardCacheRefresh | null>;
  findInProgressByDashboardId(
    dashboardId: number,
  ): Promise<DashboardCacheRefresh[]>;
  findInProgressByDashboardItemId(
    dashboardItemId: number,
  ): Promise<DashboardCacheRefresh[]>;
  findByHash(hash: string): Promise<DashboardCacheRefresh | null>;
}

export class DashboardCacheRefreshRepository
  extends BaseRepository<DashboardCacheRefresh>
  implements IDashboardCacheRefreshRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'dashboard_cache_refresh' });
  }

  public async findLatestByDashboardId(
    dashboardId: number,
  ): Promise<DashboardCacheRefresh | null> {
    const result = await this.knex
      .table(this.tableName)
      .where({ dashboardId })
      .orderBy('createdAt', 'desc')
      .first();
    return result ? this.transformFromDBData(result) : null;
  }

  public async findLatestByDashboardItemId(
    dashboardItemId: number,
  ): Promise<DashboardCacheRefresh | null> {
    const result = await this.knex
      .table(this.tableName)
      .where({ dashboardItemId })
      .orderBy('createdAt', 'desc')
      .first();
    return result ? this.transformFromDBData(result) : null;
  }

  public async findInProgressByDashboardId(
    dashboardId: number,
  ): Promise<DashboardCacheRefresh[]> {
    const results = await this.knex
      .table(this.tableName)
      .where({
        dashboardId,
        status: DashboardCacheRefreshStatus.IN_PROGRESS,
      })
      .orderBy('createdAt', 'desc');
    return results.map((result) => this.transformFromDBData(result));
  }

  public async findInProgressByDashboardItemId(
    dashboardItemId: number,
  ): Promise<DashboardCacheRefresh[]> {
    const results = await this.knex
      .table(this.tableName)
      .where({
        dashboardItemId,
        status: DashboardCacheRefreshStatus.IN_PROGRESS,
      })
      .orderBy('createdAt', 'desc');
    return results.map((result) => this.transformFromDBData(result));
  }

  public async findByHash(hash: string): Promise<DashboardCacheRefresh | null> {
    const result = await this.knex
      .table(this.tableName)
      .where({ hash })
      .first();
    return result ? this.transformFromDBData(result) : null;
  }
}
