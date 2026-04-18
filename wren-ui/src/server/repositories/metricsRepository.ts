import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface Metric {
  id: number; // ID
  projectId: number; // Reference to project.id
  name: string; // Metric name
  type: string; // Metric type, ex: "simple" or "cumulative"
  cached: boolean; // Model is cached or not
  refreshTime?: string; // Contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"

  // metric can based on model or another metric
  modelId?: number; // Reference to model.id
  metricId?: number; // Reference to metric.id
  properties?: string; // Metric properties, a json string, the description and displayName should be stored here
}

export interface IMetricRepository extends IBasicRepository<Metric> {}

export class MetricRepository
  extends BaseRepository<Metric>
  implements IMetricRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'metric' });
  }
}
