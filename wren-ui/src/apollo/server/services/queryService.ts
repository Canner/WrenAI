import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import {
  SupportedDataSource,
  IIbisAdaptor,
  IbisQueryResponse,
  ValidationRules,
  IbisResponse,
} from '../adaptors/ibisAdaptor';
import { getLogger } from '@server/utils';
import { Project } from '../repositories';
import { PostHogTelemetry, TelemetryEvent } from '../telemetry/telemetry';

const logger = getLogger('QueryService');
logger.level = 'debug';

export const DEFAULT_PREVIEW_LIMIT = 500;
const MSSQL_DEADLOCK_RETRY_LIMIT = 2;
const MSSQL_DEADLOCK_RETRY_BASE_DELAY_MS = 150;

const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const errorText = (err: any) =>
  [
    err?.message,
    err?.response?.data?.message,
    err?.response?.data?.detail,
    err?.extensions?.message,
    err?.extensions?.originalError?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const isSqlServerDeadlockError = (err: any) => {
  const text = errorText(err);
  if (!text) {
    return false;
  }

  return (
    text.includes('deadlock') &&
    (text.includes('1205') ||
      text.includes('deadlock victim') ||
      text.includes('sqlexecdirectw') ||
      text.includes('sql server'))
  );
};

export interface ColumnMetadata {
  name: string;
  type: string;
}

export interface PreviewDataResponse extends IbisResponse {
  columns: ColumnMetadata[];
  data: any[][];
  cacheHit?: boolean;
  cacheCreatedAt?: string;
  cacheOverrodeAt?: string;
  override?: boolean;
}

export interface DescribeStatementResponse {
  columns: ColumnMetadata[];
}

export interface PreviewOptions {
  project: Project;
  modelingOnly?: boolean;
  // if not given, will use the deployed manifest
  manifest: Manifest;
  limit?: number;
  dryRun?: boolean;
  refresh?: boolean;
  cacheEnabled?: boolean;
}

export interface SqlValidateOptions {
  project: Project;
  mdl: Manifest;
  modelingOnly?: boolean;
}

export interface ValidateResponse {
  valid: boolean;
  message?: string;
}

export interface IQueryService {
  preview(
    sql: string,
    options: PreviewOptions,
  ): Promise<IbisResponse | PreviewDataResponse | boolean>;

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
  private readonly telemetry: PostHogTelemetry;

  constructor({
    ibisAdaptor,
    wrenEngineAdaptor,
    telemetry,
  }: {
    ibisAdaptor: IIbisAdaptor;
    wrenEngineAdaptor: IWrenEngineAdaptor;
    telemetry: PostHogTelemetry;
  }) {
    this.ibisAdaptor = ibisAdaptor;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
    this.telemetry = telemetry;
  }

  public async preview(
    sql: string,
    options: PreviewOptions,
  ): Promise<IbisResponse | PreviewDataResponse | boolean> {
    const {
      project,
      manifest: mdl,
      limit,
      dryRun,
      refresh,
      cacheEnabled,
    } = options;
    const { type: dataSource, connectionInfo } = project;
    if (this.useEngine(dataSource)) {
      if (dryRun) {
        logger.debug('Using wren engine to dry run');
        const startedAt = Date.now();
        await this.wrenEngineAdaptor.dryRun(sql, {
          manifest: mdl,
          limit,
        });
        logger.info(
          `Ask timing stage=sql_validation project_id=${project.id} data_source=${dataSource} engine=wren elapsed_ms=${
            Date.now() - startedAt
          }`,
        );
        return true;
      } else {
        logger.debug('Using wren engine to preview');
        const startedAt = Date.now();
        const data = await this.wrenEngineAdaptor.previewData(
          sql,
          mdl,
          limit,
        );
        logger.info(
          `Ask timing stage=sql_execution project_id=${project.id} data_source=${dataSource} engine=wren elapsed_ms=${
            Date.now() - startedAt
          } row_count=${(data as PreviewDataResponse)?.data?.length ?? ''}`,
        );
        return data as PreviewDataResponse;
      }
    } else {
      this.checkDataSourceIsSupported(dataSource);
      logger.debug('Use ibis adaptor to preview');
      if (dryRun) {
        return await this.ibisDryRun(
          sql,
          dataSource,
          connectionInfo,
          mdl,
        );
      } else {
        return await this.ibisQuery(
          sql,
          dataSource,
          connectionInfo,
          mdl,
          limit,
          refresh,
          cacheEnabled,
        );
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
    const { type: dataSource, connectionInfo } = project;
    const res = await this.ibisAdaptor.validate(
      dataSource,
      rule,
      connectionInfo,
      manifest,
      parameters,
    );
    return res;
  }

  private useEngine(dataSource: DataSourceName): boolean {
    if (dataSource === DataSourceName.DUCKDB) {
      return true;
    } else {
      return false;
    }
  }

  private checkDataSourceIsSupported(dataSource: DataSourceName) {
    if (
      !Object.prototype.hasOwnProperty.call(SupportedDataSource, dataSource)
    ) {
      throw new Error(`Unsupported datasource for ibis: "${dataSource}"`);
    }
  }

  private async ibisDryRun(
    sql: string,
    dataSource: DataSourceName,
    connectionInfo: any,
    mdl: Manifest,
  ): Promise<IbisResponse> {
    const event = TelemetryEvent.IBIS_DRY_RUN;
    const startedAt = Date.now();
    try {
      const res = await this.ibisAdaptor.dryRun(sql, {
        dataSource,
        connectionInfo,
        mdl,
      });
      this.sendIbisEvent(event, res, { dataSource, sql });
      logger.info(
        `Ask timing stage=sql_validation data_source=${dataSource} engine=ibis elapsed_ms=${
          Date.now() - startedAt
        }`,
      );
      return {
        correlationId: res.correlationId,
      };
    } catch (err: any) {
      logger.info(
        `Ask timing stage=sql_validation data_source=${dataSource} engine=ibis elapsed_ms=${
          Date.now() - startedAt
        } status=failed`,
      );
      this.sendIbisFailedEvent(event, err, {
        dataSource,
        sql,
      });
      throw err;
    }
  }

  private async ibisQuery(
    sql: string,
    dataSource: DataSourceName,
    connectionInfo: any,
    mdl: Manifest,
    limit: number,
    refresh?: boolean,
    cacheEnabled?: boolean,
  ): Promise<PreviewDataResponse> {
    const event = TelemetryEvent.IBIS_QUERY;
    let attempt = 0;
    const startedAt = Date.now();
    try {
      let res: IbisQueryResponse | undefined;
      while (true) {
        try {
          res = await this.ibisAdaptor.query(sql, {
            dataSource,
            connectionInfo,
            mdl,
            limit,
            refresh,
            cacheEnabled,
          });
          break;
        } catch (err: any) {
          const canRetry =
            dataSource === DataSourceName.MSSQL &&
            isSqlServerDeadlockError(err) &&
            attempt < MSSQL_DEADLOCK_RETRY_LIMIT;

          if (!canRetry) {
            throw err;
          }

          attempt += 1;
          logger.warn(
            `MSSQL deadlock while querying ibis; retrying attempt ${attempt}/${MSSQL_DEADLOCK_RETRY_LIMIT}`,
          );
          await delay(MSSQL_DEADLOCK_RETRY_BASE_DELAY_MS * attempt);
        }
      }

      if (!res) {
        throw new Error('Ibis query did not return a response');
      }

      this.sendIbisEvent(event, res, {
        dataSource,
        sql,
      });
      const data = this.transformDataType(res);
      logger.info(
        `Ask timing stage=sql_execution data_source=${dataSource} engine=ibis elapsed_ms=${
          Date.now() - startedAt
        } row_count=${data.data?.length ?? ''} cache_hit=${
          res.cacheHit ?? false
        } attempts=${attempt + 1}`,
      );
      return {
        correlationId: res.correlationId,
        cacheHit: res.cacheHit ?? false,
        cacheCreatedAt: res.cacheCreatedAt,
        cacheOverrodeAt: res.cacheOverrodeAt,
        override: res.override ?? false,
        ...data,
      };
    } catch (err: any) {
      logger.info(
        `Ask timing stage=sql_execution data_source=${dataSource} engine=ibis elapsed_ms=${
          Date.now() - startedAt
        } status=failed attempts=${attempt + 1}`,
      );
      this.sendIbisFailedEvent(event, err, {
        dataSource,
        sql,
      });
      throw err;
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

  private sendIbisEvent(
    event: TelemetryEvent,
    res: IbisResponse,
    others: Record<string, any>,
  ) {
    this.telemetry.sendEvent(event, {
      correlationId: res.correlationId,
      processTime: res.processTime,
      ...others,
    });
  }

  private sendIbisFailedEvent(
    event: TelemetryEvent,
    err: any,
    others: Record<string, any>,
  ) {
    this.telemetry.sendEvent(
      event,
      {
        correlationId: err.extensions?.other?.correlationId,
        processTime: err.extensions?.other?.processTime,
        error: err.message,
        ...others,
      },
      err.extensions?.service,
      false,
    );
  }
}
