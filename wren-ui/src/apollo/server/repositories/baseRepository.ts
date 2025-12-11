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

export class BaseRepository<T> implements IBasicRepository<T> {
  protected knex: Knex;
  protected tableName: string;

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
      this.transformToDBData(filter),
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
      this.transformToDBData(filter),
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
    const query = executer(this.tableName).insert(this.transformToDBData(data));

    if (this.knex.client.config.client != 'mysql2') {
      const [result] = await query.returning('*');
      return this.transformFromDBData(result);
    }
    // MySQL does not support this, so retrieve the newly created record.
    const [id] = await query;
    const inserted = await executer(this.tableName).where({ id }).first();
    return this.transformFromDBData(inserted);
  }

  public async createMany(data: Partial<T>[], queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const batchSize = 100;
    const batchCount = Math.ceil(data.length / batchSize);
    const result = [];
    for (let i = 0; i < batchCount; i++) {
      const start = i * batchSize;
      const end = Math.min((i + 1) * batchSize, data.length);
      const batchValuesOriginal = data.slice(start, end);
      // IMPORTANT: we need to convert each object to snake_case before inserting.
      // createOne already did this; createMany didn't, which caused camelCase columns (e.g., displayName)
      // to break in databases where the actual column is display_name.
      const batchValues = batchValuesOriginal.map((v) =>
        this.transformToDBData(v),
      );
      const query = executer(this.tableName).insert(batchValues);

      if (this.knex.client.config.client != 'mysql2') {
        // PostgreSQL and similar
        const chunk = await query.returning('*');
        result.push(...chunk.map(this.transformFromDBData));
      } else {
        // MySQL / MariaDB: manually fetch the inserted records
        const insertedIds = await query; // Returns the first ID in the sequence
        const firstId = Array.isArray(insertedIds)
          ? insertedIds[0]
          : insertedIds;

        // Search for the range of inserted IDs (if the table uses autoincrement)
        // ⚠️ This only works well if the 'id' field is auto increment.
        if (typeof firstId === 'number') {
          const lastId = firstId + batchValues.length - 1;
          const rows = await executer(this.tableName)
            .whereBetween('id', [firstId, lastId])
            .orderBy('id', 'asc');
          result.push(...rows.map(this.transformFromDBData));
        } else {
          // Fallback without numeric ID — returns the raw inserted data
          // Here batchValues are already in snake_case format; transformFromDBData converts to camelCase.
          result.push(...batchValues.map(this.transformFromDBData));
        }
      }
    }
    return result;
  }

  public async updateOne(
    id: string | number,
    data: Partial<T>,
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const query = executer(this.tableName)
      .where({ id })
      .update(this.transformToDBData(data));
    if (this.knex.client.config.client != 'mysql2') {
      const [result] = await query.returning('*');
      return this.transformFromDBData(result);
    }
    // MySQL: manually fetch the updated record
    await query;
    const updated = await executer(this.tableName).where({ id }).first();
    return this.transformFromDBData(updated);
  }

  public async deleteOne(id: string, queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const builder = executer.from(this.tableName).where({ id }).delete();
    return await builder;
  }

  public async deleteMany(
    ids: (string | number)[],
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const builder = executer.from(this.tableName).whereIn('id', ids).delete();
    return await builder;
  }

  public deleteAllBy = async (
    where: Partial<T>,
    queryOptions?: IQueryOptions,
  ) => {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const builder = executer(this.tableName)
      .where(this.transformToDBData(where))
      .delete();
    return await builder;
  };

  protected transformToDBData = (data: Partial<T>) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    return mapKeys(data, (_value, key) => snakeCase(key));
  };

  protected transformFromDBData = (data: any): T => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    return camelCaseData as T;
  };
}
