import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import { RelationData } from '../types';

export interface Relation {
  id: number; // ID
  projectId: number; // Reference to project.id
  name: string; // Relation name
  joinType: string; // Join type, eg:"MANY_TO_ONE", "ONE_TO_MANY", "MANY_TO_MANY"
  condition: string; // Join condition, ex: "OrdersModel.custkey = CustomerModel.custkey"
  fromColumnId: number; // from column id, "{fromColumn} {joinType} {toColumn}"
  toColumnId: number; // to column id, "{fromColumn} {joinType} {toColumn}"
  properties: string | null; // Model properties, a json string, the description should be stored here
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ExtraRelationInfo {
  fromModelId: number;
  fromModelName: string;
  fromModelDisplayName: string;
  fromColumnName: string;
  fromColumnDisplayName: string;
  toModelId: number;
  toModelName: string;
  toModelDisplayName: string;
  toColumnName: string;
  toColumnDisplayName: string;
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
  findExistedRelationBetweenModels(
    relation: RelationData,
  ): Promise<RelationInfo[]>;
}

export class RelationRepository
  extends BaseRepository<Relation>
  implements IRelationRepository
{
  private hasIdentityIdPromise?: Promise<boolean>;

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'relation' });
  }

  public async createOne(data: Partial<Relation>): Promise<Relation> {
    if (!this.isMssql() || (await this.hasIdentityId())) {
      return super.createOne(this.withTimestamps(data));
    }

    const id = await this.nextRelationId();
    return super.createOne(this.withTimestamps({ id, ...data }));
  }

  public async createMany(data: Partial<Relation>[]): Promise<Relation[]> {
    if (data.length === 0) {
      return [];
    }

    const dataWithTimestamps = data.map((relation) =>
      this.withTimestamps(relation),
    );

    if (!this.isMssql() || (await this.hasIdentityId())) {
      return super.createMany(dataWithTimestamps);
    }

    const startId = await this.nextRelationId();
    return super.createMany(
      dataWithTimestamps.map((relation, index) => ({
        id: startId + index,
        ...relation,
      })),
    );
  }

  public async updateOne(id: number, data: Partial<Relation>) {
    return super.updateOne(id, {
      ...data,
      updatedAt: data.updatedAt ?? new Date(),
    });
  }

  public async findRelationsBy(
    { columnIds, modelIds },
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const selectRows = (builder) =>
      builder.select(
        `${this.tableName}.*`,
        'fmc.model_id AS fromModelId',
        'tmc.model_id AS toModelId',
      );
    const rows = [];
    if (columnIds && columnIds.length > 0) {
      for (const batch of this.toWhereInBatches(columnIds)) {
        const result = await selectRows(this.relationJoinBuilder(executer)).where(
          (builder) =>
            builder
              .whereIn(`${this.tableName}.from_column_id`, batch)
              .orWhereIn(`${this.tableName}.to_column_id`, batch),
        );
        rows.push(...result);
      }
      return rows.map((r) => this.transformFromDBData(r));
    }

    if (modelIds && modelIds.length > 0) {
      for (const batch of this.toWhereInBatches(modelIds)) {
        const result = await selectRows(this.relationJoinBuilder(executer)).where(
          (builder) =>
            builder
              .whereIn('fmc.model_id', batch)
              .orWhereIn('tmc.model_id', batch),
        );
        rows.push(...result);
      }
      return rows.map((r) => this.transformFromDBData(r));
    }

    const result = await selectRows(this.relationJoinBuilder(executer));
    return result.map((r) => this.transformFromDBData(r));
  }

  public async findRelationsByIds(ids: number[], queryOptions?: IQueryOptions) {
    let executer = this.knex;
    if (queryOptions && queryOptions.tx) {
      const { tx } = queryOptions;
      executer = tx;
    }

    const result = [];
    for (const batch of this.toWhereInBatches(ids)) {
      const rows = await executer(this.tableName).whereIn('id', batch).select('*');
      result.push(...rows);
    }
    return result.map((r) => this.transformFromDBData(r));
  }

  public async deleteRelationsByColumnIds(
    columnIds: number[],
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    for (const batch of this.toWhereInBatches(columnIds)) {
      await executer(this.tableName)
        .where((builder) =>
          builder
            .whereIn('from_column_id', batch)
            .orWhereIn('to_column_id', batch),
        )
        .delete();
    }
  }

  public async findRelationInfoBy(filter, queryOptions) {
    const { projectId, columnIds, modelIds } = filter;
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const selectRows = (builder) =>
      builder.select(
        `${this.tableName}.*`,
        'fm.id AS fromModelId',
        'fm.reference_name AS fromModelName',
        'fm.display_name AS fromModelDisplayName',
        'tm.id AS toModelId',
        'tm.reference_name AS toModelName',
        'tm.display_name AS toModelDisplayName',
        'fmc.reference_name AS fromColumnName',
        'fmc.display_name AS fromColumnDisplayName',
        'tmc.reference_name AS toColumnName',
        'tmc.display_name AS toColumnDisplayName',
      );

    if (projectId) {
      const builder = this.relationInfoJoinBuilder(executer);
      builder.where(`${this.tableName}.project_id`, projectId);
      const result = await selectRows(builder);
      return result.map((r) => this.transformFromDBData(r)) as RelationInfo[];
    }

    const rows = [];
    if (columnIds && columnIds.length > 0) {
      for (const batch of this.toWhereInBatches(columnIds)) {
        const result = await selectRows(this.relationInfoJoinBuilder(executer)).where(
          (builder) =>
            builder
              .whereIn(`${this.tableName}.from_column_id`, batch)
              .orWhereIn(`${this.tableName}.to_column_id`, batch),
        );
        rows.push(...result);
      }
    } else if (modelIds && modelIds.length > 0) {
      for (const batch of this.toWhereInBatches(modelIds)) {
        const result = await selectRows(this.relationInfoJoinBuilder(executer)).where(
          (builder) =>
            builder
              .whereIn('fmc.model_id', batch)
              .orWhereIn('tmc.model_id', batch),
        );
        rows.push(...result);
      }
    } else {
      rows.push(...(await selectRows(this.relationInfoJoinBuilder(executer))));
    }

    return rows.map((r) => this.transformFromDBData(r)) as RelationInfo[];
  }

  public async findExistedRelationBetweenModels(relation: RelationData) {
    const { fromModelId, fromColumnId, toModelId, toColumnId } = relation;
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
      // duplicate relationship check
      .whereRaw(
        `fmc.model_id = ? And ${this.tableName}.from_column_id = ? And tmc.model_id = ? And ${this.tableName}.to_column_id = ?`,
        [fromModelId, fromColumnId, toModelId, toColumnId],
      )
      // reverse relationship check
      .orWhereRaw(
        `fmc.model_id = ? And ${this.tableName}.from_column_id = ? And tmc.model_id = ? And ${this.tableName}.to_column_id = ?`,
        [toModelId, toColumnId, fromModelId, fromColumnId],
      )
      .select(`${this.tableName}.*`);
    const result = await query;
    return result.map((r) => this.transformFromDBData(r)) as RelationInfo[];
  }

  private isMssql = () =>
    String(this.knex.client.config.client || '').toLowerCase() === 'mssql';

  private relationJoinBuilder(executer: Knex | Knex.Transaction) {
    return executer(this.tableName)
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
  }

  private relationInfoJoinBuilder(executer: Knex | Knex.Transaction) {
    return this.relationJoinBuilder(executer)
      .join('model AS fm', 'fmc.model_id', '=', 'fm.id')
      .join('model AS tm', 'tmc.model_id', '=', 'tm.id');
  }

  private withTimestamps = (data: Partial<Relation>): Partial<Relation> => {
    const now = new Date();
    return {
      ...data,
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
    };
  };

  private async hasIdentityId() {
    this.hasIdentityIdPromise ??= this.knex('sys.columns as c')
      .join('sys.tables as t', 'c.object_id', 't.object_id')
      .where('t.name', this.tableName)
      .where('c.name', 'id')
      .select(
        this.knex.raw(
          'COLUMNPROPERTY(c.object_id, c.name, ?) as isIdentity',
          ['IsIdentity'],
        ),
      )
      .first()
      .then((row) => Number(row?.isIdentity ?? 0) === 1);

    return this.hasIdentityIdPromise;
  }

  private async nextRelationId() {
    const row = await this.knex(this.tableName)
      .max<{ maxId?: number | string }>('id as maxId')
      .first();

    return Number(row?.maxId ?? 0) + 1;
  }
}
