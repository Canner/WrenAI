import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface View {
  id: number; // ID
  projectId: number; // Reference to project.id
  name: string; // The view name
  statement: string; // The SQL statement of this view
  cached: boolean; // View is cached or not
  refreshTime?: string; // Contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"
  properties?: string; // View properties, a json string, the description and displayName should be stored here
}

export interface IViewRepository extends IBasicRepository<View> {}

export class ViewRepository
  extends BaseRepository<View>
  implements IViewRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'view' });
  }
}
