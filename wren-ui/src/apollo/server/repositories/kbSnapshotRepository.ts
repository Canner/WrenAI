import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface KBSnapshot {
  id: string;
  knowledgeBaseId: string;
  snapshotKey: string;
  displayName: string;
  environment?: string | null;
  versionLabel?: string | null;
  deployHash: string;
  manifestRef?: Record<string, any> | null;
  legacyProjectId?: number | null;
  status: string;
}

export interface IKBSnapshotRepository extends IBasicRepository<KBSnapshot> {}

export class KBSnapshotRepository
  extends BaseRepository<KBSnapshot>
  implements IKBSnapshotRepository
{
  private readonly jsonColumns = ['manifestRef'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'kb_snapshot' });
  }

  protected override transformFromDBData = (data: any): KBSnapshot => {
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

    return transformedData as KBSnapshot;
  };

  protected override transformToDBData = (data: Partial<KBSnapshot>) => {
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
