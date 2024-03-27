import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import { camelCase, mapKeys } from 'lodash';
import { AskResultStatus, WrenAIError } from '../adaptors/wrenAIAdaptor';

export interface ThreadResponse {
  id: number; // ID
  threadId: number; // Reference to thread.id
  queryId: string; // Thread response query ID
  question: string; // Thread response question
  status: string; // Thread response status
  detail: object; // Thread response detail
  error: object; // Thread response error
}

export interface ThreadResponseWithThreadSummary extends ThreadResponse {
  summary: string;
  sql: string;
}

export interface IThreadResponseRepository
  extends IBasicRepository<ThreadResponse> {
  getResponsesWithThread(
    threadId: number,
  ): Promise<ThreadResponseWithThreadSummary[]>;
}

export class ThreadResponseRepository
  extends BaseRepository<ThreadResponse>
  implements IThreadResponseRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread_response' });
  }

  public async getResponsesWithThread(threadId: number) {
    const responses = await this.knex(this.tableName)
      .select('thread_response.*')
      .select('thread.summary as summary')
      .select('thread.sql as sql')
      .where({ thread_id: threadId })
      .leftJoin('thread', 'thread.id', 'thread_response.thread_id');

    return responses
      .map((res) => {
        // turn object keys into camelCase
        return mapKeys(res, (_, key) => camelCase(key));
      })
      .map((res) => {
        // JSON.parse detail and error
        return {
          ...res,
          detail: res.detail ? JSON.parse(res.detail) : null,
          error: res.error ? JSON.parse(res.error) : null,
        };
      }) as ThreadResponseWithThreadSummary[];
  }

  public async findOneBy(
    filter: Partial<ThreadResponse>,
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const query = executer(this.tableName).where(
      this.transformToDBData(filter),
    );
    if (queryOptions?.limit) {
      query.limit(queryOptions.limit);
    }

    const result = await query;
    const transformed =
      result && result.length > 0
        ? // turn object keys into camelCase
          mapKeys(result[0], (_value, key) => camelCase(key))
        : null;

    // JSON.parse detail and error
    return transformed
      ? ({
          ...transformed,
          detail: transformed.detail ? JSON.parse(transformed.detail) : null,
          error: transformed.error ? JSON.parse(transformed.error) : null,
        } as ThreadResponse)
      : null;
  }

  public async updateOne(
    id: string | number,
    data: Partial<{
      status: AskResultStatus;
      detail: object;
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
}
