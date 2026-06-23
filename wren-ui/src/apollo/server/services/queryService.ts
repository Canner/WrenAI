import { DataSourceName } from '@server/types';
import { ColumnMDL, Manifest, TableReference } from '@server/mdl/type';
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
  sql = normalizeMssqlSqlForIbis(sql, dataSource);

  if (dataSource !== DataSourceName.MSSQL) {
    return {
      sql: normalizeNonMssqlGeneratedSqlSyntax(sql, dataSource),
      limit,
    };
  }

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

const normalizeNonMssqlGeneratedSqlSyntax = (
  sql: string,
  dataSource: DataSourceName,
): string => {
  if (dataSource === DataSourceName.MSSQL) {
    return sql;
  }

  return rewriteGeneratedDateDiff(sql);
};

const rewriteGeneratedDateDiff = (sql: string): string => {
  const dateDiffPattern =
    /\bdate_?diff\s*\(\s*'?([A-Za-z]+)'?\s*,\s*([^,()]+(?:\([^)]*\))?[^,()]*)\s*,\s*([^()]+(?:\([^)]*\))?[^()]*)\)/gi;

  return sql.replace(
    dateDiffPattern,
    (_match, unit: string, startExpression: string, endExpression: string) => {
      const normalizedUnit = unit.toLowerCase();
      const start = startExpression.trim();
      const end = endExpression.trim();

      if (['day', 'dd', 'd'].includes(normalizedUnit)) {
        return `EXTRACT(DAY FROM (${end} - ${start}))`;
      }

      if (['month', 'mm', 'm'].includes(normalizedUnit)) {
        return `((EXTRACT(YEAR FROM ${end}) - EXTRACT(YEAR FROM ${start})) * 12 + (EXTRACT(MONTH FROM ${end}) - EXTRACT(MONTH FROM ${start})))`;
      }

      if (['year', 'yy', 'yyyy'].includes(normalizedUnit)) {
        return `(EXTRACT(YEAR FROM ${end}) - EXTRACT(YEAR FROM ${start}))`;
      }

      return `EXTRACT(DAY FROM (${end} - ${start}))`;
    },
  );
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

const SQL_IDENTIFIER_PATTERN =
  String.raw`(?:"[^"]+"|` +
  '`[^`]+`' +
  String.raw`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)`;

const normalizeSqlIdentifier = (identifier: string) => {
  const trimmed = identifier.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const splitTableReference = (tableReference: string) =>
  tableReference
    .trim()
    .split(/\s*\.\s*/)
    .map(normalizeSqlIdentifier)
    .filter(Boolean);

const compactSqlIdentifier = (identifier: string) =>
  normalizeSqlIdentifier(identifier).replace(/[^A-Za-z0-9]/g, '').toLowerCase();

const extractSqlTableReferences = (sql: string) => {
  const references: string[] = [];
  const tablePattern = new RegExp(
    String.raw`\b(?:FROM|JOIN)\s+(${SQL_IDENTIFIER_PATTERN}(?:\s*\.\s*${SQL_IDENTIFIER_PATTERN})*)`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(sql))) {
    references.push(splitTableReference(match[1]).join('.'));
  }
  return references;
};

const extractCteNames = (sql: string) => {
  const cteNames = new Set<string>();
  const ctePattern = new RegExp(
    String.raw`(?:\bWITH\b|,)\s*(${SQL_IDENTIFIER_PATTERN})\s+AS\s*\(`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = ctePattern.exec(sql))) {
    cteNames.add(normalizeSqlIdentifier(match[1]).toLowerCase());
  }
  return cteNames;
};

const getManifestQueryableNames = (manifest?: Manifest) => {
  const names = new Set<string>();
  for (const model of manifest?.models || []) {
    if (model.name) names.add(model.name.toLowerCase());
    if (model.tableReference?.table) {
      names.add(model.tableReference.table.toLowerCase());
    }
  }
  for (const view of manifest?.views || []) {
    if (view.name) names.add(view.name.toLowerCase());
  }
  return names;
};

interface ManifestModelSchema {
  name: string;
  columns: Map<string, ColumnMDL>;
}

const addManifestModelSchemaAlias = (
  schemas: Map<string, ManifestModelSchema>,
  alias: string | undefined,
  schema: ManifestModelSchema,
) => {
  if (!alias) {
    return;
  }
  schemas.set(alias.toLowerCase(), schema);
  schemas.set(compactSqlIdentifier(alias), schema);
};

const getManifestModelSchemas = (manifest?: Manifest) => {
  const schemas = new Map<string, ManifestModelSchema>();

  for (const model of manifest?.models || []) {
    if (!model.name || !model.columns?.length) {
      continue;
    }

    const columns = new Map<string, ColumnMDL>();
    model.columns
      .filter((column) => column?.name)
      .forEach((column) => {
        columns.set(column.name.toLowerCase(), column);
        columns.set(compactSqlIdentifier(column.name), column);
      });

    const schema: ManifestModelSchema = {
      name: model.name,
      columns,
    };

    addManifestModelSchemaAlias(schemas, model.name, schema);
    addManifestModelSchemaAlias(schemas, model.tableReference?.table, schema);

    const referenceParts = [
      model.tableReference?.catalog,
      model.tableReference?.schema,
      model.tableReference?.table,
    ].filter(Boolean);
    if (referenceParts.length) {
      addManifestModelSchemaAlias(schemas, referenceParts.join('.'), schema);
    }
  }

  return schemas;
};

const extractSqlTableAliases = (
  sql: string,
  schemas: Map<string, ManifestModelSchema>,
) => {
  const aliases = new Map<string, ManifestModelSchema>();
  const tablePattern = new RegExp(
    String.raw`\b(?:FROM|JOIN)\s+(${SQL_IDENTIFIER_PATTERN}(?:\s*\.\s*${SQL_IDENTIFIER_PATTERN})*)(?:\s+(?:AS\s+)?(${SQL_IDENTIFIER_PATTERN}))?`,
    'gi',
  );
  const clauseWords = new Set([
    'where',
    'join',
    'inner',
    'left',
    'right',
    'full',
    'cross',
    'group',
    'order',
    'having',
    'limit',
    'offset',
    'fetch',
    'union',
    'on',
  ]);

  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(sql))) {
    const reference = splitTableReference(match[1]).join('.');
    const lastPart = splitTableReference(reference).pop();
    const schema =
      schemas.get(reference.toLowerCase()) ||
      schemas.get(compactSqlIdentifier(reference)) ||
      (lastPart
        ? schemas.get(lastPart.toLowerCase()) ||
          schemas.get(compactSqlIdentifier(lastPart))
        : undefined);

    if (!schema) {
      continue;
    }

    aliases.set(reference.toLowerCase(), schema);
    if (lastPart) {
      aliases.set(lastPart.toLowerCase(), schema);
    }

    const alias = match[2] ? normalizeSqlIdentifier(match[2]) : null;
    if (alias && !clauseWords.has(alias.toLowerCase())) {
      aliases.set(alias.toLowerCase(), schema);
    }
  }

  return aliases;
};

const isNumericColumnType = (type?: string) =>
  !!type &&
  /(?:int|integer|bigint|smallint|tinyint|float|double|decimal|numeric|number|real|money)/i.test(
    type,
  );

const isDefined = <T>(value: T | undefined | null): value is T =>
  value !== undefined && value !== null;

const splitTopLevelSqlList = (body: string) => {
  const items: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBracket = false;

  for (const char of body) {
    if (char === "'" && !inDoubleQuote && !inBracket) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && !inBracket) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '[' && !inSingleQuote && !inDoubleQuote) {
      inBracket = true;
    } else if (char === ']' && inBracket) {
      inBracket = false;
    } else if (!inSingleQuote && !inDoubleQuote && !inBracket) {
      if (char === '(') depth += 1;
      if (char === ')' && depth > 0) depth -= 1;
      if (char === ',' && depth === 0) {
        items.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }

  if (current.trim()) {
    items.push(current.trim());
  }
  return items;
};

const stripProjectionAlias = (item: string) => {
  const aliasMatch = item.match(
    /\s+(?:AS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*$/i,
  );
  if (!aliasMatch || aliasMatch.index === undefined) {
    return item.trim();
  }

  const expression = item.slice(0, aliasMatch.index).trim();
  return expression || item.trim();
};

const extractSimpleProjectionColumns = (sql: string) => {
  const columns: string[] = [];
  const selectPattern = /\bSELECT\b(?<body>.*?)(?=\bFROM\b)/gis;
  let match: RegExpExecArray | null;
  while ((match = selectPattern.exec(sql))) {
    const body = match.groups?.body || '';
    splitTopLevelSqlList(body).forEach((item) => {
      const expression = stripProjectionAlias(
        item.replace(/^\s*DISTINCT\s+/i, ''),
      );
      const identifierMatch = expression.match(
        new RegExp(String.raw`^${SQL_IDENTIFIER_PATTERN}$`, 'i'),
      );
      if (identifierMatch && normalizeSqlIdentifier(expression) !== '*') {
        columns.push(normalizeSqlIdentifier(expression));
      }
    });
  }
  return columns;
};

const findSqlReferenceValidationErrors = (
  sql: string,
  manifest?: Manifest,
) => {
  const schemas = getManifestModelSchemas(manifest);
  if (!schemas.size) {
    return [];
  }

  const aliases = extractSqlTableAliases(sql, schemas);
  const errors: string[] = [];
  const qualifiedColumnPattern = new RegExp(
    String.raw`(${SQL_IDENTIFIER_PATTERN})\s*\.\s*(${SQL_IDENTIFIER_PATTERN})`,
    'gi',
  );

  let match: RegExpExecArray | null;
  while ((match = qualifiedColumnPattern.exec(sql))) {
    const qualifier = normalizeSqlIdentifier(match[1]);
    const column = normalizeSqlIdentifier(match[2]);
    const schema = aliases.get(qualifier.toLowerCase());

    if (!schema || column === '*') {
      continue;
    }

    if (
      !schema.columns.has(column.toLowerCase()) &&
      !schema.columns.has(compactSqlIdentifier(column))
    ) {
      errors.push(`${qualifier}.${column}`);
    }
  }

  const aggregatePattern = new RegExp(
    String.raw`\b(AVG|SUM)\s*\(\s*(?:DISTINCT\s+)?(${SQL_IDENTIFIER_PATTERN})(?:\s*\.\s*(${SQL_IDENTIFIER_PATTERN}))?\s*\)`,
    'gi',
  );
  while ((match = aggregatePattern.exec(sql))) {
    const functionName = match[1].toUpperCase();
    const qualifier = match[3] ? normalizeSqlIdentifier(match[2]) : null;
    const column = normalizeSqlIdentifier(match[3] || match[2]);
    if (column === '*') {
      continue;
    }

    const candidateSchemas = qualifier
      ? [aliases.get(qualifier.toLowerCase())].filter(isDefined)
      : [...new Set(aliases.values())];
    const matchingColumns = candidateSchemas
      .map(
        (schema) =>
          schema?.columns.get(column.toLowerCase()) ||
          schema?.columns.get(compactSqlIdentifier(column)),
      )
      .filter(isDefined);

    if (!matchingColumns.length) {
      errors.push(qualifier ? `${qualifier}.${column}` : column);
      continue;
    }

    if (
      matchingColumns.some(
        (columnSchema) => !isNumericColumnType(columnSchema.type),
      )
    ) {
      errors.push(
        `${functionName}(${qualifier ? `${qualifier}.` : ''}${column}) uses a non-numeric column`,
      );
    }
  }

  const activeSchemas = [...new Set(aliases.values())];
  if (activeSchemas.length === 1) {
    const [schema] = activeSchemas;
    extractSimpleProjectionColumns(sql).forEach((column) => {
      if (
        !schema.columns.has(column.toLowerCase()) &&
        !schema.columns.has(compactSqlIdentifier(column))
      ) {
        errors.push(column);
      }
    });
  }

  return [...new Set(errors)];
};

const validateSqlReferencesManifest = (sql: string, manifest?: Manifest) => {
  const validNames = getManifestQueryableNames(manifest);
  if (!validNames.size) {
    return;
  }

  const cteNames = extractCteNames(sql);
  const invalidReferences = extractSqlTableReferences(sql).filter((reference) => {
    const normalized = reference.toLowerCase();
    const lastPart = splitTableReference(reference).pop()?.toLowerCase();
    return (
      !validNames.has(normalized) &&
      !cteNames.has(normalized) &&
      (!lastPart || !validNames.has(lastPart))
    );
  });

  if (invalidReferences.length) {
    throw new Error(
      `Generated SQL references table(s) not present in the active datasource metadata: ${[
        ...new Set(invalidReferences),
      ].join(', ')}`,
    );
  }

  const invalidColumnReferences = findSqlReferenceValidationErrors(
    sql,
    manifest,
  );
  if (invalidColumnReferences.length) {
    throw new Error(
      `Generated SQL references column(s) or expressions not valid for the active datasource metadata: ${invalidColumnReferences.join(', ')}`,
    );
  }
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
    const normalizedPreview = normalizePreviewSqlForIbis(sql, dataSource, limit);
    validateSqlReferencesManifest(normalizedPreview.sql, mdl);
    if (this.useEngine(dataSource)) {
      if (dryRun) {
        logger.debug('Using wren engine to dry run');
        await this.wrenEngineAdaptor.dryRun(normalizedPreview.sql, {
          manifest: mdl,
          limit: normalizedPreview.limit,
        });
        return true;
      } else {
        logger.debug('Using wren engine to preview');
        const data = await this.wrenEngineAdaptor.previewData(
          normalizedPreview.sql,
          mdl,
          normalizedPreview.limit,
        );
        return data as PreviewDataResponse;
      }
    } else {
      this.checkDataSourceIsSupported(dataSource);
      logger.debug('Use ibis adaptor to preview');
      if (dryRun) {
        return await this.ibisDryRun(
          normalizedPreview.sql,
          dataSource,
          connectionInfo,
          mdl,
        );
      } else {
        return await this.ibisQuery(
          normalizedPreview.sql,
          dataSource,
          connectionInfo,
          mdl,
          normalizedPreview.limit,
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
