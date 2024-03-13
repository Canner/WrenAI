import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

export interface Project {
  id: number; // ID
  type: string; // Project datasource type. ex: bigquery, mysql, postgresql, mongodb, etc
  displayName: string; // Project display name
  projectId: string; // GCP project id, big query specific
  location: string; // GCP location, big query specific
  dataset: string; // GCP location, big query specific
  credentials: string; // Project credentials, big query specific
  catalog: string; // Catalog name
  schema: string; // Schema name
}

export interface IProjectRepository extends IBasicRepository<Project> {}

export class ProjectRepository extends BaseRepository<Project> {
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'project' });
  }
}
