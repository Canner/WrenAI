import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface SchemaChange {
  id: number; // ID
  projectId: number; // Reference to project.id
  change: string; // Schema change in JSON format
  resolve: string; // Save resolve in JSON format, for example: { "deletedTables": true, "deletedColumns": true, "modifiedColumns": false  }
}

export interface ISchemaChangeRepository
  extends IBasicRepository<SchemaChange> {
  findLastSchemaChange(projectId: number): Promise<SchemaChange | null>;
}

export class SchemaChangeRepository
  extends BaseRepository<SchemaChange>
  implements ISchemaChangeRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'schema_change' });
  }

  public async findLastSchemaChange(projectId: number) {
    const res = await this.knex
      .select('*')
      .from(this.tableName)
      .where(this.transformToDBData({ projectId }))
      .orderBy('created_at', 'desc')
      .first();
    return (res && this.transformFromDBData(res)) || null;
  }
}
