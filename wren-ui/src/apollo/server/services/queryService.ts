import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import {
  SupportedDataSource,
  IIbisAdaptor,
  IbisQueryResponse,
  POSTGRESConnectionInfo,
  BIGQUERYConnectionInfo,
} from '../adaptors/ibisAdaptor';
import { Encryptor, getLogger } from '@server/utils';
import { Project } from '../repositories';
import { getConfig } from '../config';

const logger = getLogger('QueryService');
logger.level = 'debug';

const config = getConfig();

export interface ColumnMetadata {
  name: string;
  type: string;
}

export interface PreviewDataResponse {
  columns: ColumnMetadata[];
  data: any[][];
}

export interface PreviewOptions {
  datasource: DataSourceName;
  connectionInfo: POSTGRESConnectionInfo | BIGQUERYConnectionInfo;
  modelingOnly?: boolean;
  limit?: number;
  // if not given, will use the deployed manifest
  mdl?: Manifest;
}

export interface SqlValidateOptions {
  datasource: DataSourceName;
  connectionInfo: POSTGRESConnectionInfo | BIGQUERYConnectionInfo;
  modelingOnly?: boolean;
  mdl?: Manifest;
}

export interface ComposeConnectionInfoResult {
  datasource: DataSourceName;
  connectionInfo?: POSTGRESConnectionInfo | BIGQUERYConnectionInfo;
}

export interface IQueryService {
  preview(sql: string, options: PreviewOptions): Promise<PreviewDataResponse>;

  describeStatement(sql: string, options: PreviewOptions): Promise<any>;

  /**
   * DTO to compose connection info from project settings for ibis server
   * @param project
   */
  composeConnectionInfo(project: Project): ComposeConnectionInfoResult;

  /**
   * To know a mdl sql is valid for datasource
   * @param sql : mdl sql
   * @param options :
   */
  sqlValidate(sql: string, options: SqlValidateOptions): Promise<any>;
}

export class QueryService implements IQueryService {
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

  async preview(
    sql: string,
    options: PreviewOptions,
  ): Promise<PreviewDataResponse> {
    const { datasource, connectionInfo } = options;
    if (this.useEngine(datasource)) {
      logger.debug('Using wren engine for preview');
      const data = await this.wrenEngineAdaptor.previewData(
        sql,
        options.limit,
        options.mdl,
      );
      return data as PreviewDataResponse;
    } else {
      logger.debug('Use ibis adaptor for preview');
      // add alias to FROM clause to prevent ibis error
      // ibis server does not have limit parameter, should handle it in sql
      const rewrittenSql = options.limit
        ? `SELECT tmp.* FROM (${sql}) tmp LIMIT ${options.limit}`
        : sql;
      const nativeSql = await this.wrenEngineAdaptor.getNativeSQL(
        rewrittenSql,
        {
          modelingOnly: options.modelingOnly,
          manifest: options.mdl,
        },
      );
      logger.debug(`Native SQL: ${nativeSql}`);

      this.checkDataSourceIsSupported(datasource);
      // time ibis performance
      const start = new Date().getTime();
      const data = await this.ibisAdaptor.query(
        nativeSql,
        datasource,
        connectionInfo,
      );
      const end = new Date().getTime();
      logger.debug(`Ibis query took ${end - start} ms`);
      return this.transformDataType(data);
    }
  }

  public async describeStatement(
    sql: string,
    options: PreviewOptions,
  ): Promise<any> {
    try {
      // preview data with limit 1 to get column metadata
      options.limit = 1;
      const res = await this.preview(sql, options);
      return { columns: res.columns };
    } catch (err: any) {
      logger.debug(`Got error when describing statement: ${err.message}`);
      throw err;
    }
  }

  public composeConnectionInfo(project: Project) {
    const { type } = project;
    switch (type) {
      case DataSourceName.POSTGRES: {
        const encryptor = new Encryptor(config);
        const decryptedCredentials = encryptor.decrypt(project.credentials);
        const { password } = JSON.parse(decryptedCredentials);
        return {
          datasource: DataSourceName.POSTGRES,
          connectionInfo: {
            host: project.host,
            port: project.port,
            database: project.database,
            user: project.user,
            password,
          } as POSTGRESConnectionInfo,
        };
      }
      case DataSourceName.BIG_QUERY: {
        const encryptor = new Encryptor(config);
        const decryptedCredentials = encryptor.decrypt(project.credentials);
        const credential = Buffer.from(decryptedCredentials).toString('base64');
        return {
          datasource: DataSourceName.BIG_QUERY,
          connectionInfo: {
            project_id: project.projectId,
            dataset_id: project.datasetId,
            credentials: credential,
          } as BIGQUERYConnectionInfo,
        };
      }
      case DataSourceName.DUCKDB: {
        return {
          datasource: DataSourceName.DUCKDB,
        };
      }
      default:
        throw new Error(`Unsupported project type: ${type}`);
    }
  }

  async sqlValidate(sql, options): Promise<any> {
    const { datasource, connectionInfo } = options;
    if (this.useEngine(datasource)) {
      return await this.wrenEngineAdaptor.previewData(
        sql,
        options.limit,
        options.mdl,
      );
    } else {
      const nativeSql = await this.wrenEngineAdaptor.getNativeSQL(sql, {
        modelingOnly: options.modelingOnly,
        manifest: options.mdl,
      });

      // throw error if datasource not in supported list
      this.checkDataSourceIsSupported(datasource);

      return await this.ibisAdaptor.query(
        nativeSql,
        datasource as any,
        connectionInfo,
      );
    }
  }

  private useEngine(dataSource: DataSourceName): boolean {
    if (dataSource === DataSourceName.DUCKDB) {
      return true;
    } else {
      return false;
    }
  }

  private transformDataType(data: IbisQueryResponse): PreviewDataResponse {
    const columns = data.columns;
    const dtypes = data.dtypes;
    const transformedColumns = columns.map((column) => {
      let type = 'unknown';
      if (dtypes && dtypes[column]) {
        type = dtypes[column] === 'object' ? 'string' : dtypes[column];
      }
      if (type === 'unknown') {
        logger.debug(`Did not find type mapping for "${column}"`);
        logger.debug(
          `dtypes mapping: ${dtypes ? JSON.stringify(dtypes, null, 2) : 'undefined'} `,
        );
      }
      return {
        name: column,
        type,
      } as ColumnMetadata;
    });
    return {
      columns: transformedColumns,
      data: data.data,
    } as PreviewDataResponse;
  }

  private checkDataSourceIsSupported(dataSource: DataSourceName) {
    if (
      !Object.prototype.hasOwnProperty.call(SupportedDataSource, dataSource)
    ) {
      throw new Error(`Unsupported datasource for ibis: "${dataSource}"`);
    }
  }
}
