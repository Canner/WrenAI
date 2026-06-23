import { DataSourceName } from '../../types';
import { normalizeMssqlSqlForIbis } from '../mssqlSqlNormalizer';

describe('mssqlSqlNormalizer', () => {
  it('rewrites CWSales OTD date aliases before MSSQL preview execution', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT
        DATEPART(YEAR, "dbo_tblSalesHistory"."OTD_Date") AS "year",
        DATEPART(MONTH, "dbo_tblSalesHistory"."OTD_Date") AS "month",
        "dbo_tblSalesHistory"."MarketType" AS "MarketType",
        SUM("dbo_tblSalesHistory"."Qty") AS "TotalQty"
      FROM "dbo_tblSalesHistory"
      GROUP BY
        DATEPART(YEAR, "dbo_tblSalesHistory"."OTD_Date"),
        DATEPART(MONTH, "dbo_tblSalesHistory"."OTD_Date"),
        "dbo_tblSalesHistory"."MarketType"
      ORDER BY
        DATEPART(YEAR, "dbo_tblSalesHistory"."OTD_Date"),
        DATEPART(MONTH, "dbo_tblSalesHistory"."OTD_Date")
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).not.toContain('OTD_Date');
    expect(normalized).toContain('"dbo_tblSalesHistory"."InvDate"');
  });

  it('rewrites CWSales FixLogId aliases before MSSQL preview execution', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT
        "SalesPerson",
        Country,
        COUNT("dbo_qSales1"."FixLogId") AS NumberOfInvoices
      FROM "dbo_qSales1"
      GROUP BY "SalesPerson", Country
      ORDER BY NumberOfInvoices DESC
      LIMIT 1
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).not.toContain('FixLogId');
    expect(normalized).toContain('"dbo_qSales1"."InvoiceNo"');
  });

  it('does not rewrite CWSales aliases for non-MSSQL datasources', () => {
    const sql = 'SELECT "dbo_tblSalesHistory"."OTD_Date" FROM "dbo_tblSalesHistory"';

    expect(normalizeMssqlSqlForIbis(sql, DataSourceName.POSTGRES)).toBe(sql);
  });

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

  it('keeps quoted dbo-prefixed model names for ibis model resolution', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT "dbo_search_queries"."org_id", COUNT(*) AS completed_questions
      FROM "dbo_search_queries"
      WHERE "dbo_search_queries"."result_count" > 0
      GROUP BY "dbo_search_queries"."org_id"
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).toContain('FROM "dbo_search_queries"');
    expect(normalized).toContain('"dbo_search_queries"."org_id"');
    expect(normalized).not.toContain('FROM dbo_search_queries');
  });

  it('quotes unquoted dbo-prefixed model names for ibis model resolution', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT status, COUNT(*) AS count_of_questions
      FROM dbo_tickets
      GROUP BY status
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).toContain('FROM "dbo_tickets"');
    expect(normalized).not.toContain('FROM dbo_tickets');
  });

  it('quotes dbo-prefixed model names for non-MSSQL project contexts', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT org_id, COUNT(*) AS num_questions
      FROM dbo_search_queries
      GROUP BY org_id
      `,
      DataSourceName.POSTGRES,
    );

    expect(normalized).toContain('FROM "dbo_search_queries"');
    expect(normalized).not.toContain('FROM dbo_search_queries');
  });

  it('collapses fully qualified dbo-prefixed model names for switched projects', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT wrenai.public.dbo_search_queries.org_id, COUNT(*) AS num_questions
      FROM wrenai.public.dbo_search_queries
      GROUP BY wrenai.public.dbo_search_queries.org_id
      `,
      DataSourceName.POSTGRES,
    );

    expect(normalized).toContain('FROM "dbo_search_queries"');
    expect(normalized).toContain('"dbo_search_queries".org_id');
    expect(normalized).not.toContain('wrenai.public.dbo_search_queries');
  });

  it('normalizes schema-qualified dbo references back to model names', () => {
    const normalized = normalizeMssqlSqlForIbis(
      `
      SELECT dbo.search_queries.org_id, COUNT(*) AS completed_questions
      FROM dbo.search_queries
      INNER JOIN dbo.organizations ON dbo.search_queries.org_id = dbo.organizations.id
      GROUP BY dbo.organizations.name
      `,
      DataSourceName.MSSQL,
    );

    expect(normalized).toContain('FROM "dbo_search_queries"');
    expect(normalized).toContain('INNER JOIN "dbo_organizations"');
    expect(normalized).toContain('"dbo_search_queries".org_id');
    expect(normalized).not.toContain('dbo.search_queries');
    expect(normalized).not.toContain('dbo.organizations');
  });
});
