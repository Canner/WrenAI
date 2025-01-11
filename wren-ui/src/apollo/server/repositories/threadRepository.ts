import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
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
}

export interface IThreadRepository extends IBasicRepository<Thread> {
  listAllTimeDescOrder(projectId: number): Promise<Thread[]>;
}

export class ThreadRepository
  extends BaseRepository<Thread>
  implements IThreadRepository
{
  private readonly jsonbColumns = ['questions', 'questionsError'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread' });
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
}
