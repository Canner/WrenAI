import { Knex } from 'knex';
import { ApiHistoryRepository, ApiType } from './apiHistoryRepository';

describe('ApiHistoryRepository shadow compare SQL generation', () => {
  const buildRepository = (client: 'pg' | 'better-sqlite3') => {
    const knex = require('knex')({
      client,
      ...(client === 'better-sqlite3'
        ? {
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
          }
        : {}),
    }) as Knex;

    return {
      knex,
      repository: new ApiHistoryRepository(knex),
    };
  };

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  it('builds sqlite aggregation queries with json_extract/json_type and grouped buckets', async () => {
    const { knex, repository } = buildRepository('better-sqlite3');

    try {
      const queries = (
        repository as any
      ).buildAskShadowCompareAggregationQueries(
        {
          projectId: 42,
          threadId: 'thread-1',
        },
        {
          startDate: new Date('2026-04-01T00:00:00.000Z'),
          endDate: new Date('2026-04-03T00:00:00.000Z'),
        },
        [ApiType.ASK, ApiType.STREAM_ASK],
      );

      const summarySql = queries.summaryQuery.toSQL();
      const askPathSql = queries.byAskPathQuery.toSQL();
      const shadowErrorSql = queries.byShadowErrorTypeQuery.toSQL();
      const trendSql = queries.trendQuery.toSQL();

      expect(summarySql.sql).toContain('json_type(response_payload');
      expect(summarySql.sql).toContain('json_extract(response_payload');
      expect(summarySql.sql).toContain(
        'where `project_id` = ? and `thread_id` = ?',
      );
      expect(summarySql.sql).toContain('`api_type` in (?, ?)');
      expect(summarySql.bindings).toEqual(
        expect.arrayContaining([
          42,
          'thread-1',
          new Date('2026-04-01T00:00:00.000Z'),
          new Date('2026-04-03T00:00:00.000Z'),
          ApiType.ASK,
          ApiType.STREAM_ASK,
        ]),
      );
      expect(summarySql.bindings[summarySql.bindings.length - 1]).toBe(1);

      expect(askPathSql.sql).toContain('COALESCE(');
      expect(askPathSql.sql).toContain('group by COALESCE(');
      expect(askPathSql.bindings).toEqual(
        expect.arrayContaining([
          42,
          'thread-1',
          new Date('2026-04-01T00:00:00.000Z'),
          new Date('2026-04-03T00:00:00.000Z'),
          ApiType.ASK,
          ApiType.STREAM_ASK,
        ]),
      );
      expect(shadowErrorSql.sql).toContain(
        "NULLIF(json_extract(response_payload, '$.askDiagnostics.shadowCompare.shadowErrorType'), '')",
      );
      expect(trendSql.sql).toContain('DATE(created_at) as date');
      expect(trendSql.sql).toContain('group by DATE(created_at)');
      expect(trendSql.sql).toContain('order by `date` asc');
    } finally {
      await knex.destroy();
    }
  });

  it('builds postgres aggregation queries with jsonb operators', async () => {
    const { knex, repository } = buildRepository('pg');

    try {
      const queries = (
        repository as any
      ).buildAskShadowCompareAggregationQueries(
        {
          projectId: 42,
        },
        undefined,
        [ApiType.ASK],
      );

      const summarySql = queries.summaryQuery.toSQL();
      const askPathSql = queries.byAskPathQuery.toSQL();
      const trendSql = queries.trendQuery.toSQL();

      expect(summarySql.sql).toContain(
        `response_payload #> '{askDiagnostics}'`,
      );
      expect(summarySql.sql).toContain(
        `response_payload #>> '{askDiagnostics,shadowCompare,matched}'`,
      );
      expect(summarySql.sql).toContain('"api_type" in (?)');
      expect(summarySql.bindings).toEqual(
        expect.arrayContaining([42, ApiType.ASK]),
      );
      expect(summarySql.bindings[summarySql.bindings.length - 1]).toBe(1);

      expect(askPathSql.sql).toContain('COALESCE(');
      expect(askPathSql.sql).toContain(
        `NULLIF(response_payload #>> '{askDiagnostics,askPath}', '')`,
      );
      expect(askPathSql.sql).toContain(
        `NULLIF(response_payload #>> '{askDiagnostics,shadowCompare,primaryAskPath}', '')`,
      );
      expect(askPathSql.bindings).toEqual(
        expect.arrayContaining([42, ApiType.ASK]),
      );
      expect(trendSql.sql).toContain('DATE(created_at) as date');
      expect(trendSql.sql).toContain('group by DATE(created_at)');
      expect(trendSql.sql).toContain('order by "date" asc');
    } finally {
      await knex.destroy();
    }
  });
});
