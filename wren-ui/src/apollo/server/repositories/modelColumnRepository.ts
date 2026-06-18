import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
  coerceBoolean,
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
  createdAt?: Date;
  updatedAt?: Date;
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
  private hasIdentityIdPromise?: Promise<boolean>;

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'model_column' });
  }

  public override async createOne(
    data: Partial<ModelColumn>,
    queryOptions?: IQueryOptions,
  ): Promise<ModelColumn> {
    const timestamped = this.withTimestamps(data);
    try {
      return await super.createOne(
        await this.withMssqlId(timestamped, queryOptions),
        queryOptions,
      );
    } catch (error) {
      if (!this.shouldRetryManualId(error, timestamped)) {
        throw error;
      }

      return await super.createOne(
        await this.withMssqlId(timestamped, queryOptions, true),
        queryOptions,
      );
    }
  }

  public override async createMany(
    data: Partial<ModelColumn>[],
    queryOptions?: IQueryOptions,
  ): Promise<ModelColumn[]> {
    const timestamped = data.map(this.withTimestamps);
    try {
      return await super.createMany(
        await this.withMssqlIds(timestamped, queryOptions),
        queryOptions,
      );
    } catch (error) {
      if (!this.shouldRetryManualId(error, timestamped)) {
        throw error;
      }

      return await super.createMany(
        await this.withMssqlIds(timestamped, queryOptions, true),
        queryOptions,
      );
    }
  }

  public override async updateOne(
    id: string | number,
    data: Partial<ModelColumn>,
    queryOptions?: IQueryOptions,
  ): Promise<ModelColumn> {
    return super.updateOne(
      id,
      {
        ...data,
        updatedAt: data.updatedAt ?? new Date(),
      },
      queryOptions,
    );
  }

  protected override transformFromDBData = (data: any): ModelColumn => {
    const column = this.defaultTransformFromDBData(data) as ModelColumn;
    return {
      ...column,
      isCalculated: coerceBoolean(column.isCalculated),
      notNull: coerceBoolean(column.notNull),
      isPk: coerceBoolean(column.isPk),
    };
  };

  public async findColumnsByModelIds(modelIds, queryOptions?: IQueryOptions) {
    const result = await this.findByColumnIn(
      'model_id',
      modelIds,
      queryOptions,
    );
    return result.map((r) => this.transformFromDBData(r));
  }

  public async findColumnsByIds(ids: number[], queryOptions?: IQueryOptions) {
    const result = await this.findByColumnIn('id', ids, queryOptions);
    return result.map((r) => this.transformFromDBData(r));
  }

  public async deleteByModelIds(
    modelIds: number[],
    queryOptions?: IQueryOptions,
  ) {
    await this.deleteByColumnIn('model_id', modelIds, queryOptions);
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
    return await this.deleteByColumnIn(
      'source_column_name',
      sourceColumnNames,
      queryOptions,
      this.transformToDBData({ modelId }),
    );
  }

  public async deleteAllByColumnIds(
    columnIds: number[],
    queryOptions?: IQueryOptions,
  ): Promise<void> {
    await this.deleteByColumnIn('id', columnIds, queryOptions);
  }

  private async findByColumnIn(
    columnName: string,
    values: Array<string | number>,
    queryOptions?: IQueryOptions,
  ) {
    if (values.length === 0) {
      return [];
    }

    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const rows = [];
    for (const batch of this.toWhereInBatches(values)) {
      const result = await executer(this.tableName)
        .whereIn(columnName, batch)
        .select('*');
      rows.push(...result);
    }

    return rows;
  }

  private async deleteByColumnIn(
    columnName: string,
    values: Array<string | number>,
    queryOptions?: IQueryOptions,
    extraWhere?: Record<string, unknown>,
  ) {
    if (values.length === 0) {
      return 0;
    }

    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    let deleted = 0;
    for (const batch of this.toWhereInBatches(values)) {
      const query = executer(this.tableName).whereIn(columnName, batch);
      if (extraWhere) {
        query.where(extraWhere);
      }
      deleted += await query.delete();
    }

    return deleted;
  }

  private toWhereInBatches<TValue>(values: TValue[]) {
    const batchSize = this.isMssql()
      ? this.getMssqlWhereInBatchSize()
      : Math.max(values.length, 1);
    const batches: TValue[][] = [];
    for (let index = 0; index < values.length; index += batchSize) {
      batches.push(values.slice(index, index + batchSize));
    }
    return batches;
  }

  private isMssql = () =>
    String(this.knex.client.config.client || '').toLowerCase() === 'mssql';

  private withTimestamps = (
    data: Partial<ModelColumn>,
  ): Partial<ModelColumn> => {
    const now = new Date();
    return {
      ...data,
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
    };
  };

  private hasIdentityId = async (): Promise<boolean> => {
    if (!this.isMssql()) {
      return true;
    }

    if (!this.hasIdentityIdPromise) {
      this.hasIdentityIdPromise = this.knex('INFORMATION_SCHEMA.COLUMNS')
        .select('COLUMN_NAME')
        .where({
          TABLE_SCHEMA: 'dbo',
          TABLE_NAME: this.tableName,
          COLUMN_NAME: 'id',
        })
        .whereRaw(
          "COLUMNPROPERTY(OBJECT_ID(TABLE_SCHEMA + '.' + TABLE_NAME), COLUMN_NAME, 'IsIdentity') = 1",
        )
        .first()
        .then(Boolean);
    }

    return this.hasIdentityIdPromise;
  };

  private withMssqlId = async (
    data: Partial<ModelColumn>,
    queryOptions?: IQueryOptions,
    forceManualId = false,
  ): Promise<Partial<ModelColumn>> => {
    if (
      (data.id !== undefined && data.id !== null) ||
      !this.isMssql() ||
      (!forceManualId && (await this.hasIdentityId()))
    ) {
      return data;
    }

    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const [row] = await executer(this.tableName).max<{ maxId?: number }>({
      maxId: 'id',
    });
    return {
      ...data,
      id: Number(row?.maxId || 0) + 1,
    };
  };

  private withMssqlIds = async (
    data: Partial<ModelColumn>[],
    queryOptions?: IQueryOptions,
    forceManualId = false,
  ): Promise<Partial<ModelColumn>[]> => {
    if (
      data.every((item) => item.id !== undefined && item.id !== null) ||
      !this.isMssql() ||
      (!forceManualId && (await this.hasIdentityId()))
    ) {
      return data;
    }

    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const [row] = await executer(this.tableName).max<{ maxId?: number }>({
      maxId: 'id',
    });
    let nextId = Number(row?.maxId || 0) + 1;
    return data.map((item) => {
      if (item.id !== undefined && item.id !== null) {
        return item;
      }
      return {
        ...item,
        id: nextId++,
      };
    });
  };

  private shouldRetryManualId = (
    error: unknown,
    data: Partial<ModelColumn> | Partial<ModelColumn>[],
  ): boolean => {
    if (!this.isMssql()) {
      return false;
    }

    const hasMissingId = Array.isArray(data)
      ? data.some((item) => item.id === undefined || item.id === null)
      : data.id === undefined || data.id === null;

    if (!hasMissingId) {
      return false;
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : '';

    return message.includes("Cannot insert the value NULL into column 'id'");
  };
}
