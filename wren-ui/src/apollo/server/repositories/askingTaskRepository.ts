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
import { AskFeedbackResult, AskResult } from '../models/adaptor';

export type AskingTaskDetail =
  | AskResult
  | (AskFeedbackResult & {
      adjustment?: boolean;
    });

export interface AskingTask {
  id: number;
  queryId: string;
  question?: string;
  detail?: AskingTaskDetail;
  threadId?: number;
  threadResponseId?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAskingTaskRepository extends IBasicRepository<AskingTask> {
  findByQueryId(queryId: string): Promise<AskingTask | null>;
}

export class AskingTaskRepository
  extends BaseRepository<AskingTask>
  implements IAskingTaskRepository
{
  private readonly jsonbColumns = ['detail'];
  private hasIdentityIdPromise?: Promise<boolean>;

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'asking_task' });
  }

  public async findByQueryId(queryId: string): Promise<AskingTask | null> {
    return this.findOneBy({ queryId });
  }

  public override async createOne(
    data: Partial<AskingTask>,
    queryOptions?: IQueryOptions,
  ): Promise<AskingTask> {
    return super.createOne(
      await this.withMssqlId(this.withTimestamps(data), queryOptions),
      queryOptions,
    );
  }

  public override async createMany(
    data: Partial<AskingTask>[],
    queryOptions?: IQueryOptions,
  ): Promise<AskingTask[]> {
    return super.createMany(
      await this.withMssqlIds(data.map(this.withTimestamps), queryOptions),
      queryOptions,
    );
  }

  public override async updateOne(
    id: string | number,
    data: Partial<AskingTask>,
    queryOptions?: IQueryOptions,
  ): Promise<AskingTask> {
    return super.updateOne(
      id,
      {
        ...data,
        updatedAt: data.updatedAt ?? new Date(),
      },
      queryOptions,
    );
  }

  protected override transformFromDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        }
        return value;
      }
      return value;
    });
    return transformData as AskingTask;
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        return JSON.stringify(value);
      } else {
        return value;
      }
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };

  private withTimestamps = (
    data: Partial<AskingTask>,
  ): Partial<AskingTask> => {
    const now = new Date();
    return {
      ...data,
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
    };
  };

  private isMssql = () =>
    String(this.knex.client.config.client || '').toLowerCase() === 'mssql';

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
    data: Partial<AskingTask>,
    queryOptions?: IQueryOptions,
  ): Promise<Partial<AskingTask>> => {
    if (
      (data.id !== undefined && data.id !== null) ||
      !this.isMssql() ||
      (await this.hasIdentityId())
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
    data: Partial<AskingTask>[],
    queryOptions?: IQueryOptions,
  ): Promise<Partial<AskingTask>[]> => {
    if (
      data.every((item) => item.id !== undefined && item.id !== null) ||
      !this.isMssql() ||
      (await this.hasIdentityId())
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
}
