import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';
import { BaseRepository } from './baseRepository';
import { Knex } from 'knex';
import { getLogger } from '@server/utils';
import {
  ApiType,
  type ApiHistory,
  type AskShadowCompareBucketRow,
  type AskShadowCompareStats,
  type AskShadowCompareSummaryRow,
  type AskShadowCompareTrendBucketRow,
  type IApiHistoryRepository,
  type PaginationOptions,
} from './apiHistoryRepositoryTypes';

const logger = getLogger('ApiHistoryRepository');
export {
  ApiType,
  type ApiHistory,
  type AskShadowCompareBucket,
  type AskShadowCompareStats,
  type AskShadowCompareTrendBucket,
  type IApiHistoryRepository,
  type PaginationOptions,
} from './apiHistoryRepositoryTypes';

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
