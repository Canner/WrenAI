import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface ThreadRecommendationQuestionResult {
  question: string;
  explanation: string;
  category: string;
}

export interface Thread {
  id: number; // ID
  projectId: number; // Reference to project.id
  sql: string; // SQL
  summary: string; // Thread summary

  // recommend question
  queryId?: string; // Query ID
  questions?: ThreadRecommendationQuestionResult[]; // Recommended questions
  questionsStatus?: string; // Status of the recommended questions
  questionsError?: object; // Error of the recommended questions
}

export interface IThreadRepository extends IBasicRepository<Thread> {
  listAllTimeDescOrder(projectId: number): Promise<Thread[]>;
}

export class ThreadRepository
  extends BaseRepository<Thread>
  implements IThreadRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread' });
  }

  public async listAllTimeDescOrder(projectId: number): Promise<Thread[]> {
    const threads = await this.knex(this.tableName)
      .where(this.transformToDBData({ projectId }))
      .orderBy('created_at', 'desc');
    return threads.map((thread) => this.transformFromDBData(thread));
  }
}
