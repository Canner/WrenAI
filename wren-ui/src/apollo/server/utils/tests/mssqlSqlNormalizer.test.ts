import { DataSourceName } from '../../types';
import { normalizeMssqlSqlForIbis } from '../mssqlSqlNormalizer';

describe('mssqlSqlNormalizer', () => {
  it('rewrites aliased repair log time buckets', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT YEAR AS year, MONTH AS month, COUNT(*) AS repair_count
      FROM dbo_repair_logs
      GROUP BY YEAR, MONTH
      ORDER BY YEAR ASC, MONTH ASC
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).not.toContain('YEAR AS year');
    expect(normalized).not.toContain('MONTH AS month');
    expect(normalized).toContain(
      'DATEPART(YEAR, "dbo_repair_logs"."created_at") AS year',
    );
    expect(normalized).toContain(
      'DATEPART(MONTH, "dbo_repair_logs"."created_at") AS month',
    );
    expect(normalized).toContain(
      'GROUP BY DATEPART(YEAR, "dbo_repair_logs"."created_at")',
    );
  });

  it('rewrites quoted debug entry year aliases', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT
        "YEAR" AS "YEAR",
        "dbo_DebugEntries"."BusinessUnit" AS "manufacturing_unit",
        COUNT("dbo_DebugEntries"."DebugEntryId") AS "throughput"
      FROM "dbo_DebugEntries"
      GROUP BY "YEAR", "dbo_DebugEntries"."BusinessUnit"
      ORDER BY "YEAR" ASC
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).not.toContain('"YEAR" AS "YEAR"');
    expect(normalized).not.toContain('GROUP BY "YEAR"');
    expect(normalized).toContain(
      'DATEPART(YEAR, "dbo_DebugEntries"."DateIn") AS "YEAR"',
    );
    expect(normalized).toContain(
      'GROUP BY DATEPART(YEAR, "dbo_DebugEntries"."DateIn")',
    );
  });

  it('rewrites knowledge article time buckets', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT "YEAR", COUNT("dbo_knowledge_articles"."id") AS "article_count"
      FROM "dbo_knowledge_articles"
      GROUP BY "YEAR"
      ORDER BY "YEAR" ASC
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).not.toContain('SELECT "YEAR"');
    expect(normalized).not.toContain('GROUP BY "YEAR"');
    expect(normalized).toContain(
      'DATEPART(YEAR, "dbo_knowledge_articles"."created_at") AS "year"',
    );
  });

  it('rewrites hallucinated knowledge article fields', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT
        AVG("dbo_knowledge_articles"."effectiveness_score") AS "avg_effectiveness",
        "dbo_knowledge_articles"."created_by" AS "created_by"
      FROM "dbo_knowledge_articles"
      GROUP BY "dbo_knowledge_articles"."created_by"
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).not.toContain('effectiveness_score');
    expect(normalized).not.toContain('"dbo_knowledge_articles"."created_by"');
    expect(normalized).toContain(
      'AVG("dbo_knowledge_articles"."helpful") AS "avg_effectiveness"',
    );
    expect(normalized).toContain('"dbo_knowledge_articles"."author" AS "author"');
    expect(normalized).toContain('GROUP BY "dbo_knowledge_articles"."author"');
  });

  it('rewrites hallucinated kb article creator fields', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT created_by, COUNT(*) AS article_count
      FROM dbo_kb_articles
      GROUP BY created_by
      ORDER BY article_count DESC
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).not.toContain('created_by,');
    expect(normalized).not.toContain('GROUP BY created_by');
    expect(normalized).toContain('"created_by_user_id"');
  });

  it('rewrites quoted dbo-prefixed table names to schema-qualified tables with aliases', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT "dbo_search_queries"."org_id", COUNT(*) AS completed_questions
      FROM "dbo_search_queries"
      WHERE "dbo_search_queries"."result_count" > 0
      GROUP BY "dbo_search_queries"."org_id"
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).toContain('FROM "dbo"."search_queries" AS "dbo_search_queries"');
    expect(normalized).toContain('"dbo_search_queries"."org_id"');
    expect(normalized).not.toContain('FROM "dbo_search_queries"');
  });

  it('rewrites unquoted dbo-prefixed table names to schema-qualified tables with aliases', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT status, COUNT(*) AS count_of_questions
      FROM dbo_tickets
      GROUP BY status
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).toContain('FROM dbo.tickets AS dbo_tickets');
    expect(normalized).not.toContain('FROM dbo_tickets');
  });
});
