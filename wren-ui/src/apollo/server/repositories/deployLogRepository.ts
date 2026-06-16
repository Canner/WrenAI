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
  createdAt?: Date;
  updatedAt?: Date;
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
  private hasIdentityIdPromise?: Promise<boolean>;

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'deploy_log' });
  }

  public async createOne(data: Partial<Deploy>): Promise<Deploy> {
    if (!this.isMssql() || (await this.hasIdentityId())) {
      return super.createOne(this.withTimestamps(data));
    }

    const id = await this.nextDeployLogId();
    return super.createOne(this.withTimestamps({ id, ...data }));
  }

  public async updateOne(id: number, data: Partial<Deploy>) {
    return super.updateOne(id, {
      ...data,
      updatedAt: data.updatedAt ?? new Date(),
    });
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

  private isMssql = () =>
    String(this.knex.client.config.client || '').toLowerCase() === 'mssql';

  private withTimestamps = (data: Partial<Deploy>): Partial<Deploy> => {
    const now = new Date();
    return {
      ...data,
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
    };
  };

  private async hasIdentityId() {
    this.hasIdentityIdPromise ??= this.knex('sys.columns as c')
      .join('sys.tables as t', 'c.object_id', 't.object_id')
      .where('t.name', this.tableName)
      .where('c.name', 'id')
      .select(
        this.knex.raw(
          'COLUMNPROPERTY(c.object_id, c.name, ?) as isIdentity',
          ['IsIdentity'],
        ),
      )
      .first()
      .then((row) => Number(row?.isIdentity ?? 0) === 1);

    return this.hasIdentityIdPromise;
  }

  private async nextDeployLogId() {
    const row = await this.knex(this.tableName)
      .max<{ maxId?: number | string }>('id as maxId')
      .first();

    return Number(row?.maxId ?? 0) + 1;
  }
}
