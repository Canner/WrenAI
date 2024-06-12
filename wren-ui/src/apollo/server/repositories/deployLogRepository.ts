import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { camelCase, isPlainObject, mapKeys, mapValues } from 'lodash';

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

  public override transformFromDBData: (data: any) => Deploy = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (['manifest'].includes(key)) {
        // sqlite return a string for json field, but postgres return an object
        return typeof value === 'string' ? JSON.parse(value) : value;
      }
      return value;
    });
    return formattedData as Deploy;
  };
}
