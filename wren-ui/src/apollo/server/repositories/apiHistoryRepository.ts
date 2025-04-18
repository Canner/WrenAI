import { camelCase, isPlainObject, mapKeys, mapValues } from 'lodash';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { Knex } from 'knex';

export enum ApiType {
  GENERATE_SQL = 'GENERATE_SQL',
  RUN_SQL = 'RUN_SQL',
}

export enum ApiStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface ApiHistory {
  id?: number;
  projectId: number;
  apiType: ApiType;
  threadId?: number;
  input?: Record<string, any>;
  headers?: Record<string, string>;
  requestPayload?: Record<string, any>;
  responsePayload?: Record<string, any>;
  status: ApiStatus;
  durationMs?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface IApiHistoryRepository extends IBasicRepository<ApiHistory> {}

export class ApiHistoryRepository
  extends BaseRepository<ApiHistory>
  implements IApiHistoryRepository
{
  private readonly jsonbColumns = [
    'headers',
    'requestPayload',
    'responsePayload',
    'input',
  ];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'api_history' });
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
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    }) as ApiHistory;
    return formattedData;
  };
}
