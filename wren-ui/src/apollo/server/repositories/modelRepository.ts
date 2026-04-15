import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';

export interface Model {
  id: number; // ID
  projectId?: number | null; // Reference to project.id
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  displayName: string; // Model name displayed in UI
  sourceTableName: string; // the table name in the datasource
  referenceName: string; // the name used in the MDL structure
  refSql: string; // Reference SQL
  cached: boolean; // Model is cached or not
  refreshTime: string | null; // Contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"
  properties: string | null; // Model properties, a json string, the description and displayName should be stored here
}

export interface IModelRepository extends IBasicRepository<Model> {
  findAllByIds(ids: number[]): Promise<Model[]>;
  findAllByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Model[]>;
  findAllByIdsWithRuntimeIdentity(
    ids: number[],
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Model[]>;
  deleteAllBySourceTableNames(
    sourceTableNames: string[],
    queryOptions?: IQueryOptions,
  ): Promise<number>;
}

export class ModelRepository
  extends BaseRepository<Model>
  implements IModelRepository
{
  private readonly canonicalScopeFields: (
    | 'workspaceId'
    | 'knowledgeBaseId'
    | 'kbSnapshotId'
    | 'deployHash'
  )[] = ['workspaceId', 'knowledgeBaseId', 'kbSnapshotId', 'deployHash'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'model' });
  }
  public async findAllByIds(ids: number[]) {
    const res = await this.knex<Model>(this.tableName).whereIn('id', ids);
    return res.map((r) => this.transformFromDBData(r));
  }

  public async findAllByRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Model[]> {
    const query = this.buildRuntimeScopedQuery(runtimeIdentity);
    const rows = await query;
    return rows.map((row) => this.transformFromDBData(row));
  }

  public async findAllByIdsWithRuntimeIdentity(
    ids: number[],
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Model[]> {
    const query = this.buildRuntimeScopedQuery(runtimeIdentity).whereIn(
      'id',
      ids,
    );
    const rows = await query;
    return rows.map((row) => this.transformFromDBData(row));
  }

  public async deleteAllBySourceTableNames(
    sourceTableNames: string[],
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const builder = executer(this.tableName)
      .whereIn('source_table_name', sourceTableNames)
      .delete();
    return await builder;
  }

  private buildRuntimeScopedQuery(runtimeIdentity: PersistedRuntimeIdentity) {
    const query = this.knex<Model>(this.tableName);

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
