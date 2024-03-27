import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

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
  threadSummary: string;
  threadSql: string;
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
      .select('thread.summary as threadSummary')
      .select('thread.sql as threadSql')
      .where({ threadId })
      .leftJoin('thread', 'thread.id', 'thread_response.threadId');

    return responses as ThreadResponseWithThreadSummary[];
  }
}
