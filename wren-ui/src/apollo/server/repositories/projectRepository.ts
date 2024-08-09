import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
  isEmpty,
} from 'lodash';
import { DataSourceName } from '@server/types';

export interface BIG_QUERY_CONNECTION_INFO {
  projectId: string;
  datasetId: string;
  credentials: string;
}
export interface POSTGRES_CONNECTION_INFO {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

export interface MYSQL_CONNECTION_INFO {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface MS_SQL_CONNECTION_INFO {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface CLICK_HOUSE_CONNECTION_INFO {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

export interface TRINO_CONNECTION_INFO {
  host: string;
  port: number;
  catalog: string;
  schema: string;
  username: string;
  password: string;
  ssl: boolean;
}

export interface DUCKDB_CONNECTION_INFO {
  initSql: string;
  extensions: Array<string>;
  configurations: Record<string, any>;
}

export type WREN_AI_CONNECTION_INFO =
  | BIG_QUERY_CONNECTION_INFO
  | POSTGRES_CONNECTION_INFO
  | MYSQL_CONNECTION_INFO
  | DUCKDB_CONNECTION_INFO
  | MS_SQL_CONNECTION_INFO
  | CLICK_HOUSE_CONNECTION_INFO
  | TRINO_CONNECTION_INFO;

export interface Project {
  id: number; // ID
  type: DataSourceName; // Project datasource type. ex: bigquery, mysql, postgresql, mongodb, etc
  displayName: string; // Project display name
  catalog: string; // Catalog name
  schema: string; // Schema name
  sampleDataset: string; // Sample dataset name
  connectionInfo: WREN_AI_CONNECTION_INFO;
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
      throw new Error('Unexpected db data');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (key === 'connectionInfo' && typeof value === 'string') {
        // should return {} if value is null / {}, use value ? {} : JSON.parse(value) will throw error when value is null
        return isEmpty(value) ? {} : JSON.parse(value);
      }
      if (key === 'type') {
        return DataSourceName[value];
      }
      return value;
    });
    return formattedData as Project;
  };

  public override transformToDBData: (data: Project) => any = (
    data: Project,
  ) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected db data');
    }
    const snakeCaseData = mapKeys(data, (_value, key) => snakeCase(key));
    const formattedData = mapValues(snakeCaseData, (value, key) => {
      if (key === 'connectionInfo') {
        return JSON.stringify(value);
      }
      return value;
    });
    return formattedData;
  };
}
