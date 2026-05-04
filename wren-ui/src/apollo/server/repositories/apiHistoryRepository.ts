import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { Knex } from 'knex';

export enum ApiType {
  GENERATE_SQL = 'GENERATE_SQL',
  RUN_SQL = 'RUN_SQL',
  GENERATE_VEGA_CHART = 'GENERATE_VEGA_CHART',
  GENERATE_SUMMARY = 'GENERATE_SUMMARY',
  ASK = 'ASK',
  GET_INSTRUCTIONS = 'GET_INSTRUCTIONS',
  CREATE_INSTRUCTION = 'CREATE_INSTRUCTION',
  UPDATE_INSTRUCTION = 'UPDATE_INSTRUCTION',
  DELETE_INSTRUCTION = 'DELETE_INSTRUCTION',
  GET_SQL_PAIRS = 'GET_SQL_PAIRS',
  CREATE_SQL_PAIR = 'CREATE_SQL_PAIR',
  UPDATE_SQL_PAIR = 'UPDATE_SQL_PAIR',
  DELETE_SQL_PAIR = 'DELETE_SQL_PAIR',
  GET_MODELS = 'GET_MODELS',
  STREAM_ASK = 'STREAM_ASK',
  STREAM_GENERATE_SQL = 'STREAM_GENERATE_SQL',
}

export interface ApiHistory {
  id?: string;
  projectId: number;
  apiType: ApiType;
  threadId?: string;
  headers?: Record<string, string>;
  requestPayload?: Record<string, any>;
  responsePayload?: Record<string, any>;
  statusCode?: number;
  durationMs?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaginationOptions {
  offset: number;
  limit: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface IApiHistoryRepository extends IBasicRepository<ApiHistory> {
  count(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
  ): Promise<number>;
  findAllWithPagination(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    pagination?: PaginationOptions,
  ): Promise<ApiHistory[]>;
}

export class ApiHistoryRepository
  extends BaseRepository<ApiHistory>
  implements IApiHistoryRepository
{
  private readonly jsonbColumns = [
    'headers',
    'requestPayload',
    'responsePayload',
  ];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'api_history' });
  }

  /**
   * Count API history records with filtering
   */
  public async count(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
  ): Promise<number> {
    let query = this.knex(this.tableName).count('id as count');

    if (filter) {
      query = query.where(this.transformToDBData(filter));
    }

    if (dateFilter) {
      if (dateFilter.startDate) {
        query = query.where('created_at', '>=', dateFilter.startDate);
      }

      if (dateFilter.endDate) {
        query = query.where('created_at', '<=', dateFilter.endDate);
      }
    }

    const result = await query;
    return parseInt(result[0].count as string, 10);
  }

  /**
   * Find API history records with pagination
   */
  public async findAllWithPagination(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    pagination?: PaginationOptions,
  ): Promise<ApiHistory[]> {
    let query = this.knex(this.tableName).select('*');

    if (filter) {
      query = query.where(this.transformToDBData(filter));
    }

    if (dateFilter) {
      if (dateFilter.startDate) {
        query = query.where('created_at', '>=', dateFilter.startDate);
      }

      if (dateFilter.endDate) {
        query = query.where('created_at', '<=', dateFilter.endDate);
      }
    }

    if (pagination) {
      if (pagination.orderBy) {
        Object.entries(pagination.orderBy).forEach(([field, direction]) => {
          query = query.orderBy(this.camelToSnakeCase(field), direction);
        });
      } else {
        // Default sort by created_at desc
        query = query.orderBy('created_at', 'desc');
      }

      query = query.offset(pagination.offset).limit(pagination.limit);
    }

    const result = await query;
    return result.map(this.transformFromDBData);
  }

  protected override transformFromDBData = (data: any): ApiHistory => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        // The value from Sqlite will be string type, while the value from PG is JSON object
        if (typeof value === 'string') {
          if (!value) return value;
          try {
            return JSON.parse(value);
          } catch (error) {
            console.error(`Failed to parse JSON for ${key}:`, error);
            return value; // Return raw value if parsing fails
          }
        } else {
          return value;
        }
      }
      return value;
    }) as ApiHistory;
    return formattedData;
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

  /**
   * Convert camelCase to snake_case for DB column names
   */
  private camelToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }
}
