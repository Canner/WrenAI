import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface ModelNestedColumn {
  id: number; // ID
  modelId: number; // Reference to model ID
  columnId: number; // Reference to column ID
  columnPath: string[];
  displayName: string; // Nested column name displayed in UI
  referenceName: string; // The name used in the MDL structure and when querying the data
  sourceColumnName: string; // The nested column name in the datasource
  type: string; // Data type, refer to the nested column type in the datasource
  properties?: Record<string, any>; // Nested column properties, a json string, the description should be stored here
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IModelNestedColumnRepository
  extends IBasicRepository<ModelNestedColumn> {
  findNestedColumnsByModelIds(modelIds: number[]): Promise<ModelNestedColumn[]>;
  findNestedColumnsByIds(ids: number[]): Promise<ModelNestedColumn[]>;
}

export class ModelNestedColumnRepository
  extends BaseRepository<ModelNestedColumn>
  implements IModelNestedColumnRepository
{
  private hasIdentityIdPromise?: Promise<boolean>;

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'model_nested_column' });
  }

  public override async createOne(
    data: Partial<ModelNestedColumn>,
    queryOptions?: IQueryOptions,
  ): Promise<ModelNestedColumn> {
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
    data: Partial<ModelNestedColumn>[],
    queryOptions?: IQueryOptions,
  ): Promise<ModelNestedColumn[]> {
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
    data: Partial<ModelNestedColumn>,
    queryOptions?: IQueryOptions,
  ): Promise<ModelNestedColumn> {
    return super.updateOne(
      id,
      {
        ...data,
        updatedAt: data.updatedAt ?? new Date(),
      },
      queryOptions,
    );
  }

  public findNestedColumnsByModelIds = async (modelIds: number[]) => {
    const result = await this.findByColumnIn('model_id', modelIds);
    return result.map((r) => this.transformFromDBData(r));
  };

  public findNestedColumnsByIds = async (ids: number[]) => {
    const result = await this.findByColumnIn('id', ids);
    return result.map((r) => this.transformFromDBData(r));
  };

  private async findByColumnIn(
    columnName: string,
    values: Array<string | number>,
  ) {
    if (values.length === 0) {
      return [];
    }

    const rows = [];
    for (const batch of this.toWhereInBatches(values)) {
      const result = await this.knex(this.tableName)
        .select('*')
        .whereIn(columnName, batch);
      rows.push(...result);
    }
    return rows;
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

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (['columnPath', 'properties'].includes(key)) {
        return value ? JSON.stringify(value) : null;
      }
      return value;
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };

  protected override transformFromDBData = (data: any): ModelNestedColumn => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (['columnPath', 'properties'].includes(key)) {
        // The value from Sqlite will be string type, while the value from PG is JSON object
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    }) as ModelNestedColumn;
    return formattedData;
  };

  private isMssql = () =>
    String(this.knex.client.config.client || '').toLowerCase() === 'mssql';

  private withTimestamps = (
    data: Partial<ModelNestedColumn>,
  ): Partial<ModelNestedColumn> => {
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
    data: Partial<ModelNestedColumn>,
    queryOptions?: IQueryOptions,
    forceManualId = false,
  ): Promise<Partial<ModelNestedColumn>> => {
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
    data: Partial<ModelNestedColumn>[],
    queryOptions?: IQueryOptions,
    forceManualId = false,
  ): Promise<Partial<ModelNestedColumn>[]> => {
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
    data: Partial<ModelNestedColumn> | Partial<ModelNestedColumn>[],
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
