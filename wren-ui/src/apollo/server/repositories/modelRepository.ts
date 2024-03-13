import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface Model {
  id: number; // ID
  name: string; // Model name
  projectId: number; // Reference to project.id
  tableName: string; // Referenced table name in the datasource
  refSql: string; // Reference SQL
  cached: boolean; // Model is cached or not
  refreshTime: string | null; // Contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"
  properties: string | null; // Model properties, a json string, the description and displayName should be stored here
}

export interface IModelRepository extends IBasicRepository<Model> {}

export class ModelRepository extends BaseRepository<Model> {
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'model' });
  }
}
