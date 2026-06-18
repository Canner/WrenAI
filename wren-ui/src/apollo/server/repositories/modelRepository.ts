import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
  coerceBoolean,
} from './baseRepository';

export interface Model {
  id: number; // ID
  projectId: number; // Reference to project.id
  displayName: string; // Model name displayed in UI
  sourceTableName: string; // the table name in the datasource
  referenceName: string; // the name used in the MDL structure
  refSql: string; // Reference SQL
  cached: boolean; // Model is cached or not
  refreshTime: string | null; // Contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"
  properties: string | null; // Model properties, a json string, the description and displayName should be stored here
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IModelRepository extends IBasicRepository<Model> {
  findAllByIds(ids: number[]): Promise<Model[]>;
  deleteAllBySourceTableNames(
    sourceTableNames: string[],
    queryOptions?: IQueryOptions,
  ): Promise<number>;
}

export class ModelRepository
  extends BaseRepository<Model>
  implements IModelRepository
{
  private hasIdentityIdPromise?: Promise<boolean>;

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'model' });
  }

  public override async createOne(
    data: Partial<Model>,
    queryOptions?: IQueryOptions,
  ): Promise<Model> {
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
    data: Partial<Model>[],
    queryOptions?: IQueryOptions,
  ): Promise<Model[]> {
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
    data: Partial<Model>,
    queryOptions?: IQueryOptions,
  ): Promise<Model> {
    return super.updateOne(
      id,
      {
        ...data,
        updatedAt: data.updatedAt ?? new Date(),
      },
      queryOptions,
    );
  }

  protected override transformFromDBData = (data: any): Model => {
    const model = this.defaultTransformFromDBData(data) as Model;
    return {
      ...model,
      cached: coerceBoolean(model.cached),
    };
  };

  public async findAllByIds(ids: number[]) {
    if (ids.length === 0) {
      return [];
    }

    const rows = [];
    for (const batch of this.toWhereInBatches(ids)) {
      const res = await this.knex<Model>(this.tableName).whereIn('id', batch);
      rows.push(...res);
    }

    return rows.map((r) => this.transformFromDBData(r));
  }

  public async deleteAllBySourceTableNames(
    sourceTableNames: string[],
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    let deleted = 0;
    for (const batch of this.toWhereInBatches(sourceTableNames)) {
      deleted += await executer(this.tableName)
        .whereIn('source_table_name', batch)
        .delete();
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

  private withTimestamps = (data: Partial<Model>): Partial<Model> => {
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
    data: Partial<Model>,
    queryOptions?: IQueryOptions,
    forceManualId = false,
  ): Promise<Partial<Model>> => {
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
    data: Partial<Model>[],
    queryOptions?: IQueryOptions,
    forceManualId = false,
  ): Promise<Partial<Model>[]> => {
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
    data: Partial<Model> | Partial<Model>[],
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
