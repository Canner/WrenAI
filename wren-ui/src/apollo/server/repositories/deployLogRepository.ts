import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface Deploy {
  id: number; // ID
  projectId: number; // Reference to project.id
  manifest: object; // Model manifest
  hash: string;
  status: string; // Deploy status
  error: string; // Error message
}

export enum DeployStatusEnum {
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface IDeployLogRepository extends IBasicRepository<Deploy> {
  findLastProjectDeployLog(projectId: number): Promise<Deploy | null>;
  findInProgressProjectDeployLog(projectId: number): Promise<Deploy | null>;
}

export class DeployLogRepository
  extends BaseRepository<Deploy>
  implements IDeployLogRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'deploy_log' });
  }

  public async findLastProjectDeployLog(projectId: number) {
    const res = await this.knex
      .select('*')
      .from(this.tableName)
      .where(
        this.transformToDBData({ projectId, status: DeployStatusEnum.SUCCESS }),
      )
      .orderBy('created_at', 'desc')
      .first();
    return (res && this.transformFromDBData(res)) || null;
  }

  public async findInProgressProjectDeployLog(projectId: number) {
    const res = await this.knex
      .select('*')
      .from(this.tableName)
      .where(
        this.transformToDBData({
          projectId,
          status: DeployStatusEnum.IN_PROGRESS,
        }),
      )
      .orderBy('created_at', 'desc')
      .first();
    return (res && this.transformFromDBData(res)) || null;
  }
}
