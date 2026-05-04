import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';

export interface Model {
  id: number; // ID
  projectId: number; // Reference to project.id
  displayName: string; // Model name displayed in UI
  sourceTableName: string; // the table name in the datasource
  referenceName: string; // the name used in the MDL structure
  refSql: string; // Reference SQL
  cached: boolean; // Model is cached or not
  refreshTime: string | null; // Contain a number followed by a time unit (ns, us, ms, s, m, h, d). For example, "2h"
  properties: string | null; // Model properties, a json string, the description and displayName should be stored here
}

export interface IModelRepository extends IBasicRepository<Model> {
  findAllByIds(ids: number[]): Promise<Model[]>;
  deleteAllBySourceTableNames(
    sourceTableNames: string[],
    queryOptions?: IQueryOptions,
  ): Promise<number>;
}

export class ModelRepository
  extends BaseRepository<Model>
  implements IModelRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'model' });
  }
  public async findAllByIds(ids: number[]) {
    const res = await this.knex<Model>(this.tableName).whereIn('id', ids);
    return res.map((r) => this.transformFromDBData(r));
  }

  public async deleteAllBySourceTableNames(
    sourceTableNames: string[],
    queryOptions?: IQueryOptions,
  ) {
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const builder = executer(this.tableName)
      .whereIn('source_table_name', sourceTableNames)
      .delete();
    return await builder;
  }
}
