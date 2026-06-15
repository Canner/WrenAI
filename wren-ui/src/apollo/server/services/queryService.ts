import { DataSourceName } from '@server/types';
import { Manifest, TableReference } from '@server/mdl/type';
import { IWrenEngineAdaptor } from '../adaptors/wrenEngineAdaptor';
import {
  SupportedDataSource,
  IIbisAdaptor,
  IbisQueryResponse,
  ValidationRules,
  IbisResponse,
} from '../adaptors/ibisAdaptor';
import { getLogger } from '@server/utils';
import { normalizeMssqlSqlForIbis } from '@server/utils/mssqlSqlNormalizer';
import { Project } from '../repositories';
import { PostHogTelemetry, TelemetryEvent } from '../telemetry/telemetry';

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

const normalizePreviewSqlForIbis = (
  sql: string,
  dataSource: DataSourceName,
  limit?: number,
): { sql: string; limit?: number } => {
  if (dataSource !== DataSourceName.MSSQL) {
    return { sql, limit };
  }

  sql = normalizeMssqlSqlForIbis(sql, dataSource);

  const topMatch = sql.match(/^\s*SELECT\s+(DISTINCT\s+)?TOP\s*\(?\s*(\d+)\s*\)?\s+/i);
  if (!topMatch) {
    return { sql, limit };
  }

  const distinctClause = topMatch[1] || '';
  const topLimit = Number(topMatch[2]);
  const normalizedSql = sql.replace(
    /^\s*SELECT\s+(DISTINCT\s+)?TOP\s*\(?\s*\d+\s*\)?\s+/i,
    `SELECT ${distinctClause}`,
  );

  return {
    sql: normalizedSql,
    limit:
      limit && limit > 0 ? Math.min(limit, topLimit) : topLimit,
  };
};

const normalizeDeployedManifestForDatasource = (
  manifest: Manifest,
  project: Project,
): Manifest => {
  if (project.type === DataSourceName.MSSQL || !manifest?.models?.length) {
    return manifest;
  }

  const fallbackCatalog = manifest.catalog || project.catalog || null;
  const fallbackSchema = manifest.schema || project.schema || null;

  return {
    ...manifest,
    models: manifest.models.map((model) => {
      const tableReferenceResult = normalizeTableReference(
        model.tableReference,
        fallbackSchema,
      );
      const synthesizedTableReference =
        tableReferenceResult.tableReference ||
        buildTableReferenceFromDboModelName(
          model.name,
          fallbackCatalog,
          fallbackSchema,
        ) ||
        buildTableReferenceFromDboRefSql(
          model.refSql,
          fallbackCatalog,
          fallbackSchema,
        );

      if (!synthesizedTableReference) {
        return model;
      }

      const normalizedModel = {
        ...model,
        tableReference: synthesizedTableReference,
      };

      if (
        tableReferenceResult.changed ||
        isDboPrefixedModelName(model.name) ||
        containsDboPhysicalReference(model.refSql)
      ) {
        delete normalizedModel.refSql;
      }

      return normalizedModel;
    }),
  };
};

const normalizeTableReference = (
  tableReference: TableReference | undefined,
  fallbackSchema: string | null,
): { tableReference?: TableReference; changed: boolean } => {
  if (!tableReference?.table) {
    return { tableReference, changed: false };
  }

  const normalizedTableName = normalizeDboPrefixedTableName(
    tableReference.table,
  );
  const shouldReplaceDboSchema =
    tableReference.schema?.toLowerCase() === 'dbo' && fallbackSchema;

  if (
    normalizedTableName === tableReference.table &&
    !shouldReplaceDboSchema
  ) {
    return { tableReference, changed: false };
  }

  return {
    tableReference: {
      ...tableReference,
      schema: shouldReplaceDboSchema ? fallbackSchema : tableReference.schema,
      table: normalizedTableName,
    },
    changed: true,
  };
};

const normalizeDboPrefixedTableName = (tableName: string): string => {
  const match = tableName.match(/^dbo_(.+)$/i);
  return match ? match[1] : tableName;
};

const buildTableReferenceFromDboModelName = (
  modelName: string | undefined,
  fallbackCatalog: string | null,
  fallbackSchema: string | null,
): TableReference | undefined => {
  if (!modelName || !isDboPrefixedModelName(modelName)) {
    return undefined;
  }

  return {
    catalog: fallbackCatalog,
    schema: fallbackSchema,
    table: normalizeDboPrefixedTableName(modelName),
  };
};

const buildTableReferenceFromDboRefSql = (
  refSql: string | undefined,
  fallbackCatalog: string | null,
  fallbackSchema: string | null,
): TableReference | undefined => {
  if (!refSql || !containsDboPhysicalReference(refSql)) {
    return undefined;
  }

  const tableName =
    extractDboPrefixedTableName(refSql) || extractDboSchemaTableName(refSql);
  if (!tableName) {
    return undefined;
  }

  return {
    catalog: fallbackCatalog,
    schema: fallbackSchema,
    table: normalizeDboPrefixedTableName(tableName),
  };
};

const isDboPrefixedModelName = (modelName: string | undefined): boolean =>
  !!modelName && /^dbo_.+/i.test(modelName);

const containsDboPhysicalReference = (sql: string | undefined): boolean =>
  !!sql && /(?:^|[.\s"])(?:dbo_[\w]+|dbo\.[\w"]+)/i.test(sql);

const extractDboPrefixedTableName = (sql: string): string | undefined => {
  const match = sql.match(/\bdbo_([A-Za-z0-9_]+)\b/i);
  return match ? `dbo_${match[1]}` : undefined;
};

const extractDboSchemaTableName = (sql: string): string | undefined => {
  const match = sql.match(/\bdbo\.("?)([A-Za-z0-9_]+)\1/i);
  return match ? match[2] : undefined;
};

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
      manifest: rawMdl,
      limit,
      dryRun,
      refresh,
      cacheEnabled,
    } = options;
    const mdl = normalizeDeployedManifestForDatasource(rawMdl, project);
    const { type: dataSource, connectionInfo } = project;
    if (this.useEngine(dataSource)) {
      if (dryRun) {
        logger.debug('Using wren engine to dry run');
        await this.wrenEngineAdaptor.dryRun(sql, {
          manifest: mdl,
          limit,
        });
        return true;
      } else {
        logger.debug('Using wren engine to preview');
        const data = await this.wrenEngineAdaptor.previewData(sql, mdl, limit);
        return data as PreviewDataResponse;
      }
    } else {
      this.checkDataSourceIsSupported(dataSource);
      logger.debug('Use ibis adaptor to preview');
      if (dryRun) {
        return await this.ibisDryRun(sql, dataSource, connectionInfo, mdl);
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
    const mdl = normalizeDeployedManifestForDatasource(manifest, project);
    const res = await this.ibisAdaptor.validate(
      dataSource,
      rule,
      connectionInfo,
      mdl,
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
    const normalizedQuery = normalizePreviewSqlForIbis(sql, dataSource).sql;
    const event = TelemetryEvent.IBIS_DRY_RUN;
    try {
      const res = await this.ibisAdaptor.dryRun(normalizedQuery, {
        dataSource,
        connectionInfo,
        mdl,
      });
      this.sendIbisEvent(event, res, { dataSource, sql: normalizedQuery });
      return {
        correlationId: res.correlationId,
      };
    } catch (err: any) {
      this.sendIbisFailedEvent(event, err, {
        dataSource,
        sql: normalizedQuery,
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
    const normalizedPreview = normalizePreviewSqlForIbis(sql, dataSource, limit);
    const event = TelemetryEvent.IBIS_QUERY;
    try {
      const res = await this.ibisAdaptor.query(normalizedPreview.sql, {
        dataSource,
        connectionInfo,
        mdl,
        limit: normalizedPreview.limit,
        refresh,
        cacheEnabled,
      });
      this.sendIbisEvent(event, res, {
        dataSource,
        sql: normalizedPreview.sql,
      });
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
      this.sendIbisFailedEvent(event, err, {
        dataSource,
        sql: normalizedPreview.sql,
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
