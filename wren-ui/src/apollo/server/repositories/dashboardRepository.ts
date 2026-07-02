import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  coerceBoolean,
  IQueryOptions,
} from './baseRepository';
import { ScheduleFrequencyEnum } from '@server/models/dashboard';

export interface Dashboard {
  id: number;
  projectId: number;
  name: string;
  cacheEnabled: boolean;
  scheduleFrequency: ScheduleFrequencyEnum | null;
  scheduleTimezone: string | null; // e.g. 'America/New_York', 'Asia/Taipei'
  scheduleCron: string | null; // cron expression string
  nextScheduledAt: Date | null; // Next scheduled run timestamp
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IDashboardRepository extends IBasicRepository<Dashboard> {}

export class DashboardRepository
  extends BaseRepository<Dashboard>
  implements IDashboardRepository
{
  private hasIdentityIdPromise?: Promise<boolean>;

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'dashboard' });
  }

  public override async createOne(
    data: Partial<Dashboard>,
    queryOptions?: IQueryOptions,
  ): Promise<Dashboard> {
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
    data: Partial<Dashboard>[],
    queryOptions?: IQueryOptions,
  ): Promise<Dashboard[]> {
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
    data: Partial<Dashboard>,
    queryOptions?: IQueryOptions,
  ): Promise<Dashboard> {
    return super.updateOne(
      id,
      {
        ...data,
        updatedAt: data.updatedAt ?? new Date(),
      },
      queryOptions,
    );
  }

  protected override transformFromDBData = (data: any): Dashboard => {
    const dashboard = this.defaultTransformFromDBData(data) as Dashboard;
    return {
      ...dashboard,
      cacheEnabled: coerceBoolean(dashboard.cacheEnabled),
    };
  };

  private isMssql = () =>
    String(this.knex.client.config.client || '').toLowerCase() === 'mssql';

  private withTimestamps = (data: Partial<Dashboard>): Partial<Dashboard> => {
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
    data: Partial<Dashboard>,
    queryOptions?: IQueryOptions,
    forceManualId = false,
  ): Promise<Partial<Dashboard>> => {
    if (
      (data.id !== undefined && data.id !== null) ||
      !this.isMssql() ||
      !forceManualId
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
    data: Partial<Dashboard>[],
    queryOptions?: IQueryOptions,
    forceManualId = false,
  ): Promise<Partial<Dashboard>[]> => {
    if (
      data.every((item) => item.id !== undefined && item.id !== null) ||
      !this.isMssql() ||
      !forceManualId
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
    data: Partial<Dashboard> | Partial<Dashboard>[],
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
