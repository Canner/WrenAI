import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { camelCase, isPlainObject, mapKeys, mapValues } from 'lodash';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';

export interface Deploy {
  id: number; // ID
  projectId: number; // Reference to project.id
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
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
  findLatestDeployLogByHash(
    hash: string,
    options?: {
      projectId?: number | null;
      status?: DeployStatusEnum;
    },
  ): Promise<Deploy | null>;
  findLastRuntimeDeployLog(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Deploy | null>;
  findInProgressRuntimeDeployLog(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Deploy | null>;
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

  public async findLatestDeployLogByHash(
    hash: string,
    options?: {
      projectId?: number | null;
      status?: DeployStatusEnum;
    },
  ) {
    const query = this.knex.select('*').from(this.tableName).where({ hash });

    if (options?.projectId != null) {
      query.andWhere(
        this.transformToDBData({ projectId: options.projectId }),
      );
    }

    if (options?.status) {
      query.andWhere(this.transformToDBData({ status: options.status }));
    }

    const res = await query.orderBy('created_at', 'desc').first();
    return (res && this.transformFromDBData(res)) || null;
  }

  public async findLastRuntimeDeployLog(
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return await this.findRuntimeDeployLogByStatus(
      runtimeIdentity,
      DeployStatusEnum.SUCCESS,
    );
  }

  public async findInProgressRuntimeDeployLog(
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return await this.findRuntimeDeployLogByStatus(
      runtimeIdentity,
      DeployStatusEnum.IN_PROGRESS,
    );
  }

  private async findRuntimeDeployLogByStatus(
    runtimeIdentity: PersistedRuntimeIdentity,
    status: DeployStatusEnum,
  ) {
    const lookupFields = this.resolveRuntimeLookupFields(runtimeIdentity);
    if (!lookupFields.length) {
      return null;
    }

    const query = this.knex
      .select('*')
      .from(this.tableName)
      .where(this.transformToDBData({ status }));

    for (const field of lookupFields) {
      const value = runtimeIdentity[field];
      if (value == null) {
        continue;
      }

      query.andWhere(
        field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value,
      );
    }

    const res = await query.orderBy('created_at', 'desc').first();
    return (res && this.transformFromDBData(res)) || null;
  }

  private resolveRuntimeLookupFields(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): ('workspaceId' | 'knowledgeBaseId' | 'kbSnapshotId')[] {
    if (runtimeIdentity.kbSnapshotId != null) {
      return ['kbSnapshotId'];
    }

    if (runtimeIdentity.knowledgeBaseId != null) {
      return ['knowledgeBaseId'];
    }

    if (runtimeIdentity.workspaceId != null) {
      return ['workspaceId'];
    }

    return [];
  }

  public override transformFromDBData: (data: any) => Deploy = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (['manifest'].includes(key)) {
        // Different DB drivers may surface JSON fields as either strings or objects.
        return typeof value === 'string' ? JSON.parse(value) : value;
      }
      return value;
    });
    return formattedData as Deploy;
  };
}
