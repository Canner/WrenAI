/** 
    This class is responsible for handling the retrieval of metadata from the data source.
    For DuckDB, we control the access logic and directly query the WrenEngine.
    For PostgreSQL and BigQuery, we will use the Ibis server API.
 */

import {
  IbisBigQueryConnectionInfo,
  IIbisAdaptor,
  IbisPostgresConnectionInfo,
} from '../adaptors/ibisAdaptor';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import { getConfig } from '@server/config';
import {
  BIG_QUERY_CONNECTION_INFO,
  POSTGRES_CONNECTION_INFO,
  Project,
} from '../repositories';
import { DataSourceName } from '../types';
import { Encryptor, getLogger } from '@server/utils';

const logger = getLogger('MetadataService');
logger.level = 'debug';

const config = getConfig();

export interface CompactColumn {
  name: string;
  type: string;
  notNull: boolean;
  description?: string;
  properties?: Record<string, any>;
}

export enum ConstraintType {
  PRIMARY_KEY = 'PRIMARY KEY',
  FOREIGN_KEY = 'FOREIGN KEY',
  UNIQUE = 'UNIQUE',
}

export interface CompactTable {
  name: string;
  columns: CompactColumn[];
  description?: string;
  properties?: Record<string, any>;
  primaryKey?: string;
}

export interface RecommendConstraint {
  constraintName: string;
  constraintType: ConstraintType;
  constraintTable: string;
  constraintColumn: string;
  constraintedTable: string;
  constraintedColumn: string;
}

export interface IDataSourceMetadataService {
  listTables(project: Project): Promise<CompactTable[]>;
  listConstraints(project: Project): Promise<RecommendConstraint[]>;
}

export class DataSourceMetadataService implements IDataSourceMetadataService {
  private readonly ibisAdaptor: IIbisAdaptor;
  private readonly wrenEngineAdaptor: IWrenEngineAdaptor;

  constructor({
    ibisAdaptor,
    wrenEngineAdaptor,
  }: {
    ibisAdaptor: IIbisAdaptor;
    wrenEngineAdaptor: IWrenEngineAdaptor;
  }) {
    this.ibisAdaptor = ibisAdaptor;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
  }

  public async listTables(project): Promise<CompactTable[]> {
    const { type: datasource } = project;
    if (datasource === DataSourceName.DUCKDB) {
      const tables = await this.wrenEngineAdaptor.listTables();
      return tables;
    } else {
      const { connectionInfo } = this.transformToIbisConnectionInfo(project);
      const { tables } = await this.ibisAdaptor.getTables(
        datasource,
        connectionInfo,
      );
      return tables;
    }
  }

  public async listConstraints(
    project: Project,
  ): Promise<RecommendConstraint[]> {
    const { type: datasource } = project;
    if (datasource === DataSourceName.DUCKDB) {
      return [];
    } else {
      const { connectionInfo } = this.transformToIbisConnectionInfo(project);
      const { constraints } = await this.ibisAdaptor.getConstraints(
        datasource,
        connectionInfo,
      );
      logger.debug(`Constraint len: ${constraints.length}`);
      return constraints;
    }
  }

  // transform connection info to ibis connection info format
  private transformToIbisConnectionInfo(project: Project) {
    const { type } = project;
    switch (type) {
      case DataSourceName.POSTGRES: {
        const connectionInfo =
          project.connectionInfo as POSTGRES_CONNECTION_INFO;
        const encryptor = new Encryptor(config);
        const decryptedCredentials = encryptor.decrypt(connectionInfo.password);
        const { password } = JSON.parse(decryptedCredentials);
        return {
          connectionInfo: {
            ...connectionInfo,
            password: password,
          } as IbisPostgresConnectionInfo,
        };
      }
      case DataSourceName.BIG_QUERY: {
        const connectionInfo =
          project.connectionInfo as BIG_QUERY_CONNECTION_INFO;
        const encryptor = new Encryptor(config);
        const decryptedCredentials = encryptor.decrypt(
          connectionInfo.credentials,
        );
        const credential = Buffer.from(decryptedCredentials).toString('base64');
        return {
          connectionInfo: {
            project_id: connectionInfo.projectId,
            dataset_id: connectionInfo.datasetId,
            credentials: credential,
          } as IbisBigQueryConnectionInfo,
        };
      }
      default:
        throw new Error(`Unsupported project type: ${type}`);
    }
  }
}
