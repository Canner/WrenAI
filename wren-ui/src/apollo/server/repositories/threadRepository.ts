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

export interface ThreadRecommendationQuestionResult {
  question: string;
  category: string;
  sql: string;
}

export interface Thread {
  id: number; // ID
  projectId: number; // Reference to project.id
  summary: string; // Thread summary

  // recommend question
  queryId?: string; // Query ID
  questions?: ThreadRecommendationQuestionResult[]; // Recommended questions
  questionsStatus?: string; // Status of the recommended questions
  questionsError?: object; // Error of the recommended questions
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IThreadRepository extends IBasicRepository<Thread> {
  listAllTimeDescOrder(projectId: number): Promise<Thread[]>;
}

export class ThreadRepository
  extends BaseRepository<Thread>
  implements IThreadRepository
{
  private readonly jsonbColumns = ['questions', 'questionsError'];
  private hasIdentityIdPromise?: Promise<boolean>;

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread' });
  }

  public override async createOne(
    data: Partial<Thread>,
    queryOptions?: IQueryOptions,
  ): Promise<Thread> {
    return super.createOne(
      await this.withMssqlId(this.withTimestamps(data), queryOptions),
      queryOptions,
    );
  }

  public override async createMany(
    data: Partial<Thread>[],
    queryOptions?: IQueryOptions,
  ): Promise<Thread[]> {
    return super.createMany(
      await this.withMssqlIds(data.map(this.withTimestamps), queryOptions),
      queryOptions,
    );
  }

  public override async updateOne(
    id: string | number,
    data: Partial<Thread>,
    queryOptions?: IQueryOptions,
  ): Promise<Thread> {
    return super.updateOne(
      id,
      {
        ...data,
        updatedAt: data.updatedAt ?? new Date(),
      },
      queryOptions,
    );
  }

  public async listAllTimeDescOrder(projectId: number): Promise<Thread[]> {
    const threads = await this.knex(this.tableName)
      .where(this.transformToDBData({ projectId }))
      .orderBy('created_at', 'desc');
    return threads.map((thread) => this.transformFromDBData(thread));
  }

  protected override transformFromDBData = (data: any): Thread => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    });
    return transformData as Thread;
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

  private withTimestamps = (data: Partial<Thread>): Partial<Thread> => {
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
    data: Partial<Thread>,
    queryOptions?: IQueryOptions,
  ): Promise<Partial<Thread>> => {
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
    data: Partial<Thread>[],
    queryOptions?: IQueryOptions,
  ): Promise<Partial<Thread>[]> => {
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
