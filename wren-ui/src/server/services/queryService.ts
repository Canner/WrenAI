import { DataSourceName } from '@server/types';
import { Manifest } from '@server/mdl/type';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import { DUCKDB_CONNECTION_INFO } from '../repositories';
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
import { QueryExecutionContext } from '../utils/runtimeExecutionContext';

const logger = getLogger('QueryService');
logger.level = 'debug';

export const DEFAULT_PREVIEW_LIMIT = 500;

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

export interface PreviewOptions extends QueryExecutionContext {
  modelingOnly?: boolean;
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
  private currentDuckDbRuntimeKey: string | null = null;

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
    const { type: connectionType, connectionInfo } = project;
    if (this.useEngineForConnection(connectionType)) {
      const duckDbConnectionInfo = (connectionInfo ||
        {}) as DUCKDB_CONNECTION_INFO;
      await this.ensureDuckDbRuntime(duckDbConnectionInfo);
      try {
        if (dryRun) {
          logger.debug('Using wren engine to dry run');
          await this.wrenEngineAdaptor.dryRun(sql, {
            manifest: mdl,
            limit,
          });
          return true;
        } else {
          logger.debug('Using wren engine to preview');
          const data = await this.wrenEngineAdaptor.previewData(
            sql,
            mdl,
            limit,
          );
          return data as PreviewDataResponse;
        }
      } catch (error) {
        if (!this.shouldRetryDuckDbRuntime(error)) {
          throw error;
        }

        logger.warn(
          `DuckDB runtime appears stale; re-preparing and retrying once: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.ensureDuckDbRuntime(duckDbConnectionInfo, { force: true });

        if (dryRun) {
          await this.wrenEngineAdaptor.dryRun(sql, {
            manifest: mdl,
            limit,
          });
          return true;
        }

        const data = await this.wrenEngineAdaptor.previewData(sql, mdl, limit);
        return data as PreviewDataResponse;
      }
    } else {
      this.checkConnectionTypeIsSupported(connectionType);
      logger.debug('Use ibis adaptor to preview');
      if (dryRun) {
        return await this.ibisDryRun(sql, connectionType, connectionInfo, mdl);
      } else {
        return await this.ibisQuery(
          sql,
          connectionType,
          connectionInfo,
          mdl,
          limit ?? DEFAULT_PREVIEW_LIMIT,
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
    project: Project,
    rule: ValidationRules,
    manifest: Manifest,
    parameters: Record<string, any>,
  ): Promise<ValidateResponse> {
    const { type: connectionType, connectionInfo } = project;
    const res = await this.ibisAdaptor.validate(
      connectionType,
      rule,
      connectionInfo,
      manifest,
      parameters,
    );
    return {
      valid: res.valid,
      message: res.message ?? undefined,
    };
  }

  private useEngineForConnection(connectionType: DataSourceName): boolean {
    if (connectionType === DataSourceName.DUCKDB) {
      return true;
    } else {
      return false;
    }
  }

  private checkConnectionTypeIsSupported(connectionType: DataSourceName) {
    if (
      !Object.prototype.hasOwnProperty.call(SupportedDataSource, connectionType)
    ) {
      throw new Error(
        `Unsupported connection type for ibis: "${connectionType}"`,
      );
    }
  }

  private getDuckDbInitSql(connectionInfo: DUCKDB_CONNECTION_INFO): string {
    const initSql =
      connectionInfo && typeof connectionInfo.initSql === 'string'
        ? connectionInfo.initSql
        : '';
    const extensions = Array.isArray(connectionInfo?.extensions)
      ? connectionInfo.extensions.filter(
          (ext): ext is string => typeof ext === 'string' && ext.trim() !== '',
        )
      : [];
    const installExtensionsSql = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');

    return [installExtensionsSql, initSql].filter(Boolean).join('\n');
  }

  private getDuckDbSessionProps(connectionInfo: DUCKDB_CONNECTION_INFO) {
    const rawConfig = connectionInfo?.configurations;
    if (!rawConfig || typeof rawConfig !== 'object') {
      return {};
    }
    return rawConfig as Record<string, any>;
  }

  private buildDuckDbRuntimeKey(
    connectionInfo: DUCKDB_CONNECTION_INFO,
  ): string {
    return JSON.stringify({
      initSql: this.getDuckDbInitSql(connectionInfo),
      sessionProps: this.getDuckDbSessionProps(connectionInfo),
    });
  }

  private async ensureDuckDbRuntime(
    connectionInfo: DUCKDB_CONNECTION_INFO,
    options?: {
      force?: boolean;
    },
  ): Promise<void> {
    const runtimeKey = this.buildDuckDbRuntimeKey(connectionInfo);
    if (!options?.force && this.currentDuckDbRuntimeKey === runtimeKey) {
      return;
    }

    await this.wrenEngineAdaptor.prepareDuckDB({
      initSql: this.getDuckDbInitSql(connectionInfo),
      sessionProps: this.getDuckDbSessionProps(connectionInfo),
    });
    await this.wrenEngineAdaptor.patchConfig({
      'wren.datasource.type': 'duckdb',
    });

    this.currentDuckDbRuntimeKey = runtimeKey;
  }

  private shouldRetryDuckDbRuntime(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : String(error || '');

    return (
      /HikariDataSource .* has been closed/i.test(message) ||
      (/Table with name .* does not exist/i.test(message) &&
        /Catalog Error/i.test(message)) ||
      /source node name not found/i.test(message)
    );
  }

  private async ibisDryRun(
    sql: string,
    dataSource: DataSourceName,
    connectionInfo: any,
    mdl: Manifest,
  ): Promise<IbisResponse> {
    const event = TelemetryEvent.IBIS_DRY_RUN;
    try {
      const res = await this.ibisAdaptor.dryRun(sql, {
        dataSource,
        connectionInfo,
        mdl,
      });
      this.sendIbisEvent(event, res, { dataSource, sql });
      return {
        correlationId: res.correlationId,
      };
    } catch (err: any) {
      this.sendIbisFailedEvent(event, err, { dataSource, sql });
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
    try {
      const res = await this.ibisAdaptor.query(sql, {
        dataSource,
        connectionInfo,
        mdl,
        limit,
        refresh,
        cacheEnabled,
      });
      this.sendIbisEvent(event, res, { dataSource, sql });
      const data = this.transformDataType(res);
      return {
        correlationId: res.correlationId,
        cacheHit: res.cacheHit,
        cacheCreatedAt: res.cacheCreatedAt,
        cacheOverrodeAt: res.cacheOverrodeAt,
        override: res.override,
        ...data,
      };
    } catch (err: any) {
      this.sendIbisFailedEvent(event, err, { dataSource, sql });
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
