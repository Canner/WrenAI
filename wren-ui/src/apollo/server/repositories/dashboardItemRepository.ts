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

export enum DashboardItemType {
  // AI chart types, refer to ChartType in adaptor.ts
  AREA = 'AREA',
  BAR = 'BAR',
  GROUPED_BAR = 'GROUPED_BAR',
  LINE = 'LINE',
  PIE = 'PIE',
  STACKED_BAR = 'STACKED_BAR',
  // other types
  TABLE = 'TABLE',
  NUMBER = 'NUMBER',
}

export interface DashboardItemLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardItemDetail {
  sql: string;
  chartSchema?: Record<string, any>;
  previewDataSnapshot?: Record<string, any>[];
}

export interface DashboardItem {
  id: number;
  dashboardId: number;
  type: DashboardItemType;
  layout: DashboardItemLayout;
  detail: DashboardItemDetail;
  displayName?: string;
  title?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IDashboardItemRepository
  extends IBasicRepository<DashboardItem> {}

export class DashboardItemRepository
  extends BaseRepository<DashboardItem>
  implements IDashboardItemRepository
{
  private readonly jsonbColumns = ['layout', 'detail'];
  private hasIdColumnCache: boolean | null = null;
  private hasIdentityIdPromise?: Promise<boolean>;
  private hasTitleColumnCache: boolean | null = null;
  private hasDisplayNameColumnCache: boolean | null = null;
  private columnCache = new Map<string, boolean>();

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'dashboard_item' });
  }

  public override async createOne(
    data: Partial<DashboardItem>,
    queryOptions?: IQueryOptions,
  ): Promise<DashboardItem> {
    return await super.createOne(
      await this.normalizeWriteData(data, queryOptions, true),
      queryOptions,
    );
  }

  public override async updateOne(
    id: string | number,
    data: Partial<DashboardItem>,
    queryOptions?: IQueryOptions,
  ): Promise<DashboardItem> {
    return await super.updateOne(
      id,
      await this.normalizeWriteData(data, queryOptions),
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
        } else {
          return value;
        }
      }
      return value;
    });
    return {
      ...transformData,
      displayName: transformData.displayName || transformData.title,
    } as DashboardItem;
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

  private async normalizeWriteData(
    data: Partial<DashboardItem>,
    queryOptions?: IQueryOptions,
    includeGeneratedId = false,
  ): Promise<Partial<DashboardItem>> {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const [
      hasIdColumn,
      hasTitleColumn,
      hasDisplayNameColumn,
      hasCreatedAtColumn,
      hasUpdatedAtColumn,
    ] =
      await Promise.all([
        this.hasColumn('id', executer),
        this.hasColumn('title', executer),
        this.hasColumn('display_name', executer),
        this.hasColumn('created_at', executer),
        this.hasColumn('updated_at', executer),
      ]);
    const normalizedData: Partial<DashboardItem> = { ...data };
    const displayName =
      typeof data.displayName === 'string' ? data.displayName.trim() : '';
    const chartTitle =
      typeof data.detail?.chartSchema?.title === 'string'
        ? data.detail.chartSchema.title.trim()
        : '';
    const title = displayName || chartTitle || 'Untitled dashboard item';

    if (hasTitleColumn && !normalizedData.title) {
      normalizedData.title = title;
    }
    if (!hasDisplayNameColumn) {
      delete normalizedData.displayName;
    }
    if (
      includeGeneratedId &&
      hasIdColumn &&
      normalizedData.id === undefined &&
      this.isMssqlLike(executer) &&
      !(await this.hasIdentityId(executer))
    ) {
      normalizedData.id = await this.getNextId(executer);
    }
    if (includeGeneratedId && hasCreatedAtColumn && !normalizedData.createdAt) {
      normalizedData.createdAt = new Date();
    }
    if (includeGeneratedId && hasUpdatedAtColumn && !normalizedData.updatedAt) {
      normalizedData.updatedAt = normalizedData.createdAt || new Date();
    }

    return normalizedData;
  }

  private async hasColumn(column: string, executer: Knex | Knex.Transaction) {
    if (this.columnCache.has(column)) {
      return this.columnCache.get(column);
    }
    if (column === 'id' && this.hasIdColumnCache !== null) {
      return this.hasIdColumnCache;
    }
    if (column === 'title' && this.hasTitleColumnCache !== null) {
      return this.hasTitleColumnCache;
    }
    if (
      column === 'display_name' &&
      this.hasDisplayNameColumnCache !== null
    ) {
      return this.hasDisplayNameColumnCache;
    }

    const result = await executer.schema.hasColumn(this.tableName, column);
    this.columnCache.set(column, result);
    if (column === 'id') {
      this.hasIdColumnCache = result;
    }
    if (column === 'title') {
      this.hasTitleColumnCache = result;
    }
    if (column === 'display_name') {
      this.hasDisplayNameColumnCache = result;
    }
    return result;
  }

  private isMssqlLike(executer: Knex | Knex.Transaction) {
    const clientName = String(executer.client.config.client || '').toLowerCase();
    const dialect = String((executer.client as any).dialect || '').toLowerCase();
    const driverName = String(
      (executer.client as any).driverName || '',
    ).toLowerCase();

    return [clientName, dialect, driverName].some((value) =>
      value.includes('mssql'),
    );
  }

  private async hasIdentityId(executer: Knex | Knex.Transaction) {
    if (!this.isMssqlLike(executer)) {
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

  private async getNextId(executer: Knex | Knex.Transaction) {
    const [row] = await executer(this.tableName).max<{
      maxId: number | string | null;
    }>('id as maxId');
    return Number(row?.maxId || 0) + 1;
  }
}
