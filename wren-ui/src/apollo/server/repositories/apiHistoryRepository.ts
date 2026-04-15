import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { BaseRepository, IBasicRepository } from './baseRepository';
import { Knex } from 'knex';
import { getLogger } from '@server/utils';

const logger = getLogger('ApiHistoryRepository');

export enum ApiType {
  GENERATE_SQL = 'GENERATE_SQL',
  RUN_SQL = 'RUN_SQL',
  GENERATE_VEGA_CHART = 'GENERATE_VEGA_CHART',
  GENERATE_SUMMARY = 'GENERATE_SUMMARY',
  ASK = 'ASK',
  GET_INSTRUCTIONS = 'GET_INSTRUCTIONS',
  CREATE_INSTRUCTION = 'CREATE_INSTRUCTION',
  UPDATE_INSTRUCTION = 'UPDATE_INSTRUCTION',
  DELETE_INSTRUCTION = 'DELETE_INSTRUCTION',
  GET_SQL_PAIRS = 'GET_SQL_PAIRS',
  CREATE_SQL_PAIR = 'CREATE_SQL_PAIR',
  UPDATE_SQL_PAIR = 'UPDATE_SQL_PAIR',
  DELETE_SQL_PAIR = 'DELETE_SQL_PAIR',
  GET_MODELS = 'GET_MODELS',
  GET_THREADS = 'GET_THREADS',
  GET_API_HISTORY = 'GET_API_HISTORY',
  UPDATE_THREAD = 'UPDATE_THREAD',
  DELETE_THREAD = 'DELETE_THREAD',
  CREATE_VIEW = 'CREATE_VIEW',
  DELETE_VIEW = 'DELETE_VIEW',
  PREVIEW_VIEW_DATA = 'PREVIEW_VIEW_DATA',
  PREVIEW_MODEL_DATA = 'PREVIEW_MODEL_DATA',
  GET_SKILLS = 'GET_SKILLS',
  CREATE_SKILL = 'CREATE_SKILL',
  UPDATE_SKILL = 'UPDATE_SKILL',
  DELETE_SKILL = 'DELETE_SKILL',
  GET_CONNECTORS = 'GET_CONNECTORS',
  CREATE_CONNECTOR = 'CREATE_CONNECTOR',
  UPDATE_CONNECTOR = 'UPDATE_CONNECTOR',
  DELETE_CONNECTOR = 'DELETE_CONNECTOR',
  TEST_CONNECTOR = 'TEST_CONNECTOR',
  REENCRYPT_SECRETS = 'REENCRYPT_SECRETS',
  GET_KNOWLEDGE_BASES = 'GET_KNOWLEDGE_BASES',
  CREATE_KNOWLEDGE_BASE = 'CREATE_KNOWLEDGE_BASE',
  UPDATE_KNOWLEDGE_BASE = 'UPDATE_KNOWLEDGE_BASE',
  STREAM_ASK = 'STREAM_ASK',
  STREAM_GENERATE_SQL = 'STREAM_GENERATE_SQL',
}

export interface ApiHistory {
  id?: string;
  projectId: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
  apiType: ApiType;
  threadId?: string;
  headers?: Record<string, string>;
  requestPayload?: Record<string, any>;
  responsePayload?: Record<string, any>;
  statusCode?: number;
  durationMs?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaginationOptions {
  offset: number;
  limit: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}

export interface AskShadowCompareBucket {
  key: string;
  count: number;
}

export interface AskShadowCompareTrendBucket {
  date: string;
  total: number;
  executed: number;
  comparable: number;
  matched: number;
  mismatched: number;
  errorCount: number;
}

export interface AskShadowCompareStats {
  total: number;
  withDiagnostics: number;
  enabled: number;
  executed: number;
  comparable: number;
  matched: number;
  mismatched: number;
  errorCount: number;
  byAskPath: AskShadowCompareBucket[];
  byShadowErrorType: AskShadowCompareBucket[];
  trends: AskShadowCompareTrendBucket[];
}

type AskShadowCompareSummaryRow = {
  total?: unknown;
  with_diagnostics?: unknown;
  enabled?: unknown;
  executed?: unknown;
  comparable?: unknown;
  matched?: unknown;
  mismatched?: unknown;
  error_count?: unknown;
};

type AskShadowCompareBucketRow = {
  key?: string | null;
  count?: unknown;
};

type AskShadowCompareTrendBucketRow = {
  date?: unknown;
  total?: unknown;
  executed?: unknown;
  comparable?: unknown;
  matched?: unknown;
  mismatched?: unknown;
  error_count?: unknown;
};

export interface IApiHistoryRepository extends IBasicRepository<ApiHistory> {
  count(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
  ): Promise<number>;
  findAllWithPagination(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    pagination?: PaginationOptions,
  ): Promise<ApiHistory[]>;
  getAskShadowCompareStats(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    apiTypes?: ApiType[],
  ): Promise<AskShadowCompareStats>;
}

export class ApiHistoryRepository
  extends BaseRepository<ApiHistory>
  implements IApiHistoryRepository
{
  private readonly jsonbColumns = [
    'headers',
    'requestPayload',
    'responsePayload',
  ];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'api_history' });
  }

  /**
   * Count API history records with filtering
   */
  public async count(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
  ): Promise<number> {
    const query = this.applyFilterAndDate(
      this.knex(this.tableName).count('id as count'),
      filter,
      dateFilter,
    );

    const result = await query;
    return parseInt(result[0].count as string, 10);
  }

  /**
   * Find API history records with pagination
   */
  public async findAllWithPagination(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    pagination?: PaginationOptions,
  ): Promise<ApiHistory[]> {
    let query = this.applyFilterAndDate(
      this.knex(this.tableName).select('*'),
      filter,
      dateFilter,
    );

    if (pagination) {
      if (pagination.orderBy) {
        Object.entries(pagination.orderBy).forEach(([field, direction]) => {
          query = query.orderBy(this.camelToSnakeCase(field), direction);
        });
      } else {
        // Default sort by created_at desc
        query = query.orderBy('created_at', 'desc');
      }

      query = query.offset(pagination.offset).limit(pagination.limit);
    }

    const result = await query;
    return result.map(this.transformFromDBData);
  }

  public async getAskShadowCompareStats(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    apiTypes: ApiType[] = [ApiType.ASK, ApiType.STREAM_ASK],
  ): Promise<AskShadowCompareStats> {
    const { summaryQuery, byAskPathQuery, byShadowErrorTypeQuery, trendQuery } =
      this.buildAskShadowCompareAggregationQueries(
        filter,
        dateFilter,
        apiTypes,
      );

    const summaryRow =
      ((await summaryQuery) as AskShadowCompareSummaryRow | undefined) ||
      undefined;
    const byAskPathRows = (await byAskPathQuery) as AskShadowCompareBucketRow[];
    const byShadowErrorTypeRows =
      (await byShadowErrorTypeQuery) as AskShadowCompareBucketRow[];
    const trendRows = (await trendQuery) as AskShadowCompareTrendBucketRow[];

    return {
      total: this.toCount(summaryRow?.total),
      withDiagnostics: this.toCount(summaryRow?.with_diagnostics),
      enabled: this.toCount(summaryRow?.enabled),
      executed: this.toCount(summaryRow?.executed),
      comparable: this.toCount(summaryRow?.comparable),
      matched: this.toCount(summaryRow?.matched),
      mismatched: this.toCount(summaryRow?.mismatched),
      errorCount: this.toCount(summaryRow?.error_count),
      byAskPath: this.toBuckets(byAskPathRows),
      byShadowErrorType: this.toBuckets(byShadowErrorTypeRows),
      trends: this.toTrendBuckets(trendRows),
    };
  }

  protected override transformFromDBData = (data: any): ApiHistory => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        // Older stringified payloads are still parsed for compatibility;
        // PostgreSQL jsonb rows already return objects.
        if (typeof value === 'string') {
          if (!value) return value;
          try {
            return JSON.parse(value);
          } catch (error) {
            logger.warn(`Failed to parse JSON for ${key}`, error);
            return value; // Return raw value if parsing fails
          }
        } else {
          return value;
        }
      }
      return value;
    }) as ApiHistory;
    return formattedData;
  };

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        return JSON.stringify(value);
      } else {
        return value;
      }
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };

  /**
   * Convert camelCase to snake_case for DB column names
   */
  private camelToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  private applyFilterAndDate<TQuery extends Knex.QueryBuilder>(
    query: TQuery,
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
  ) {
    if (filter) {
      query.where(this.transformToDBData(filter));
    }

    if (dateFilter?.startDate) {
      query.where('created_at', '>=', dateFilter.startDate);
    }

    if (dateFilter?.endDate) {
      query.where('created_at', '<=', dateFilter.endDate);
    }

    return query;
  }

  private buildAskShadowCompareAggregationQueries(
    filter?: Partial<ApiHistory>,
    dateFilter?: { startDate?: Date; endDate?: Date },
    apiTypes: ApiType[] = [ApiType.ASK, ApiType.STREAM_ASK],
  ) {
    const baseQuery = this.applyFilterAndDate(
      this.knex(this.tableName),
      filter,
      dateFilter,
    );

    if (apiTypes.length > 0) {
      baseQuery.whereIn('api_type', apiTypes);
    }

    const withDiagnosticsExpr = this.jsonExistsExpression(['askDiagnostics']);
    const enabledExpr = this.jsonBooleanTrueExpression([
      'askDiagnostics',
      'shadowCompare',
      'enabled',
    ]);
    const executedExpr = this.jsonBooleanTrueExpression([
      'askDiagnostics',
      'shadowCompare',
      'executed',
    ]);
    const comparableExpr = this.jsonBooleanTrueExpression([
      'askDiagnostics',
      'shadowCompare',
      'comparable',
    ]);
    const matchedExpr = this.jsonBooleanTrueExpression([
      'askDiagnostics',
      'shadowCompare',
      'matched',
    ]);
    const askPathExpr = this.askPathExpression();
    const trendDateExpr = this.dateBucketExpression();
    const shadowErrorTypeExpr = this.jsonTextExpression([
      'askDiagnostics',
      'shadowCompare',
      'shadowErrorType',
    ]);
    const shadowErrorExpr = this.jsonTextExpression([
      'askDiagnostics',
      'shadowCompare',
      'shadowError',
    ]);

    return {
      summaryQuery: baseQuery
        .clone()
        .first(
          this.knex.raw('COUNT(*) as total'),
          this.knex.raw(
            `SUM(CASE WHEN ${withDiagnosticsExpr} THEN 1 ELSE 0 END) as with_diagnostics`,
          ),
          this.knex.raw(
            `SUM(CASE WHEN ${enabledExpr} THEN 1 ELSE 0 END) as enabled`,
          ),
          this.knex.raw(
            `SUM(CASE WHEN ${executedExpr} THEN 1 ELSE 0 END) as executed`,
          ),
          this.knex.raw(
            `SUM(CASE WHEN ${comparableExpr} THEN 1 ELSE 0 END) as comparable`,
          ),
          this.knex.raw(
            `SUM(CASE WHEN ${comparableExpr} AND ${matchedExpr} THEN 1 ELSE 0 END) as matched`,
          ),
          this.knex.raw(
            `SUM(CASE WHEN ${comparableExpr} AND NOT ${matchedExpr} THEN 1 ELSE 0 END) as mismatched`,
          ),
          this.knex.raw(
            `SUM(CASE WHEN ${shadowErrorTypeExpr} IS NOT NULL OR ${shadowErrorExpr} IS NOT NULL THEN 1 ELSE 0 END) as error_count`,
          ),
        ),
      byAskPathQuery: baseQuery
        .clone()
        .select(
          this.knex.raw(`${askPathExpr} as key`),
          this.knex.raw('COUNT(*) as count'),
        )
        .whereRaw(`${askPathExpr} IS NOT NULL`)
        .groupByRaw(askPathExpr)
        .orderBy([
          { column: 'count', order: 'desc' },
          { column: 'key', order: 'asc' },
        ]),
      byShadowErrorTypeQuery: baseQuery
        .clone()
        .select(
          this.knex.raw(`${shadowErrorTypeExpr} as key`),
          this.knex.raw('COUNT(*) as count'),
        )
        .whereRaw(`${shadowErrorTypeExpr} IS NOT NULL`)
        .groupByRaw(shadowErrorTypeExpr)
        .orderBy([
          { column: 'count', order: 'desc' },
          { column: 'key', order: 'asc' },
        ]),
      trendQuery: baseQuery
        .clone()
        .select(
          this.knex.raw(`${trendDateExpr} as date`),
          this.knex.raw('COUNT(*) as total'),
          this.knex.raw(
            `SUM(CASE WHEN ${executedExpr} THEN 1 ELSE 0 END) as executed`,
          ),
          this.knex.raw(
            `SUM(CASE WHEN ${comparableExpr} THEN 1 ELSE 0 END) as comparable`,
          ),
          this.knex.raw(
            `SUM(CASE WHEN ${comparableExpr} AND ${matchedExpr} THEN 1 ELSE 0 END) as matched`,
          ),
          this.knex.raw(
            `SUM(CASE WHEN ${comparableExpr} AND NOT ${matchedExpr} THEN 1 ELSE 0 END) as mismatched`,
          ),
          this.knex.raw(
            `SUM(CASE WHEN ${shadowErrorTypeExpr} IS NOT NULL OR ${shadowErrorExpr} IS NOT NULL THEN 1 ELSE 0 END) as error_count`,
          ),
        )
        .groupByRaw(trendDateExpr)
        .orderBy([{ column: 'date', order: 'asc' }]),
    };
  }

  private jsonPath(path: string[]) {
    return path.join(',');
  }

  private jsonExistsExpression(path: string[]) {
    return `response_payload #> '{${this.jsonPath(path)}}' IS NOT NULL`;
  }

  private jsonTextExpression(path: string[]) {
    return `NULLIF(response_payload #>> '{${this.jsonPath(path)}}', '')`;
  }

  private jsonBooleanTrueExpression(path: string[]) {
    return `(${this.jsonTextExpression(path)} = 'true')`;
  }

  private askPathExpression() {
    const askPathExpr = this.jsonTextExpression(['askDiagnostics', 'askPath']);
    const primaryAskPathExpr = this.jsonTextExpression([
      'askDiagnostics',
      'shadowCompare',
      'primaryAskPath',
    ]);

    return `COALESCE(${askPathExpr}, ${primaryAskPathExpr})`;
  }

  private dateBucketExpression() {
    return 'DATE(created_at)';
  }

  private toCount(value: unknown) {
    return Number(value || 0);
  }

  private toBuckets(rows: Array<{ key?: string | null; count?: unknown }>) {
    return rows
      .filter((row) => row.key)
      .map((row) => ({
        key: row.key as string,
        count: this.toCount(row.count),
      }));
  }

  private toTrendBuckets(rows: AskShadowCompareTrendBucketRow[]) {
    return rows
      .filter((row) => row.date)
      .map((row) => ({
        date: this.toDateKey(row.date),
        total: this.toCount(row.total),
        executed: this.toCount(row.executed),
        comparable: this.toCount(row.comparable),
        matched: this.toCount(row.matched),
        mismatched: this.toCount(row.mismatched),
        errorCount: this.toCount(row.error_count),
      }));
  }

  private toDateKey(value: unknown) {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    return String(value).slice(0, 10);
  }
}
