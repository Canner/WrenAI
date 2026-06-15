import { DataSourceName } from '../../types';
import { normalizeMssqlSqlForIbis } from '../mssqlSqlNormalizer';

describe('mssqlSqlNormalizer', () => {
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
});
