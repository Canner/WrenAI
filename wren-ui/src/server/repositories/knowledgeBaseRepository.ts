import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface KnowledgeBase {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  kind?: string;
  description?: string | null;
  defaultKbSnapshotId?: string | null;
  primaryConnectorId?: string | null;
  runtimeProjectId?: number | null;
  language?: string | null;
  sampleDataset?: string | null;
  recommendationQueryId?: string | null;
  recommendationStatus?: string | null;
  recommendationQuestions?: Array<{
    question: string;
    category: string;
    sql: string;
  }> | null;
  recommendationError?: Record<string, any> | null;
  createdBy?: string | null;
  archivedAt?: Date | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IKnowledgeBaseRepository
  extends IBasicRepository<KnowledgeBase> {}

export class KnowledgeBaseRepository
  extends BaseRepository<KnowledgeBase>
  implements IKnowledgeBaseRepository
{
  private readonly jsonColumns = [
    'recommendationQuestions',
    'recommendationError',
  ];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'knowledge_base' });
  }

  protected override transformFromDBData = (data: any): KnowledgeBase => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const transformedData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonColumns.includes(key) && typeof value === 'string') {
        return value ? JSON.parse(value) : value;
      }
      return value;
    });

    return transformedData as KnowledgeBase;
  };

  protected override transformToDBData = (data: Partial<KnowledgeBase>) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonColumns.includes(key) && typeof value !== 'string') {
        return JSON.stringify(value);
      }
      return value;
    });

    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}
