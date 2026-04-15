import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
export interface SqlPair {
  id: number; // ID
  projectId?: number | null; // Reference to project.id
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  sql: string; // SQL query
  question: string; // Natural language question
  createdAt?: string; // Date and time when the SQL pair was created
  updatedAt?: string; // Date and time when the SQL pair was last updated
}

export type SqlPairRuntimeScope = Pick<
  SqlPair,
  | 'projectId'
  | 'workspaceId'
  | 'knowledgeBaseId'
  | 'kbSnapshotId'
  | 'deployHash'
>;

export interface ISqlPairRepository extends IBasicRepository<SqlPair> {
  findAllByRuntimeIdentity(
    runtimeIdentity: SqlPairRuntimeScope,
  ): Promise<SqlPair[]>;
  findOneByIdWithRuntimeIdentity(
    id: number,
    runtimeIdentity: SqlPairRuntimeScope,
  ): Promise<SqlPair | null>;
}

export class SqlPairRepository
  extends BaseRepository<SqlPair>
  implements ISqlPairRepository
{
  private readonly canonicalScopeFields: (keyof SqlPairRuntimeScope)[] = [
    'workspaceId',
    'knowledgeBaseId',
    'kbSnapshotId',
    'deployHash',
  ];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'sql_pair' });
  }

  public async findAllByRuntimeIdentity(
    runtimeIdentity: SqlPairRuntimeScope,
  ): Promise<SqlPair[]> {
    const query = this.buildRuntimeScopedQuery(runtimeIdentity);
    const rows = await query;
    return rows.map((row) => this.transformFromDBData(row));
  }

  public async findOneByIdWithRuntimeIdentity(
    id: number,
    runtimeIdentity: SqlPairRuntimeScope,
  ): Promise<SqlPair | null> {
    const query = this.buildRuntimeScopedQuery(runtimeIdentity).where({ id });
    const row = await query.first();
    return row ? this.transformFromDBData(row) : null;
  }

  private buildRuntimeScopedQuery(scope: SqlPairRuntimeScope) {
    const query = this.knex(this.tableName);

    this.applyBridgeScopeField(
      query,
      scope.projectId,
      this.hasCanonicalRuntimeScope(scope),
    );
    this.applyScopeField(query, 'workspaceId', scope.workspaceId);
    this.applyScopeField(query, 'knowledgeBaseId', scope.knowledgeBaseId);
    this.applyScopeField(query, 'kbSnapshotId', scope.kbSnapshotId);
    this.applyScopeField(query, 'deployHash', scope.deployHash);

    return query;
  }

  private hasCanonicalRuntimeScope(scope: SqlPairRuntimeScope) {
    return this.canonicalScopeFields.some((field) => scope[field] != null);
  }

  private applyBridgeScopeField(
    query: Knex.QueryBuilder,
    bridgeProjectId?: number | null,
    hasCanonicalScope = false,
  ) {
    if (hasCanonicalScope) {
      return;
    }

    if (bridgeProjectId == null) {
      query.whereNull('project_id');
      return;
    }

    query.andWhere('project_id', bridgeProjectId);
  }

  private applyScopeField(
    query: Knex.QueryBuilder,
    field: Exclude<keyof SqlPairRuntimeScope, 'projectId'>,
    value?: string | null,
  ) {
    const column = field.replace(
      /[A-Z]/g,
      (letter) => `_${letter.toLowerCase()}`,
    );
    if (value == null) {
      query.whereNull(column);
      return;
    }

    query.andWhere(column, value);
  }
}
