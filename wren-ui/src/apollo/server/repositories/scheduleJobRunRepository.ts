import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface ScheduleJobRun {
  id: string;
  scheduleJobId: string;
  traceId?: string | null;
  status: string;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  errorMessage?: string | null;
  detailJson?: Record<string, any> | null;
}

export interface IScheduleJobRunRepository extends IBasicRepository<ScheduleJobRun> {}

export class ScheduleJobRunRepository
  extends BaseRepository<ScheduleJobRun>
  implements IScheduleJobRunRepository
{
  private readonly jsonColumns = ['detailJson'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'schedule_job_run' });
  }

  protected override transformFromDBData = (data: any): ScheduleJobRun => {
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

    return transformedData as ScheduleJobRun;
  };

  protected override transformToDBData = (data: Partial<ScheduleJobRun>) => {
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
