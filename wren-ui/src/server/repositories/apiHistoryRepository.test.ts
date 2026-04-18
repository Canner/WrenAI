import { Knex } from 'knex';
import knexFactory from 'knex';
import { ApiHistoryRepository, ApiType } from './apiHistoryRepository';

describe('ApiHistoryRepository shadow compare SQL generation', () => {
  const buildRepository = (client: 'pg') => {
    const knex = knexFactory({
      client,
    }) as Knex;

    return {
      knex,
      repository: new ApiHistoryRepository(knex),
    };
  };

  afterEach(async () => {
    jest.restoreAllMocks();
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
