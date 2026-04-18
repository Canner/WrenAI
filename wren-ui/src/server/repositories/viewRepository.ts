import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';

export interface View {
  id: number; // ID
  projectId?: number | null; // Reference to project.id
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  name: string; // The view name
  statement: string; // The SQL statement of this view
  cached: boolean; // View is cached or not
  refreshTime?: string; // Contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"
  properties?: string; // View properties, a json string, the description and displayName should be stored here
}

export interface IViewRepository extends IBasicRepository<View> {
  findAllByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<View[]>;
  findOneByIdWithRuntimeIdentity(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<View | null>;
}

export class ViewRepository
  extends BaseRepository<View>
  implements IViewRepository
{
  private readonly canonicalScopeFields: (
    | 'workspaceId'
    | 'knowledgeBaseId'
    | 'kbSnapshotId'
    | 'deployHash'
  )[] = ['workspaceId', 'knowledgeBaseId', 'kbSnapshotId', 'deployHash'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'view' });
  }

  public async findAllByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<View[]> {
    const query = this.buildRuntimeScopedQuery(runtimeIdentity);
    const rows = await query;
    return rows.map((row) => this.transformFromDBData(row));
  }

  public async findOneByIdWithRuntimeIdentity(
    id: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<View | null> {
    const query = this.buildRuntimeScopedQuery(runtimeIdentity).where({ id });
    const row = await query.first();
    return row ? this.transformFromDBData(row) : null;
  }

  private buildRuntimeScopedQuery(runtimeIdentity: PersistedRuntimeIdentity) {
    const query = this.knex(this.tableName);

    this.applyBridgeScopeField(
      query,
      runtimeIdentity.projectId ?? null,
      this.hasCanonicalRuntimeScope(runtimeIdentity),
    );
    this.applyScopeField(
      query,
      'workspaceId',
      runtimeIdentity.workspaceId ?? null,
    );
    this.applyScopeField(
      query,
      'knowledgeBaseId',
      runtimeIdentity.knowledgeBaseId ?? null,
    );
    this.applyScopeField(
      query,
      'kbSnapshotId',
      runtimeIdentity.kbSnapshotId ?? null,
    );
    this.applyScopeField(
      query,
      'deployHash',
      runtimeIdentity.deployHash ?? null,
    );

    return query;
  }

  private hasCanonicalRuntimeScope(runtimeIdentity: PersistedRuntimeIdentity) {
    return this.canonicalScopeFields.some(
      (field) => runtimeIdentity[field] != null,
    );
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
    field: 'workspaceId' | 'knowledgeBaseId' | 'kbSnapshotId' | 'deployHash',
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
