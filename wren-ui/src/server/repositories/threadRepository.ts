import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface ThreadRecommendationQuestionResult {
  question: string;
  category?: string | null;
  sql: string;
}

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

  // recommend question
  queryId?: string; // Query ID
  questions?: ThreadRecommendationQuestionResult[]; // Recommended questions
  questionsStatus?: string; // Status of the recommended questions
  questionsError?: object; // Error of the recommended questions
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
  private readonly jsonbColumns = [
    'questions',
    'questionsError',
    'knowledgeBaseIds',
    'selectedSkillIds',
  ];

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
    const query = this.knex(this.tableName);
    const isWorkspaceWideQuery = this.isWorkspaceWideScope(scope);

    this.applyBridgeScopeField(
      query,
      scope.projectId,
      this.hasCanonicalScope(scope),
    );

    this.applyScopeField(query, 'workspaceId', scope.workspaceId);
    if (!isWorkspaceWideQuery) {
      this.applyScopeField(query, 'knowledgeBaseId', scope.knowledgeBaseId);
      this.applyScopeField(query, 'kbSnapshotId', scope.kbSnapshotId);
      this.applyScopeField(query, 'deployHash', scope.deployHash);
    }

    return query;
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
