import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { ScheduleFrequencyEnum } from '@server/models/dashboard';

export interface Dashboard {
  id: number;
  projectId: number;
  name: string;
  cacheEnabled: boolean;
  scheduleFrequency: ScheduleFrequencyEnum | null;
  scheduleTimezone: string | null; // e.g. 'America/New_York', 'Asia/Taipei'
  scheduleCron: string | null; // cron expression string
  nextScheduledAt: Date | null; // Next scheduled run timestamp
}

export interface IDashboardRepository extends IBasicRepository<Dashboard> {}

export class DashboardRepository
  extends BaseRepository<Dashboard>
  implements IDashboardRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'dashboard' });
  }
}
