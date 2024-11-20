import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import { camelCase, isPlainObject, mapKeys, mapValues } from 'lodash';
import { AskResultStatus, WrenAIError } from '@server/models/adaptor';

export interface DetailStep {
  summary: string;
  sql: string;
  cteName: string;
}

export interface ThreadResponseDetail {
  viewId?: number;
  description: string;
  steps: Array<DetailStep>;
}

export interface ThreadResponse {
  id: number; // ID
  threadId: number; // Reference to thread.id
  queryId: string; // Thread response query ID
  question: string; // Thread response question
  status: string; // Thread response status
  detail: ThreadResponseDetail; // Thread response detail
  error: object; // Thread response error
}

export interface ThreadResponseWithThreadContext extends ThreadResponse {
  sql: string;
}

export interface IThreadResponseRepository
  extends IBasicRepository<ThreadResponse> {
  getResponsesWithThread(
    threadId: number,
    limit?: number,
  ): Promise<ThreadResponseWithThreadContext[]>;
}

export class ThreadResponseRepository
  extends BaseRepository<ThreadResponse>
  implements IThreadResponseRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread_response' });
  }

  public async getResponsesWithThread(threadId: number, limit?: number) {
    const query = this.knex(this.tableName)
      .select('thread_response.*')
      .select('thread.sql as sql')
      .where({ thread_id: threadId })
      .leftJoin('thread', 'thread.id', 'thread_response.thread_id');

    if (limit) {
      query.orderBy('created_at', 'desc').limit(limit);
    }

    return (await query)
      .map((res) => {
        // turn object keys into camelCase
        return mapKeys(res, (_, key) => camelCase(key));
      })
      .map((res) => {
        // JSON.parse detail and error
        const detail =
          res.detail && typeof res.detail === 'string'
            ? JSON.parse(res.detail)
            : res.detail;
        const error =
          res.error && typeof res.error === 'string'
            ? JSON.parse(res.error)
            : res.error;
        return {
          ...res,
          detail: detail || null,
          error: error || null,
        };
      }) as ThreadResponseWithThreadContext[];
  }

  public async updateOne(
    id: string | number,
    data: Partial<{
      status: AskResultStatus;
      detail: ThreadResponseDetail;
      error: WrenAIError;
    }>,
    queryOptions?: IQueryOptions,
  ) {
    const transformedData = {
      ...data,
      detail: data.detail ? JSON.stringify(data.detail) : null,
      error: data.error ? JSON.stringify(data.error) : null,
    };
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const [result] = await executer(this.tableName)
      .where({ id })
      .update(transformedData)
      .returning('*');
    return this.transformFromDBData(result);
  }

  protected override transformFromDBData = (data: any): ThreadResponse => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (['error', 'detail'].includes(key)) {
        // The value from Sqlite will be string type, while the value from PG is JSON object
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    }) as ThreadResponse;
    return formattedData;
  };
}
