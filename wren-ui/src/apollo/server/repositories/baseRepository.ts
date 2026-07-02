import { Knex } from 'knex';
import { camelCase, isPlainObject, mapKeys, snakeCase } from 'lodash';

export interface IQueryOptions {
  tx?: Knex.Transaction;
  order?: string;
  limit?: number;
}

export interface IBasicRepository<T> {
  transaction: () => Promise<Knex.Transaction>;
  commit: (tx: Knex.Transaction) => Promise<void>;
  rollback: (tx: Knex.Transaction) => Promise<void>;
  findOneBy: (
    filter: Partial<T>,
    queryOptions?: IQueryOptions,
  ) => Promise<T | null>;
  findAllBy: (filter: Partial<T>, queryOptions?: IQueryOptions) => Promise<T[]>;
  findAll: (queryOptions?: IQueryOptions) => Promise<T[]>;
  createOne: (data: Partial<T>, queryOptions?: IQueryOptions) => Promise<T>;
  createMany: (
    data: Partial<T>[],
    queryOptions?: IQueryOptions,
  ) => Promise<T[]>;
  updateOne: (
    id: string | number,
    data: Partial<T>,
    queryOptions?: IQueryOptions,
  ) => Promise<T>;
  deleteOne: (
    id: string | number,
    queryOptions?: IQueryOptions,
  ) => Promise<number>;
  deleteMany: (
    ids: (string | number)[],
    queryOptions?: IQueryOptions,
  ) => Promise<number>;
  deleteAllBy: (
    where: Partial<T>,
    queryOptions?: IQueryOptions,
  ) => Promise<number>;
}

export const coerceBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  if (typeof value === 'string') {
    return ['1', 'true'].includes(value.toLowerCase());
  }
  return Boolean(value);
};

export class BaseRepository<T> implements IBasicRepository<T> {
  protected knex: Knex;
  protected tableName: string;
  private hasIdColumnCache: boolean | null = null;
  private hasIdentityIdPromise?: Promise<boolean>;

  constructor({ knexPg, tableName }: { knexPg: Knex; tableName: string }) {
    this.knex = knexPg;
    this.tableName = tableName;
  }

  public async transaction() {
    return await this.knex.transaction();
  }

  public async commit(tx: Knex.Transaction) {
    await tx.commit();
  }

  public async rollback(tx: Knex.Transaction) {
    await tx.rollback();
  }

  public async findOneBy(filter: Partial<T>, queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const query = executer(this.tableName).where(
      this.normalizeMssqlBindings(this.transformToDBData(filter)),
    );
    if (queryOptions?.limit) {
      query.limit(queryOptions.limit);
    }
    const result = await query;
    return result && result.length > 0
      ? this.transformFromDBData(result[0])
      : null;
  }

  public async findAllBy(filter: Partial<T>, queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    // format filter keys to snake_case

    const query = executer(this.tableName).where(
      this.normalizeMssqlBindings(this.transformToDBData(filter)),
    );
    if (queryOptions?.order) {
      query.orderBy(queryOptions.order);
    }
    const result = await query;
    return result.map(this.transformFromDBData);
  }

  public async findAll(queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const query = executer(this.tableName);
    if (queryOptions?.order) {
      query.orderBy(queryOptions.order);
    }
    if (queryOptions?.limit) {
      query.limit(queryOptions.limit);
    }
    const result = await query;
    return result.map(this.transformFromDBData);
  }

  public async createOne(data: Partial<T>, queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    try {
      const insertValue = await this.prepareInsertData(data, executer);
      const [result] = await executer(this.tableName)
        .insert(this.normalizeMssqlBindings(insertValue))
        .returning('*');
      return this.transformFromDBData(result);
    } catch (error) {
      if (!this.shouldRetryManualId(error, data, executer)) {
        throw error;
      }

      const insertValue = await this.prepareInsertData(data, executer, true);
      const [result] = await executer(this.tableName)
        .insert(this.normalizeMssqlBindings(insertValue))
        .returning('*');
      return this.transformFromDBData(result);
    }
  }

  public async createMany(data: Partial<T>[], queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    let preparedData: any[];
    try {
      preparedData = await this.prepareInsertManyData(data, executer);
    } catch (error) {
      throw error;
    }
    if (preparedData.length === 0) {
      return [];
    }

    try {
      return await this.insertMany(executer, preparedData);
    } catch (error) {
      if (!this.shouldRetryManualId(error, data, executer)) {
        throw error;
      }

      preparedData = await this.prepareInsertManyData(data, executer, true);
      return await this.insertMany(executer, preparedData);
    }
  }

  public async updateOne(
    id: string | number,
    data: Partial<T>,
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const normalizedId = this.normalizeMssqlBindings({ id }).id;
    const [result] = await executer(this.tableName)
      .where({ id: normalizedId })
      .update(this.normalizeMssqlBindings(this.transformToDBData(data)))
      .returning('*');
    return this.transformFromDBData(result);
  }

  public async deleteOne(id: string, queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const normalizedId = this.normalizeMssqlBindings({ id }).id;
    const builder = executer
      .from(this.tableName)
      .where({ id: normalizedId })
      .delete();
    return await builder;
  }

  public async deleteMany(
    ids: (string | number)[],
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const normalizedIds = this.normalizeMssqlBindings(ids);
    let deleted = 0;
    for (const batch of this.toWhereInBatches(normalizedIds)) {
      deleted += await executer
        .from(this.tableName)
        .whereIn('id', batch)
        .delete();
    }
    return deleted;
  }

  public deleteAllBy = async (
    where: Partial<T>,
    queryOptions?: IQueryOptions,
  ) => {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const builder = executer(this.tableName)
      .where(this.normalizeMssqlBindings(this.transformToDBData(where)))
      .delete();
    return await builder;
  };

  protected transformToDBData = (data: Partial<T>) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    return mapKeys(data, (_value, key) => snakeCase(key));
  };

  protected defaultTransformFromDBData(data: any): T {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    return camelCaseData as T;
  }

  protected transformFromDBData = (data: any): T =>
    this.defaultTransformFromDBData(data);

  protected getMssqlWhereInBatchSize() {
    return 2000;
  }

  protected toWhereInBatches<TValue>(values: TValue[]) {
    const client = String(this.knex.client.config.client || '').toLowerCase();
    const batchSize =
      client === 'mssql'
        ? this.getMssqlWhereInBatchSize()
        : Math.max(values.length, 1);
    const batches: TValue[][] = [];
    for (let index = 0; index < values.length; index += batchSize) {
      batches.push(values.slice(index, index + batchSize));
    }
    return batches;
  }

  protected getCreateManyBatchSize(insertValues: any[]) {
    const defaultBatchSize = 100;
    if (insertValues.length === 0) {
      return defaultBatchSize;
    }

    const client = String(this.knex.client.config.client || '').toLowerCase();
    if (client !== 'mssql') {
      return defaultBatchSize;
    }

    const parameterLimit = 2100;
    const safetyMargin = 100;
    const columnCount = Math.max(
      ...insertValues.map((value) => Object.keys(value).length),
      1,
    );

    return Math.max(
      1,
      Math.min(
        defaultBatchSize,
        Math.floor((parameterLimit - safetyMargin) / columnCount),
      ),
    );
  }

  private isMssql(executer: Knex | Knex.Transaction) {
    return executer.client.config.client === 'mssql';
  }

  private async hasIdColumn(executer: Knex | Knex.Transaction) {
    if (this.hasIdColumnCache !== null) {
      return this.hasIdColumnCache;
    }

    const hasIdColumn = await executer.schema.hasColumn(this.tableName, 'id');
    this.hasIdColumnCache = hasIdColumn;
    return hasIdColumn;
  }

  private async getNextId(executer: Knex | Knex.Transaction) {
    const [row] = await executer(this.tableName).max<{
      maxId: number | string | null;
    }>('id as maxId');
    return Number(row?.maxId || 0) + 1;
  }

  private async hasIdentityId(executer: Knex | Knex.Transaction) {
    if (!this.isMssql(executer)) {
      return true;
    }

    if (!this.hasIdentityIdPromise) {
      this.hasIdentityIdPromise = executer('INFORMATION_SCHEMA.COLUMNS')
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
  }

  private async prepareInsertData(
    data: Partial<T>,
    executer: Knex | Knex.Transaction,
    forceManualId = false,
  ) {
    const dbData = this.transformToDBData(data);
    if (!this.isMssql(executer)) {
      return dbData;
    }

    if (
      !(await this.hasIdColumn(executer)) ||
      dbData.id !== undefined ||
      !forceManualId
    ) {
      return dbData;
    }

    return {
      ...dbData,
      id: await this.getNextId(executer),
    };
  }

  private async prepareInsertManyData(
    data: Partial<T>[],
    executer: Knex | Knex.Transaction,
    forceManualId = false,
  ) {
    const dbData = data.map((item) => this.transformToDBData(item));
    if (
      !this.isMssql(executer) ||
      !(await this.hasIdColumn(executer)) ||
      !forceManualId
    ) {
      return dbData;
    }

    const missingIdIndexes = dbData.reduce<number[]>((acc, item, index) => {
      if (item.id === undefined) {
        acc.push(index);
      }
      return acc;
    }, []);

    if (!missingIdIndexes.length) {
      return dbData;
    }

    let nextId = await this.getNextId(executer);
    for (const index of missingIdIndexes) {
      dbData[index] = {
        ...dbData[index],
        id: nextId++,
      };
    }

    return dbData;
  }

  private async insertMany(
    executer: Knex | Knex.Transaction,
    preparedData: any[],
  ) {
    const batchSize = this.getCreateManyBatchSize(preparedData);
    const batchCount = Math.ceil(preparedData.length / batchSize);
    const result = [];
    for (let i = 0; i < batchCount; i++) {
      const start = i * batchSize;
      const end = Math.min((i + 1) * batchSize, preparedData.length);
      const batchValues = preparedData.slice(start, end);
      const chunk = await executer(this.tableName)
        .insert(this.normalizeMssqlBindings(batchValues))
        .returning('*');
      result.push(...chunk);
    }

    return result.map((data) => this.transformFromDBData(data));
  }

  private normalizeMssqlBindings(value: any): any {
    if (!this.isMssql(this.knex)) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeMssqlBindings(item));
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (!isPlainObject(value)) {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        !Number.isSafeInteger(value)
      ) {
        return String(value);
      }
      return value;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        if (
          typeof entryValue === 'number' &&
          Number.isInteger(entryValue) &&
          (!Number.isSafeInteger(entryValue) ||
            key === 'id' ||
            key.endsWith('_id'))
        ) {
          return [key, String(entryValue)];
        }

        if (typeof entryValue === 'bigint') {
          return [key, entryValue.toString()];
        }

        return [key, this.normalizeMssqlBindings(entryValue)];
      }),
    );
  }

  private shouldRetryManualId(
    error: unknown,
    data: Partial<T> | Partial<T>[],
    executer: Knex | Knex.Transaction,
  ) {
    if (!this.isMssql(executer)) {
      return false;
    }

    const hasMissingId = Array.isArray(data)
      ? data.some((item: any) => item?.id === undefined || item?.id === null)
      : (data as any)?.id === undefined || (data as any)?.id === null;

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
  }
}
