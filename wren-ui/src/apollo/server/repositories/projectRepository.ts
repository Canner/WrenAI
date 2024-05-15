import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface Project {
  id: number; // ID
  type: string; // Project datasource type. ex: bigquery, mysql, postgresql, mongodb, etc
  displayName: string; // Project display name
  credentials: string; // Database credentials. General purpose field for storing credentials
  configurations: Record<string, any>; // Project connection configurations

  // bq
  projectId: string; // BigQuery project id
  datasetId: string; // BigQuery datasetId

  // duckdb
  initSql: string; // DuckDB init sql
  extensions: string[];

  // pg
  host: string; // Host
  port: number; // Port
  database: string; // Database
  user: string; // User

  catalog: string; // Catalog name
  schema: string; // Schema name
  sampleDataset: string; // Sample dataset name
}

export interface IProjectRepository extends IBasicRepository<Project> {
  getCurrentProject: () => Promise<Project>;
}

export class ProjectRepository
  extends BaseRepository<Project>
  implements IProjectRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'project' });
  }

  public async getCurrentProject() {
    const projects = await this.findAll({
      order: 'id',
      limit: 1,
    });
    if (!projects.length) {
      throw new Error('No project found');
    }
    return projects[0];
  }

  public override transformFromDBData: (data: any) => Project = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (['configurations', 'extensions'].includes(key)) {
        return JSON.parse(value);
      }
      return value;
    });
    return formattedData as Project;
  };

  public override transformToDBData: (data: Project) => any = (
    data: Project,
  ) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const snakeCaseData = mapKeys(data, (_value, key) => snakeCase(key));
    const formattedData = mapValues(snakeCaseData, (value, key) => {
      if (['configurations', 'extensions'].includes(key)) {
        return JSON.stringify(value);
      }
      return value;
    });
    return formattedData;
  };
}
