import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import {
  SupportedDataSource,
  IIbisAdaptor,
  IbisQueryResponse,
  IbisPostgresConnectionInfo,
  IbisBigQueryConnectionInfo,
  ValidationRules,
  QueryOptions,
} from '../adaptors/ibisAdaptor';
import { Encryptor, getLogger } from '@server/utils';
import {
  BIG_QUERY_CONNECTION_INFO,
  POSTGRES_CONNECTION_INFO,
  Project,
} from '../repositories';
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

export interface DescribeStatementResponse {
  columns: ColumnMetadata[];
}

export interface PreviewOptions {
  project: Project;
  modelingOnly?: boolean;
  mdl: Manifest;
  limit?: number;
  dryRun?: boolean;
  // if not given, will use the deployed manifest
}

export interface SqlValidateOptions {
  project: Project;
  mdl: Manifest;
  modelingOnly?: boolean;
}

export interface ComposeConnectionInfoResult {
  datasource: DataSourceName;
  connectionInfo?: IbisPostgresConnectionInfo | IbisBigQueryConnectionInfo;
}

export interface ValidateResponse {
  valid: boolean;
  message?: string;
}

export interface IQueryService {
  preview(
    sql: string,
    options: PreviewOptions,
  ): Promise<PreviewDataResponse | boolean>;

  describeStatement(
    sql: string,
    options: PreviewOptions,
  ): Promise<DescribeStatementResponse>;

  validate(
    project: Project,
    rule: ValidationRules,
    manifest: Manifest,
    parameters: Record<string, any>,
  ): Promise<ValidateResponse>;
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

  public async preview(
    sql: string,
    options: PreviewOptions,
  ): Promise<PreviewDataResponse | boolean> {
    const { project, mdl, limit, dryRun } = options;

    const dataSource = project.type;
    if (this.useEngine(dataSource)) {
      logger.debug('Using wren engine for preview');
      const data = await this.wrenEngineAdaptor.previewData(sql, limit, mdl);
      return data as PreviewDataResponse;
    } else {
      logger.debug('Use ibis adaptor for preview');
      // add alias to FROM clause to prevent ibis error
      // ibis server does not have limit parameter, should handle it in sql
      const rewrittenSql = limit
        ? `SELECT tmp.* FROM (${sql}) tmp LIMIT ${limit}`
        : sql;
      const { connectionInfo } = this.transformToIbisConnectionInfo(project);
      this.checkDataSourceIsSupported(dataSource);
      const queryOptions = {
        dataSource,
        connectionInfo,
        mdl,
        dryRun,
      } as QueryOptions;
      if (dryRun) {
        return await this.tryDryRun(rewrittenSql, queryOptions);
      } else {
        const data = await this.ibisAdaptor.query(rewrittenSql, queryOptions);
        return this.transformDataType(data);
      }
    }
  }

  public async describeStatement(
    sql: string,
    options: PreviewOptions,
  ): Promise<DescribeStatementResponse> {
    try {
      // preview data with limit 1 to get column metadata
      options.limit = 1;
      const res = (await this.preview(sql, options)) as PreviewDataResponse;
      return { columns: res.columns };
    } catch (err: any) {
      logger.debug(`Got error when describing statement: ${err.message}`);
      throw err;
    }
  }

  public async validate(
    project,
    rule: ValidationRules,
    manifest: Manifest,
    parameters: Record<string, any>,
  ): Promise<ValidateResponse> {
    const { connectionInfo } = this.transformToIbisConnectionInfo(project);
    const dataSource = project.type;
    const res = await this.ibisAdaptor.validate(
      dataSource,
      rule,
      connectionInfo,
      manifest,
      parameters,
    );
    return res;
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
            password,
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

  private async tryDryRun(
    rewrittenSql: string,
    queryOptions: QueryOptions,
  ): Promise<boolean> {
    try {
      await this.ibisAdaptor.dryRun(rewrittenSql, queryOptions);
      return true;
    } catch (_err) {
      return false;
    }
  }
}
