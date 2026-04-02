import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface ScheduleJob {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  kbSnapshotId: string;
  deployHash: string;
  targetType: string;
  targetId: string;
  cronExpr: string;
  timezone: string;
  status: string;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  lastError?: string | null;
  createdBy?: string | null;
}

export interface IScheduleJobRepository extends IBasicRepository<ScheduleJob> {}

export class ScheduleJobRepository
  extends BaseRepository<ScheduleJob>
  implements IScheduleJobRepository
{
  private readonly jsonColumns = [];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'schedule_job' });
  }

  protected override transformFromDBData = (data: any): ScheduleJob => {
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

    return transformedData as ScheduleJob;
  };

  protected override transformToDBData = (data: Partial<ScheduleJob>) => {
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
