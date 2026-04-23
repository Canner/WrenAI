import { Knex } from 'knex';
import { BaseRepository, IQueryOptions } from './baseRepository';
import { AskResultStatus } from '@server/models/adaptor';
import type {
  IThreadResponseRepository,
  ThreadResponse,
  ThreadResponseAdjustment,
  ThreadResponseAnswerDetail,
  ThreadResponseBreakdownDetail,
  ThreadResponseChartDetail,
  ThreadResponseRuntimeScope,
} from './threadResponseRepositoryTypes';
import type {
  ResolvedHomeIntent,
  ResponseArtifactLineage,
} from '@/types/homeIntent';

export {
  ThreadResponseAdjustmentType,
  type DetailStep,
  type IThreadResponseRepository,
  type ThreadResponse,
  type ThreadResponseAdjustment,
  type ThreadResponseAdjustmentApplySqlPayload,
  type ThreadResponseAdjustmentReasoningPayload,
  type ThreadResponseAnswerDetail,
  type ThreadResponseBreakdownDetail,
  type ThreadResponseChartDetail,
  type ThreadResponseRuntimeScope,
} from './threadResponseRepositoryTypes';
import {
  hasCanonicalThreadResponseScope,
  hydrateJoinedThreadResponseRuntimeScope,
  transformJoinedThreadResponses,
  transformThreadResponseFromDBData,
  transformThreadResponseToDBData,
} from './threadResponseRepositoryTransforms';

export class ThreadResponseRepository
  extends BaseRepository<ThreadResponse>
  implements IThreadResponseRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread_response' });
  }

  public async getResponsesWithThread(threadId: number, limit?: number) {
    const query = this.knex(this.tableName)
      .select('thread_response.*')
      .where({ thread_id: threadId })
      .leftJoin('thread', 'thread.id', 'thread_response.thread_id');

    if (limit) {
      query.orderBy('created_at', 'desc').limit(limit);
    } else {
      query.orderBy('created_at', 'asc');
    }

    return this.transformJoinedResults(await query);
  }

  public async getResponsesWithThreadByScope(
    threadId: number,
    scope: ThreadResponseRuntimeScope,
    limit?: number,
  ): Promise<ThreadResponse[]> {
    const query = this.buildRuntimeScopedQuery(scope).where(
      `${this.tableName}.thread_id`,
      threadId,
    );

    if (limit) {
      query.orderBy(`${this.tableName}.created_at`, 'desc').limit(limit);
    } else {
      query.orderBy(`${this.tableName}.created_at`, 'asc');
    }

    return this.transformJoinedResults(await query);
  }

  public async findOneByIdWithRuntimeScope(
    id: number,
    scope: ThreadResponseRuntimeScope,
  ): Promise<ThreadResponse | null> {
    const query = this.buildRuntimeScopedQuery(scope).where(
      `${this.tableName}.id`,
      id,
    );

    const result = await query.first();
    return result ? this.transformFromDBData(result) : null;
  }

  public async findUnfinishedBreakdownResponsesByWorkspaceId(
    workspaceId: string,
  ): Promise<ThreadResponse[]> {
    const results =
      await this.buildUnfinishedBreakdownResponsesQuery().whereRaw(
        `COALESCE(${this.tableName}.workspace_id, thread.workspace_id) = ?`,
        [workspaceId],
      );

    return results.map((result) => this.hydrateJoinedRuntimeScope(result));
  }

  public async findUnfinishedBreakdownResponses(): Promise<ThreadResponse[]> {
    const results = await this.buildUnfinishedBreakdownResponsesQuery();

    return results.map((result) => this.hydrateJoinedRuntimeScope(result));
  }

  public async findUnfinishedAnswerResponses(): Promise<ThreadResponse[]> {
    const results = await this.knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        'thread.project_id AS thread_project_id',
        'thread.workspace_id AS thread_workspace_id',
        'thread.knowledge_base_id AS thread_knowledge_base_id',
        'thread.kb_snapshot_id AS thread_kb_snapshot_id',
        'thread.deploy_hash AS thread_deploy_hash',
        'thread.actor_user_id AS thread_actor_user_id',
      )
      .leftJoin('thread', 'thread.id', `${this.tableName}.thread_id`)
      .whereNotNull('answer_detail')
      .whereRaw(`COALESCE(answer_detail->>'status', '') NOT IN (?, ?, ?)`, [
        'FAILED',
        'FINISHED',
        'INTERRUPTED',
      ]);

    return results.map((result) => this.hydrateJoinedRuntimeScope(result));
  }

  public async findUnfinishedChartResponses({
    adjustment,
  }: {
    adjustment?: boolean;
  } = {}): Promise<ThreadResponse[]> {
    const query = this.knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        'thread.project_id AS thread_project_id',
        'thread.workspace_id AS thread_workspace_id',
        'thread.knowledge_base_id AS thread_knowledge_base_id',
        'thread.kb_snapshot_id AS thread_kb_snapshot_id',
        'thread.deploy_hash AS thread_deploy_hash',
        'thread.actor_user_id AS thread_actor_user_id',
      )
      .leftJoin('thread', 'thread.id', `${this.tableName}.thread_id`)
      .whereNotNull('chart_detail')
      .whereRaw(`COALESCE(chart_detail->>'status', '') NOT IN (?, ?, ?)`, [
        AskResultStatus.FAILED,
        AskResultStatus.FINISHED,
        AskResultStatus.STOPPED,
      ]);

    if (adjustment === true) {
      query.whereRaw(`COALESCE(chart_detail->>'adjustment', 'false') = 'true'`);
    } else if (adjustment === false) {
      query.whereRaw(
        `COALESCE(chart_detail->>'adjustment', 'false') <> 'true'`,
      );
    }

    const results = await query;
    return results.map((result) => this.hydrateJoinedRuntimeScope(result));
  }

  public async findUnfinishedRecommendationResponses(): Promise<
    ThreadResponse[]
  > {
    const results = await this.knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        'thread.project_id AS thread_project_id',
        'thread.workspace_id AS thread_workspace_id',
        'thread.knowledge_base_id AS thread_knowledge_base_id',
        'thread.kb_snapshot_id AS thread_kb_snapshot_id',
        'thread.deploy_hash AS thread_deploy_hash',
        'thread.actor_user_id AS thread_actor_user_id',
      )
      .leftJoin('thread', 'thread.id', `${this.tableName}.thread_id`)
      .whereNotNull('recommendation_detail')
      .whereRaw(
        `COALESCE(recommendation_detail->>'status', '') NOT IN (?, ?, ?)`,
        ['FAILED', 'FINISHED', 'NOT_STARTED'],
      );

    return results.map((result) => this.hydrateJoinedRuntimeScope(result));
  }

  private buildUnfinishedBreakdownResponsesQuery() {
    return this.knex(this.tableName)
      .select(
        `${this.tableName}.*`,
        'thread.project_id AS thread_project_id',
        'thread.workspace_id AS thread_workspace_id',
        'thread.knowledge_base_id AS thread_knowledge_base_id',
        'thread.kb_snapshot_id AS thread_kb_snapshot_id',
        'thread.deploy_hash AS thread_deploy_hash',
        'thread.actor_user_id AS thread_actor_user_id',
      )
      .leftJoin('thread', 'thread.id', `${this.tableName}.thread_id`)
      .whereNotNull('breakdown_detail')
      .whereRaw(`COALESCE(breakdown_detail->>'status', '') NOT IN (?, ?, ?)`, [
        AskResultStatus.FAILED,
        AskResultStatus.FINISHED,
        AskResultStatus.STOPPED,
      ]);
  }

  private buildRuntimeScopedQuery(scope: ThreadResponseRuntimeScope) {
    const query = this.knex(this.tableName)
      .select(`${this.tableName}.*`)
      .leftJoin('thread', 'thread.id', `${this.tableName}.thread_id`);

    this.applyCoalescedBridgeScope(
      query,
      scope.projectId,
      this.hasCanonicalScope(scope),
    );

    this.applyCoalescedScopeField(
      query,
      'workspace_id',
      'workspace_id',
      scope.workspaceId,
    );
    this.applyCoalescedScopeField(
      query,
      'knowledge_base_id',
      'knowledge_base_id',
      scope.knowledgeBaseId,
    );
    this.applyCoalescedScopeField(
      query,
      'kb_snapshot_id',
      'kb_snapshot_id',
      scope.kbSnapshotId,
    );
    this.applyCoalescedScopeField(
      query,
      'deploy_hash',
      'deploy_hash',
      scope.deployHash,
    );

    return query;
  }

  private applyCoalescedBridgeScope(
    query: Knex.QueryBuilder,
    bridgeProjectId?: number | null,
    hasCanonicalScope = false,
  ) {
    const expr = `COALESCE(${this.tableName}.project_id, thread.project_id)`;
    if (bridgeProjectId == null) {
      if (hasCanonicalScope) {
        return;
      }
      query.andWhereRaw(`${expr} IS NULL`);
      return;
    }

    query.andWhereRaw(`${expr} = ?`, [bridgeProjectId]);
  }

  private transformJoinedResults(results: any[]): ThreadResponse[] {
    return transformJoinedThreadResponses(results);
  }

  private applyCoalescedScopeField(
    query: Knex.QueryBuilder,
    responseColumn: string,
    threadColumn: string,
    value?: string | null,
  ) {
    const expr = `COALESCE(${this.tableName}.${responseColumn}, thread.${threadColumn})`;
    if (value == null) {
      query.andWhereRaw(`${expr} IS NULL`);
      return;
    }

    query.andWhereRaw(`${expr} = ?`, [value]);
  }

  private hasCanonicalScope(scope: ThreadResponseRuntimeScope) {
    return hasCanonicalThreadResponseScope(scope);
  }

  public async updateOne(
    id: string | number,
    data: Partial<{
      status: AskResultStatus;
      responseKind: string | null;
      sql: string;
      sourceResponseId: number | null;
      resolvedIntent: ResolvedHomeIntent | null;
      artifactLineage: ResponseArtifactLineage | null;
      viewId: number;
      answerDetail: ThreadResponseAnswerDetail;
      breakdownDetail: ThreadResponseBreakdownDetail;
      chartDetail: ThreadResponseChartDetail;
      adjustment: ThreadResponseAdjustment;
    }>,
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const [result] = await executer(this.tableName)
      .where({ id })
      .update(this.transformToDBData(data as any))
      .returning('*');
    return this.transformFromDBData(result);
  }

  public async updateOneByIdWithRuntimeScope(
    id: number,
    scope: ThreadResponseRuntimeScope,
    data: Partial<{
      status: AskResultStatus;
      responseKind: string | null;
      sql: string;
      sourceResponseId: number | null;
      resolvedIntent: ResolvedHomeIntent | null;
      artifactLineage: ResponseArtifactLineage | null;
      viewId: number;
      answerDetail: ThreadResponseAnswerDetail;
      breakdownDetail: ThreadResponseBreakdownDetail;
      chartDetail: ThreadResponseChartDetail;
      adjustment: ThreadResponseAdjustment;
    }>,
    queryOptions?: IQueryOptions,
  ): Promise<ThreadResponse | null> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const scopedIdQuery = executer(this.tableName)
      .select(`${this.tableName}.id`)
      .leftJoin('thread', 'thread.id', `${this.tableName}.thread_id`)
      .where(`${this.tableName}.id`, id);

    this.applyCoalescedBridgeScope(
      scopedIdQuery,
      scope.projectId,
      this.hasCanonicalScope(scope),
    );
    this.applyCoalescedScopeField(
      scopedIdQuery,
      'workspace_id',
      'workspace_id',
      scope.workspaceId,
    );
    this.applyCoalescedScopeField(
      scopedIdQuery,
      'knowledge_base_id',
      'knowledge_base_id',
      scope.knowledgeBaseId,
    );
    this.applyCoalescedScopeField(
      scopedIdQuery,
      'kb_snapshot_id',
      'kb_snapshot_id',
      scope.kbSnapshotId,
    );
    this.applyCoalescedScopeField(
      scopedIdQuery,
      'deploy_hash',
      'deploy_hash',
      scope.deployHash,
    );

    const [result] = await executer(this.tableName)
      .whereIn('id', scopedIdQuery)
      .update(this.transformToDBData(data as any))
      .returning('*');

    return result ? this.transformFromDBData(result) : null;
  }

  public async claimChartPollingLease(
    id: number,
    scope: ThreadResponseRuntimeScope,
    workerId: string,
    leaseExpiresAt: string,
    queryOptions?: IQueryOptions,
  ): Promise<ThreadResponse | null> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const scopedIdQuery = executer(this.tableName)
      .select(`${this.tableName}.id`)
      .leftJoin('thread', 'thread.id', `${this.tableName}.thread_id`)
      .where(`${this.tableName}.id`, id)
      .whereNotNull(`${this.tableName}.chart_detail`)
      .whereRaw(
        `(
          NULLIF(${this.tableName}.chart_detail->>'pollingLeaseExpiresAt', '')::timestamptz IS NULL
          OR NULLIF(${this.tableName}.chart_detail->>'pollingLeaseExpiresAt', '')::timestamptz <= now()
          OR ${this.tableName}.chart_detail->>'pollingLeaseOwner' = ?
        )`,
        [workerId],
      );

    this.applyCoalescedBridgeScope(
      scopedIdQuery,
      scope.projectId,
      this.hasCanonicalScope(scope),
    );
    this.applyCoalescedScopeField(
      scopedIdQuery,
      'workspace_id',
      'workspace_id',
      scope.workspaceId,
    );
    this.applyCoalescedScopeField(
      scopedIdQuery,
      'knowledge_base_id',
      'knowledge_base_id',
      scope.knowledgeBaseId,
    );
    this.applyCoalescedScopeField(
      scopedIdQuery,
      'kb_snapshot_id',
      'kb_snapshot_id',
      scope.kbSnapshotId,
    );
    this.applyCoalescedScopeField(
      scopedIdQuery,
      'deploy_hash',
      'deploy_hash',
      scope.deployHash,
    );

    const [result] = await executer(this.tableName)
      .whereIn('id', scopedIdQuery)
      .update({
        chart_detail: executer.raw(
          `jsonb_set(
            jsonb_set(
              COALESCE(chart_detail, '{}'::jsonb),
              '{pollingLeaseOwner}',
              to_jsonb(?::text),
              true
            ),
            '{pollingLeaseExpiresAt}',
            to_jsonb(?::text),
            true
          )`,
          [workerId, leaseExpiresAt],
        ),
      })
      .returning('*');

    return result ? this.transformFromDBData(result) : null;
  }

  protected override transformToDBData = (data: any) => {
    return transformThreadResponseToDBData(data);
  };

  protected override transformFromDBData = (data: any): ThreadResponse => {
    return transformThreadResponseFromDBData(data);
  };

  private hydrateJoinedRuntimeScope(data: any): ThreadResponse {
    return hydrateJoinedThreadResponseRuntimeScope(data);
  }
}
