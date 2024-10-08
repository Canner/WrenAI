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
    const [result] = await executer(this.tableName)
      .insert(this.transformToDBData(data))
      .returning('*');
    return this.transformFromDBData(result);
  }

  public async createMany(data: Partial<T>[], queryOptions?: IQueryOptions) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const batchSize = 100;
    const batchCount = Math.ceil(data.length / batchSize);
    const result = [];
    for (let i = 0; i < batchCount; i++) {
      const start = i * batchSize;
      const end = Math.min((i + 1) * batchSize, data.length);
      const batchValues = data.slice(start, end);
      const chunk = await executer(this.tableName)
        .insert(batchValues.map(this.transformToDBData))
        .returning('*');
      result.push(...chunk);
    }

    return result.map((data) => this.transformFromDBData(data));
  }

  public async updateOne(
    id: string | number,
    data: Partial<T>,
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const [result] = await executer(this.tableName)
      .where({ id })
      .update(this.transformToDBData(data))
      .returning('*');
    return this.transformFromDBData(result);
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
