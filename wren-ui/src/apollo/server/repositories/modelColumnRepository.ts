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
  name: string; // Column name
  aggregation?: string; // Expression for the column, could be custom field or calculated field expression
  lineage?: string; // The selected field in calculated field, array of ids
  diagram?: string; // For FE to store the calculated field diagram
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
}

export class ModelColumnRepository extends BaseRepository<ModelColumn> {
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
}
