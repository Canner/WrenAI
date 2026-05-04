import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface MetricMeasure {
  id: number; // ID
  metricId: number; // Reference to metric ID
  name: string; // Measure name
  expression: string; // Expression for the measure
  granularity?: string; // Granularity for the measure, eg: "day", "hour", "minute", "year"
}

export interface IMetricMeasureRepository
  extends IBasicRepository<MetricMeasure> {}

export class MetricMeasureRepository
  extends BaseRepository<MetricMeasure>
  implements IMetricMeasureRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'metric_measure' });
  }
}
