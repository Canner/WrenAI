import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';

export interface ModelColumn {
  id: number; // ID
  modelId: number; // Reference to model ID
  isCalculated: boolean; // Is calculated field
  displayName: string; // Column name displayed in UI
  referenceName: string; // The name used in the MDL structure and when querying the data
  sourceColumnName: string; // The column name in the datasource
  aggregation?: string; // Expression for the column, could be custom field or calculated field expression
  lineage?: string; // The selected field in calculated field, array of ids
  customExpression?: string; // For custom field or custom expression of calculated field
  type: string; // Data type, refer to the column type in the datasource
  notNull: boolean; // Is not null
  isPk: boolean; // Is primary key of the table
  properties?: string; // Column properties, a json string, the description and displayName should be stored here
}

export interface IModelColumnRepository extends IBasicRepository<ModelColumn> {
  findColumnsByModelIds(
    modelIds: number[],
    queryOptions?: IQueryOptions,
  ): Promise<ModelColumn[]>;
  findColumnsByIds(
    ids: number[],
    queryOptions?: IQueryOptions,
  ): Promise<ModelColumn[]>;
  deleteByModelIds(
    modelIds: number[],
    queryOptions?: IQueryOptions,
  ): Promise<void>;
  resetModelPrimaryKey(modelId: number): Promise<void>;
  setModelPrimaryKey(modelId: number, sourceColumnName: string): Promise<void>;
  deleteAllBySourceColumnNames(
    modelId: number,
    sourceColumnNames: string[],
    queryOptions?: IQueryOptions,
  ): Promise<number>;
  deleteAllByColumnIds(
    columnIds: number[],
    queryOptions?: IQueryOptions,
  ): Promise<void>;
}

export class ModelColumnRepository
  extends BaseRepository<ModelColumn>
  implements IModelColumnRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'model_column' });
  }

  public async findColumnsByModelIds(modelIds, queryOptions?: IQueryOptions) {
    if (queryOptions && queryOptions.tx) {
      const { tx } = queryOptions;
      const result = await tx(this.tableName)
        .whereIn('model_id', modelIds)
        .select('*');
      return result.map((r) => this.transformFromDBData(r));
    }
    const result = await this.knex<ModelColumn>('model_column')
      .whereIn('model_id', modelIds)
      .select('*');
    return result.map((r) => this.transformFromDBData(r));
  }

  public async findColumnsByIds(ids: number[], queryOptions?: IQueryOptions) {
    if (queryOptions && queryOptions.tx) {
      const { tx } = queryOptions;
      const result = await tx(this.tableName).whereIn('id', ids).select('*');
      return result.map((r) => this.transformFromDBData(r));
    }
    const result = await this.knex<ModelColumn>('model_column')
      .whereIn('id', ids)
      .select('*');
    return result.map((r) => this.transformFromDBData(r));
  }

  public async deleteByModelIds(
    modelIds: number[],
    queryOptions?: IQueryOptions,
  ) {
    if (queryOptions && queryOptions.tx) {
      const { tx } = queryOptions;
      await tx(this.tableName).whereIn('model_id', modelIds).delete();
      return;
    }
    await this.knex<ModelColumn>('model_column')
      .whereIn('model_id', modelIds)
      .delete();
  }

  public async resetModelPrimaryKey(modelId: number) {
    await this.knex<ModelColumn>('model_column')
      .where(this.transformToDBData({ modelId }))
      .update(this.transformToDBData({ isPk: false }));
  }
  public async setModelPrimaryKey(modelId: number, sourceColumnName: string) {
    await this.knex<ModelColumn>('model_column')
      .where(this.transformToDBData({ modelId, sourceColumnName }))
      .update(this.transformToDBData({ isPk: true }));
  }

  public async deleteAllBySourceColumnNames(
    modelId: number,
    sourceColumnNames: string[],
    queryOptions?: IQueryOptions,
  ): Promise<number> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const builder = executer(this.tableName)
      .where(this.transformToDBData({ modelId }))
      .whereIn('source_column_name', sourceColumnNames)
      .delete();
    return await builder;
  }

  public async deleteAllByColumnIds(
    columnIds: number[],
    queryOptions?: IQueryOptions,
  ): Promise<void> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    await executer<ModelColumn>(this.tableName)
      .whereIn('id', columnIds)
      .delete();
  }
}
