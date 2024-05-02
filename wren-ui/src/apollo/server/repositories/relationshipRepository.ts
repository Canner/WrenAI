import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';

export interface Relation {
  id: number; // ID
  projectId: number; // Reference to project.id
  name: string; // Relation name
  joinType: string; // Join type, eg:"MANY_TO_ONE", "ONE_TO_MANY", "MANY_TO_MANY"
  condition: string; // Join condition, ex: "OrdersModel.custkey = CustomerModel.custkey"
  fromColumnId: number; // from column id, "{fromColumn} {joinType} {toColumn}"
  toColumnId: number; // to column id, "{fromColumn} {joinType} {toColumn}"
  properties: string | null; // Model properties, a json string, the description should be stored here
}

export interface ExtraRelationInfo {
  fromModelId: number;
  fromModelName: string;
  fromColumnName: string;
  toModelId: number;
  toModelName: string;
  toColumnName: string;
}

export type RelationInfo = Relation & ExtraRelationInfo;

export interface IRelationRepository extends IBasicRepository<Relation> {
  findRelationsBy(
    filter: { columnIds?: number[]; modelIds?: number[] },
    queryOptions?: IQueryOptions,
  ): Promise<Relation[]>;
  findRelationsByIds(
    ids: number[],
    queryOptions?: IQueryOptions,
  ): Promise<Relation[]>;
  deleteRelationsByColumnIds(
    columnIds: number[],
    queryOptions?: IQueryOptions,
  ): Promise<void>;
  findRelationInfoBy(
    filter: {
      projectId?: number;
      columnIds?: number[];
      modelIds?: number[];
    },
    queryOptions?: IQueryOptions,
  ): Promise<RelationInfo[]>;
  findDuplicateRelationBetweenModels(modelIds): Promise<RelationInfo[]>;
}

export class RelationRepository
  extends BaseRepository<Relation>
  implements IRelationRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'relation' });
  }

  public async findRelationsBy(
    { columnIds, modelIds },
    queryOptions?: IQueryOptions,
  ) {
    let executer = this.knex;
    if (queryOptions && queryOptions.tx) {
      const { tx } = queryOptions;
      executer = tx;
    }
    // select the leftModel name and rightModel name along with relation
    const builder = executer(this.tableName)
      .join(
        'model_column AS fmc',
        `${this.tableName}.from_column_id`,
        '=',
        'fmc.id',
      )
      .join(
        'model_column AS tmc',
        `${this.tableName}.to_column_id`,
        '=',
        'tmc.id',
      );
    if (columnIds && columnIds.length > 0) {
      builder
        .whereIn(`${this.tableName}.from_column_id`, columnIds)
        .orWhereIn(`${this.tableName}.to_column_id`, columnIds);
    }
    if (modelIds && modelIds.length > 0) {
      builder
        .whereIn('fmc.model_id', modelIds)
        .orWhereIn('tmc.model_id', modelIds);
    }

    const result = await builder.select(
      `${this.tableName}.*`,
      'fmc.model_id AS fromModelId',
      'tmc.model_id AS toModelId',
    );
    return result.map((r) => this.transformFromDBData(r));
  }

  public async findRelationsByIds(ids: number[], queryOptions?: IQueryOptions) {
    let executer = this.knex;
    if (queryOptions && queryOptions.tx) {
      const { tx } = queryOptions;
      executer = tx;
    }

    const result = await executer(this.tableName)
      .whereIn('id', ids)
      .select('*');
    return result.map((r) => this.transformFromDBData(r));
  }

  public async deleteRelationsByColumnIds(
    columnIds: number[],
    queryOptions?: IQueryOptions,
  ) {
    if (queryOptions && queryOptions.tx) {
      const { tx } = queryOptions;
      await tx(this.tableName)
        .whereIn('from_column_id', columnIds)
        .orWhereIn('to_column_id', columnIds)
        .delete();
      return;
    }
    await this.knex(this.tableName)
      .whereIn('from_column_id', columnIds)
      .orWhereIn('to_column_id', columnIds)
      .delete();
  }

  public async findRelationInfoBy(filter, queryOptions) {
    const { projectId, columnIds, modelIds } = filter;
    let executer = this.knex;
    if (queryOptions && queryOptions.tx) {
      const { tx } = queryOptions;
      executer = tx;
    }
    // select the leftModel name and rightModel name along with relation
    const builder = executer(this.tableName)
      .join(
        'model_column AS fmc',
        `${this.tableName}.from_column_id`,
        '=',
        'fmc.id',
      )
      .join(
        'model_column AS tmc',
        `${this.tableName}.to_column_id`,
        '=',
        'tmc.id',
      )
      .join('model AS fm', 'fmc.model_id', '=', 'fm.id')
      .join('model AS tm', 'tmc.model_id', '=', 'tm.id');

    if (projectId) {
      builder.where(`${this.tableName}.project_id`, projectId);
    } else if (columnIds && columnIds.length > 0) {
      builder
        .whereIn(`${this.tableName}.from_column_id`, columnIds)
        .orWhereIn(`${this.tableName}.to_column_id`, columnIds);
    } else if (modelIds && modelIds.length > 0) {
      builder
        .whereIn('fmc.model_id', modelIds)
        .orWhereIn('tmc.model_id', modelIds);
    }

    const result = await builder.select(
      `${this.tableName}.*`,
      'fm.id AS fromModelId',
      'fm.reference_name AS fromModelName',
      'tm.id AS toModelId',
      'tm.reference_name AS toModelName',
      'fmc.reference_name AS fromColumnName',
      'tmc.reference_name AS toColumnName',
    );
    return result.map((r) => this.transformFromDBData(r)) as RelationInfo[];
  }

  public async findDuplicateRelationBetweenModels(modelIds) {
    const query = this.knex(this.tableName)
      .join(
        'model_column AS fmc',
        `${this.tableName}.from_column_id`,
        '=',
        'fmc.id',
      )
      .join(
        'model_column AS tmc',
        `${this.tableName}.to_column_id`,
        '=',
        'tmc.id',
      )
      .whereIn('fmc.model_id', modelIds)
      .whereIn('tmc.model_id', modelIds)
      .select(`${this.tableName}.*`);
    const result = await query;
    return result.map((r) => this.transformFromDBData(r)) as RelationInfo[];
  }
}
