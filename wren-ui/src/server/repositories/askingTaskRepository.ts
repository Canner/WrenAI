import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { AskFeedbackResult, AskResult } from '../models/adaptor';

export type AskingTaskDetail =
  | AskResult
  | (AskFeedbackResult & {
      adjustment?: boolean;
    });

export interface AskingTask {
  id: number;
  queryId: string;
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  question?: string;
  detail?: AskingTaskDetail;
  threadId?: number;
  threadResponseId?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AskingTaskRuntimeScope = Pick<
  AskingTask,
  | 'projectId'
  | 'workspaceId'
  | 'knowledgeBaseId'
  | 'kbSnapshotId'
  | 'deployHash'
>;

export interface IAskingTaskRepository extends IBasicRepository<AskingTask> {
  findByQueryId(queryId: string): Promise<AskingTask | null>;
  findUnfinishedTasks(): Promise<AskingTask[]>;
  findByQueryIdWithRuntimeScope(
    queryId: string,
    scope: AskingTaskRuntimeScope,
  ): Promise<AskingTask | null>;
  findOneByIdWithRuntimeScope(
    id: number,
    scope: AskingTaskRuntimeScope,
  ): Promise<AskingTask | null>;
}

export class AskingTaskRepository
  extends BaseRepository<AskingTask>
  implements IAskingTaskRepository
{
  private readonly jsonbColumns = ['detail'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'asking_task' });
  }

  public async findByQueryId(queryId: string): Promise<AskingTask | null> {
    return this.findOneBy({ queryId });
  }

  public async findUnfinishedTasks(): Promise<AskingTask[]> {
    const rows = await this.knex(this.tableName)
      .whereNotNull('query_id')
      .whereRaw(`COALESCE(detail->>'status', '') NOT IN (?, ?, ?)`, [
        'FINISHED',
        'FAILED',
        'STOPPED',
      ]);
    return rows.map((row) => this.transformFromDBData(row));
  }

  public async findByQueryIdWithRuntimeScope(
    queryId: string,
    scope: AskingTaskRuntimeScope,
  ): Promise<AskingTask | null> {
    return this.findOneWithRuntimeScope({ queryId }, scope);
  }

  public async findOneByIdWithRuntimeScope(
    id: number,
    scope: AskingTaskRuntimeScope,
  ): Promise<AskingTask | null> {
    return this.findOneWithRuntimeScope({ id }, scope);
  }

  private async findOneWithRuntimeScope(
    filter: Partial<Pick<AskingTask, 'id' | 'queryId'>>,
    scope: AskingTaskRuntimeScope,
  ): Promise<AskingTask | null> {
    const query = this.knex(this.tableName).where(
      this.transformToDBData(filter),
    );
    this.applyBridgeScopeField(
      query,
      scope.projectId,
      this.hasCanonicalRuntimeScope(scope),
    );
    this.applyScopeField(query, 'workspaceId', scope.workspaceId);
    this.applyScopeField(query, 'knowledgeBaseId', scope.knowledgeBaseId);
    this.applyScopeField(query, 'kbSnapshotId', scope.kbSnapshotId);
    this.applyScopeField(query, 'deployHash', scope.deployHash);

    const result = await query.first();
    return result ? this.transformFromDBData(result) : null;
  }

  private applyBridgeScopeField(
    query: Knex.QueryBuilder,
    bridgeProjectId?: number | null,
    hasCanonicalScope = false,
  ) {
    if (bridgeProjectId == null) {
      if (hasCanonicalScope) {
        return;
      }
      query.whereNull('project_id');
      return;
    }

    query.andWhere('project_id', bridgeProjectId);
  }

  private applyScopeField(
    query: Knex.QueryBuilder,
    field: Exclude<keyof AskingTaskRuntimeScope, 'projectId'>,
    value?: string | null,
  ) {
    const column = snakeCase(field);
    if (value == null) {
      query.whereNull(column);
      return;
    }

    query.andWhere(column, value);
  }

  private hasCanonicalRuntimeScope(scope: AskingTaskRuntimeScope) {
    return Boolean(
      scope.workspaceId ||
      scope.knowledgeBaseId ||
      scope.kbSnapshotId ||
      scope.deployHash,
    );
  }

  protected override transformFromDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        }
        return value;
      }
      return value;
    });
    return transformData as AskingTask;
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        return JSON.stringify(value);
      } else {
        return value;
      }
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}
