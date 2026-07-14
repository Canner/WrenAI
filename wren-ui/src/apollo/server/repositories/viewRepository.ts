import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
  coerceBoolean,
} from './baseRepository';

export interface View {
  id: number; // ID
  projectId: number; // Reference to project.id
  name: string; // The view name
  statement: string; // The SQL statement of this view
  cached: boolean; // View is cached or not
  refreshTime?: string; // Contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"
  properties?: string; // View properties, a json string, the description and displayName should be stored here
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IViewRepository extends IBasicRepository<View> {}

export class ViewRepository
  extends BaseRepository<View>
  implements IViewRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'view' });
  }

  public override async createOne(
    data: Partial<View>,
    queryOptions?: IQueryOptions,
  ): Promise<View> {
    return super.createOne(this.withTimestamps(data), queryOptions);
  }

  public override async updateOne(
    id: string | number,
    data: Partial<View>,
    queryOptions?: IQueryOptions,
  ): Promise<View> {
    return super.updateOne(
      id,
      {
        ...data,
        updatedAt: data.updatedAt ?? new Date(),
      },
      queryOptions,
    );
  }

  protected override transformFromDBData = (data: any): View => {
    const view = this.defaultTransformFromDBData(data) as View;
    return {
      ...view,
      cached: coerceBoolean(view.cached),
    };
  };

  private withTimestamps = (data: Partial<View>): Partial<View> => {
    const now = new Date();
    return {
      ...data,
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
    };
  };
}
