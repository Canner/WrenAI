import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { normalizeCanonicalPersistedRuntimeIdentity } from '@server/utils/persistedRuntimeIdentity';

export interface Thread {
  id: number; // ID
  projectId?: number | null; // Compatibility-scope fallback field
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  knowledgeBaseIds?: string[] | null;
  selectedSkillIds?: string[] | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  summary: string; // Thread summary
}

export type ThreadRuntimeScope = {
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
};

export interface IThreadRepository extends IBasicRepository<Thread> {
  findOneByIdWithRuntimeScope(
    id: number,
    scope: ThreadRuntimeScope,
  ): Promise<Thread | null>;
  listAllTimeDescOrderByScope(scope: ThreadRuntimeScope): Promise<Thread[]>;
}

export class ThreadRepository
  extends BaseRepository<Thread>
  implements IThreadRepository
{
  private readonly jsonbColumns = ['knowledgeBaseIds', 'selectedSkillIds'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread' });
  }

  public async findOneByIdWithRuntimeScope(
    id: number,
    scope: ThreadRuntimeScope,
  ): Promise<Thread | null> {
    const query = this.buildRuntimeScopedQuery(scope).where({ id });
    const thread = await query.first();
    return thread ? this.transformFromDBData(thread) : null;
  }

  public async listAllTimeDescOrderByScope(
    scope: ThreadRuntimeScope,
  ): Promise<Thread[]> {
    const query = this.buildRuntimeScopedQuery(scope);
    const threads = await query.orderBy('created_at', 'desc');
    return threads.map((thread) => this.transformFromDBData(thread));
  }

  private buildRuntimeScopedQuery(scope: ThreadRuntimeScope) {
    const normalizedScope = this.normalizeRuntimeScope(scope);
    const query = this.knex(this.tableName);
    const isWorkspaceWideQuery = this.isWorkspaceWideScope(normalizedScope);

    this.applyBridgeScopeField(
      query,
      normalizedScope.projectId,
      this.hasCanonicalScope(normalizedScope),
    );

    this.applyScopeField(query, 'workspaceId', normalizedScope.workspaceId);
    if (!isWorkspaceWideQuery) {
      this.applyScopeField(
        query,
        'knowledgeBaseId',
        normalizedScope.knowledgeBaseId,
      );
      this.applyScopeField(query, 'kbSnapshotId', normalizedScope.kbSnapshotId);
      this.applyScopeField(query, 'deployHash', normalizedScope.deployHash);
    }

    return query;
  }

  private normalizeRuntimeScope(scope: ThreadRuntimeScope): ThreadRuntimeScope {
    return normalizeCanonicalPersistedRuntimeIdentity({
      projectId: scope.projectId ?? null,
      workspaceId: scope.workspaceId ?? null,
      knowledgeBaseId: scope.knowledgeBaseId ?? null,
      kbSnapshotId: scope.kbSnapshotId ?? null,
      deployHash: scope.deployHash ?? null,
    });
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
    field: keyof Omit<ThreadRuntimeScope, 'projectId'>,
    value?: string | null,
  ) {
    const column = snakeCase(field);
    if (value == null) {
      query.whereNull(column);
      return;
    }

    query.andWhere(column, value);
  }

  private hasCanonicalScope(scope: ThreadRuntimeScope) {
    return Boolean(
      scope.workspaceId ||
      scope.knowledgeBaseId ||
      scope.kbSnapshotId ||
      scope.deployHash,
    );
  }

  private isWorkspaceWideScope(scope: ThreadRuntimeScope) {
    return Boolean(
      scope.workspaceId &&
      !scope.knowledgeBaseId &&
      !scope.kbSnapshotId &&
      !scope.deployHash,
    );
  }

  protected override transformFromDBData = (data: any): Thread => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    });
    return transformData as Thread;
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
