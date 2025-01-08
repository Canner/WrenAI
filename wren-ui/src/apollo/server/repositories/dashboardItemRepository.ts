import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
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
}

export interface DashboardItem {
  id: number;
  dashboardId: number;
  type: DashboardItemType;
  layout: DashboardItemLayout;
  detail: DashboardItemDetail;
}

export interface IDashboardItemRepository
  extends IBasicRepository<DashboardItem> {}

export class DashboardItemRepository
  extends BaseRepository<DashboardItem>
  implements IDashboardItemRepository
{
  private readonly jsonbColumns = ['layout', 'detail'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'dashboard_item' });
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
    return transformData as DashboardItem;
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
}
