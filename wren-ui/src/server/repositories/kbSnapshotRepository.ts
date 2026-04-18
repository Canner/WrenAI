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
  bridgeProjectId?: number | null;
  status: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface IKBSnapshotRepository extends IBasicRepository<KBSnapshot> {}

export class KBSnapshotRepository
  extends BaseRepository<KBSnapshot>
  implements IKBSnapshotRepository
{
  private readonly jsonColumns = ['manifestRef'];
  private readonly removedProjectBridgeColumnMatcher = 'legacyprojectid';

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
    const normalizedData = {
      ...(transformedData as Record<string, any>),
    };

    for (const key of Object.keys(normalizedData)) {
      if (key.toLowerCase() === this.removedProjectBridgeColumnMatcher) {
        delete normalizedData[key];
      }
    }

    return normalizedData as KBSnapshot;
  };

  protected override transformToDBData = (data: Partial<KBSnapshot>) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }

    const normalizedData = {
      ...(data as Record<string, any>),
    };
    delete normalizedData.bridgeProjectId;

    const transformedData = mapValues(normalizedData, (value, key) => {
      if (this.jsonColumns.includes(key) && typeof value !== 'string') {
        return JSON.stringify(value);
      }
      return value;
    });

    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };
}
