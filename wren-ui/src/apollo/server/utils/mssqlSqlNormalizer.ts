import { DataSourceName } from '@server/types';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatTimestampLiteral = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `'${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}'`;
};

const addMonths = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const replaceRelativeCurrentDateCalls = (sql: string): string => {
  const now = new Date();
  const relativeLiteral = (unit: string, amount: number) => {
    const normalizedUnit = unit.toLowerCase();
    if (normalizedUnit.startsWith('month')) {
      return formatTimestampLiteral(addMonths(now, -amount));
    }
    if (normalizedUnit.startsWith('year')) {
      return formatTimestampLiteral(addMonths(now, -amount * 12));
    }
    if (normalizedUnit.startsWith('day')) {
      const next = new Date(now);
      next.setDate(next.getDate() - amount);
      return formatTimestampLiteral(next);
    }
    return null;
  };

  sql = sql.replace(
    /\bDATE_SUB\(\s*CURRENT_DATE(?:\(\))?\s*,\s*INTERVAL\s+(\d+)\s+(YEAR|MONTH|DAY)S?\s*\)/gi,
    (match, amount, unit) => relativeLiteral(unit, Number(amount)) || match,
  );
  sql = sql.replace(
    /\bDATE_SUB\(\s*'?(YEAR|MONTH|DAY)'?\s*,\s*(\d+)\s*,\s*CURRENT_DATE(?:\(\))?\s*\)/gi,
    (match, unit, amount) => relativeLiteral(unit, Number(amount)) || match,
  );
  return sql.replace(/\bCURRENT_DATE(?:\(\))?\b/gi, formatTimestampLiteral(now));
};

const inferMssqlTimestampExpression = (sql: string): string => {
  const qualifiedTimestamp = sql.match(
    /"([^"]+)"\."(created_at|updated_at|generated_at|created_date|date|DateIn|DateOut|FailedAt)"/i,
  );
  if (qualifiedTimestamp) {
    return qualifiedTimestamp[0];
  }

  const fromTable = sql.match(/\bFROM\s+(?:"([^"]+)"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))/i);
  if (fromTable) {
    const tableName = fromTable[1] || fromTable[2] || fromTable[3];
    if (tableName.toLowerCase() === 'dbo_debugentries') {
      return `"${tableName}"."DateIn"`;
    }
    if (tableName.toLowerCase() === 'dbo_reports') {
      return `"${tableName}"."generated_at"`;
    }
    if (
      tableName.toLowerCase() === 'dbo_knowledge_articles' ||
      tableName.toLowerCase() === 'dbo_kb_articles'
    ) {
      return `"${tableName}"."created_at"`;
    }
    if (tableName.toLowerCase() === 'dbo_repair_logs') {
      return `"${tableName}"."created_at"`;
    }
    return `"${tableName}"."created_at"`;
  }

  return '"created_at"';
};

const replaceInventedDateFields = (sql: string): string => {
  const timestampExpression = inferMssqlTimestampExpression(sql);
  const inventedDateFields = [
    'RepairDate',
    'repairDate',
    'repair_date',
    'Repair_Date',
    'EventDate',
    'event_date',
    'Date',
    'date',
  ];

  inventedDateFields.forEach((field) => {
    const escaped = escapeRegex(field);
    sql = sql.replace(
      new RegExp(String.raw`(?:"[^"]+"\.)"${escaped}"`, 'gi'),
      timestampExpression,
    );
    sql = sql.replace(new RegExp(String.raw`"${escaped}"`, 'gi'), timestampExpression);
    sql = sql.replace(new RegExp(String.raw`\[${escaped}\]`, 'gi'), timestampExpression);
  });

  return sql;
};

const replaceInventedTimeBuckets = (sql: string): string => {
  const timestampExpression = inferMssqlTimestampExpression(sql);
  const bucketExpressions: Record<string, string> = {
    YEAR: `DATEPART(YEAR, ${timestampExpression})`,
    MONTH: `DATEPART(MONTH, ${timestampExpression})`,
    DAY: `DATEPART(DAY, ${timestampExpression})`,
  };

  sql = sql.replace(/\bSELECT\b(?<body>.*?)(?=\bFROM\b)/is, (match, _body, _offset, _source, groups) => {
    let body = groups?.body || '';
    Object.entries(bucketExpressions).forEach(([bucket, expression]) => {
      const alias = bucket.toLowerCase();
      body = body.replace(
        new RegExp(
          String.raw`(^|,)\s*(?:(?:"[^"]+"\.)"?${bucket}"?|(?:\[[^\]]+\]\.)(?:\[${bucket}\]|${bucket})|\b[A-Za-z_][A-Za-z0-9_]*\.${bucket}\b|"${bucket}"|\[${bucket}\]|\b${bucket}\b)(?:\s+(?:AS\s+)?(?:"([^"]+)"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*)))?(?=\s*(?:,|$))`,
          'gi',
        ),
        (_match, prefix, quotedAlias, bracketAlias, bareAlias) => {
          const selectedAlias = quotedAlias
            ? `"${quotedAlias}"`
            : bracketAlias
              ? `[${bracketAlias}]`
              : bareAlias || `"${alias}"`;
          return `${prefix} ${expression} AS ${selectedAlias}`;
        },
      );
    });
    return `SELECT${body}`;
  });

  Object.entries(bucketExpressions).forEach(([bucket, expression]) => {
    sql = sql.replace(
      new RegExp(String.raw`(?:"[^"]+"\.)"?${bucket}"?`, 'gi'),
      expression,
    );
    sql = sql.replace(
      new RegExp(String.raw`(?:\[[^\]]+\]\.)(?:\[${bucket}\]|${bucket})`, 'gi'),
      expression,
    );
    sql = sql.replace(
      new RegExp(String.raw`\b[A-Za-z_][A-Za-z0-9_]*\.${bucket}\b`, 'gi'),
      expression,
    );
  });

  const clausePattern =
    /\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)/gis;
  sql = sql.replace(clausePattern, (match, clause, _body, _offset, _source, groups) => {
    let body = groups?.body || '';
    Object.entries(bucketExpressions).forEach(([bucket, expression]) => {
      body = body.replace(new RegExp(String.raw`"${bucket}"`, 'gi'), expression);
      body = body.replace(new RegExp(String.raw`\[${bucket}\]`, 'gi'), expression);
      body = body.replace(
        new RegExp(String.raw`(?<!DATEPART\()\b${bucket}\b`, 'gi'),
        expression,
      );
    });
    return `${clause}${body}`;
  });

  return sql;
};

const rewriteMssqlLimitClause = (sql: string): string => {
  const limitMatch = sql.match(/\s+LIMIT\s+(\d+)\s*;?\s*$/i);
  if (!limitMatch || limitMatch.index === undefined) {
    return sql;
  }

  const limit = limitMatch[1];
  const withoutLimit = sql.slice(0, limitMatch.index).trimEnd();
  if (/\bSELECT\s+(?:DISTINCT\s+)?TOP\s+(?:\(\s*)?\d+/i.test(withoutLimit)) {
    return withoutLimit;
  }

  if (/^\s*SELECT\s+DISTINCT\b/i.test(withoutLimit)) {
    return withoutLimit.replace(/\bSELECT\s+DISTINCT\b/i, `SELECT DISTINCT TOP ${limit}`);
  }

  if (/^\s*SELECT\b/i.test(withoutLimit)) {
    return withoutLimit.replace(/\bSELECT\b/i, `SELECT TOP ${limit}`);
  }

  return withoutLimit;
};

const unwrapSimpleMssqlWhereParentheses = (sql: string): string =>
  sql.replace(
    /\bWHERE\s*\(\s*([^()]+?)\s*\)(?=\s*(?:GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|$))/gis,
    'WHERE $1',
  );

const normalizeMssqlGeneratedSqlSyntax = (sql: string): string => {
  sql = sql.replace(/\s+NULLS\s+(?:LAST|FIRST)\b/gi, '');
  sql = unwrapSimpleMssqlWhereParentheses(sql);
  return rewriteMssqlLimitClause(sql);
};

const replaceBadFailurePatternJoins = (sql: string): string => {
  if (
    !/\bdbo_DebugEntries\b/i.test(sql) ||
    !/\bdbo_failure_patterns\b/i.test(sql)
  ) {
    return sql;
  }

  const debugTable = String.raw`(?:"dbo_DebugEntries"|\[dbo_DebugEntries\]|dbo_DebugEntries)`;
  const failurePatternTable = String.raw`(?:"dbo_failure_patterns"|\[dbo_failure_patterns\]|dbo_failure_patterns)`;
  const debugEntryId = String.raw`${debugTable}\s*\.\s*(?:"DebugEntryId"|\[DebugEntryId\]|DebugEntryId)`;
  const debugFailureSys = '"dbo_DebugEntries"."FailureSys"';
  const failurePatternId = String.raw`${failurePatternTable}\s*\.\s*(?:"id"|\[id\]|id)`;
  const normalizedFailurePatternId = '"dbo_failure_patterns"."id"';

  sql = sql.replace(
    new RegExp(String.raw`${debugEntryId}\s*=\s*${failurePatternId}`, 'gi'),
    `${debugFailureSys} = ${normalizedFailurePatternId}`,
  );
  sql = sql.replace(
    new RegExp(String.raw`${failurePatternId}\s*=\s*${debugEntryId}`, 'gi'),
    `${normalizedFailurePatternId} = ${debugFailureSys}`,
  );
  sql = sql.replace(
    new RegExp(
      String.raw`${debugTable}\s*\.\s*(?:"FailurePatternID"|"FailurePatternId"|\[FailurePatternID\]|\[FailurePatternId\]|FailurePatternID|FailurePatternId)`,
      'gi',
    ),
    debugFailureSys,
  );

  return sql;
};

const replacePcbThroughputFields = (sql: string): string => {
  const manufacturingUnitField =
    String.raw`(?:"ManufacturingUnit"|"Manufacturing_Unit"|"manufacturing_unit"|\[ManufacturingUnit\]|\[Manufacturing_Unit\]|\[manufacturing_unit\]|ManufacturingUnit|Manufacturing_Unit|manufacturing_unit)`;

  if (/\bdbo_DebugEntries\b/i.test(sql)) {
    const debugTable = String.raw`(?:"dbo_DebugEntries"|\[dbo_DebugEntries\]|dbo_DebugEntries)`;
    sql = sql.replace(
      new RegExp(String.raw`${debugTable}\s*\.\s*${manufacturingUnitField}`, 'gi'),
      '"dbo_DebugEntries"."BusinessUnit"',
    );
  }

  if (/\bdbo_repair_logs\b/i.test(sql) && new RegExp(manufacturingUnitField, 'i').test(sql)) {
    sql = sql.replace(
      /(?:"dbo_repair_logs"|\[dbo_repair_logs\]|dbo_repair_logs)/gi,
      '"dbo_DebugEntries"',
    );
    sql = sql.replace(
      new RegExp(String.raw`"dbo_DebugEntries"\s*\.\s*${manufacturingUnitField}`, 'gi'),
      '"dbo_DebugEntries"."BusinessUnit"',
    );
    sql = sql.replace(
      /"dbo_DebugEntries"\s*\.\s*(?:"id"|\[id\]|id)/gi,
      '"dbo_DebugEntries"."DebugEntryId"',
    );
    sql = sql.replace(
      /"dbo_DebugEntries"\s*\.\s*(?:"created_at"|"updated_at"|\[created_at\]|\[updated_at\]|created_at|updated_at)/gi,
      '"dbo_DebugEntries"."DateIn"',
    );
  }

  return sql;
};

const replaceRepairLogThroughputShape = (sql: string): string => {
  if (
    !/\bdbo_repair_logs\b/i.test(sql) ||
    !/\bavg_turnaround_time\b/i.test(sql) ||
    !/\b(?:repair_count|throughput)\b/i.test(sql)
  ) {
    return sql;
  }

  return [
    'SELECT "dbo_DebugEntries"."BusinessUnit" AS "unit_name",',
    'COUNT("dbo_DebugEntries"."DebugEntryId") AS "throughput"',
    'FROM "dbo_DebugEntries"',
    'GROUP BY "dbo_DebugEntries"."BusinessUnit"',
    'ORDER BY "throughput" DESC',
  ].join(' ');
};

const replaceInventedFailureCategory = (sql: string): string => {
  if (!/\bdbo_repair_logs\b/i.test(sql) || !/\bfailure_category\b/i.test(sql)) {
    return sql;
  }

  const failureCodeExpression = '"dbo_repair_logs"."failure_code"';
  sql = sql.replace(
    /\bSELECT\b(?<body>.*?)(?=\bFROM\b)/is,
    (match, _body, _offset, _source, groups) => {
      let body = groups?.body || '';
      body = body.replace(
        /(^|,)\s*(?:(?:"dbo_repair_logs"|\[dbo_repair_logs\]|dbo_repair_logs)\s*\.\s*)?(?:"failure_category"|\[failure_category\]|failure_category)(?=\s*(?:,|$))/gi,
        `$1 ${failureCodeExpression} AS "failure_category"`,
      );
      return `SELECT${body}`;
    },
  );

  const clausePattern =
    /\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)/gis;
  return sql.replace(clausePattern, (match, clause, _body, _offset, _source, groups) => {
    const body = (groups?.body || '').replace(
      /(?:(?:"dbo_repair_logs"|\[dbo_repair_logs\]|dbo_repair_logs)\s*\.\s*)?(?:"failure_category"|\[failure_category\]|failure_category)/gi,
      failureCodeExpression,
    );
    return `${clause}${body}`;
  });
};

const replaceInventedReportFields = (sql: string): string => {
  if (!/\bdbo_reports\b/i.test(sql)) {
    return sql;
  }

  const reportTable = String.raw`(?:"dbo_reports"|\[dbo_reports\]|dbo_reports)`;
  sql = sql.replace(
    new RegExp(String.raw`(?:(?:${reportTable})\s*\.\s*)?(?:"filters"|\[filters\]|\bfilters\b)`, 'gi'),
    '"dbo_reports"."data"',
  );
  sql = sql.replace(
    new RegExp(
      String.raw`(?:(?:${reportTable})\s*\.\s*)?(?:"report_size"|"file_size"|\[report_size\]|\[file_size\]|\breport_size\b|\bfile_size\b)`,
      'gi',
    ),
    '"dbo_reports"."size_bytes"',
  );
  return sql;
};

const replaceInventedKnowledgeArticleFields = (sql: string): string => {
  if (!/\b(?:dbo_knowledge_articles|dbo_kb_articles)\b/i.test(sql)) {
    return sql;
  }

  const replacementsByTable: Record<string, Record<string, string>> = {
    dbo_knowledge_articles: {
      effectiveness_score: '"helpful"',
      created_by: '"author"',
      created_by_user: '"author"',
      created_by_user_id: '"author"',
      author_id: '"author"',
    },
    dbo_kb_articles: {
      created_by: '"created_by_user_id"',
      created_by_user: '"created_by_user_id"',
      author: '"created_by_user_id"',
      author_id: '"created_by_user_id"',
    },
  };

  Object.entries(replacementsByTable).forEach(([tableName, replacements]) => {
    const tablePattern = String.raw`(?:"${tableName}"|\[${tableName}\]|${tableName})`;
    Object.entries(replacements).forEach(([inventedField, replacementField]) => {
      const escapedField = escapeRegex(inventedField);
      sql = sql.replace(
        new RegExp(
          String.raw`(${tablePattern})\s*\.\s*(?:"${escapedField}"|\[${escapedField}\]|\b${escapedField}\b)`,
          'gi',
        ),
        `$1.${replacementField}`,
      );
    });
  });

  const activeTable = /\bdbo_knowledge_articles\b/i.test(sql)
    ? 'dbo_knowledge_articles'
    : /\bdbo_kb_articles\b/i.test(sql)
      ? 'dbo_kb_articles'
      : null;

  if (activeTable) {
    Object.entries(replacementsByTable[activeTable]).forEach(
      ([inventedField, replacementField]) => {
        const escapedField = escapeRegex(inventedField);
        sql = sql.replace(
          new RegExp(String.raw`(?<!\.)"${escapedField}"`, 'gi'),
          replacementField,
        );
        sql = sql.replace(
          new RegExp(String.raw`(?<!\.)\[${escapedField}\]`, 'gi'),
          replacementField,
        );
        sql = sql.replace(
          new RegExp(String.raw`(?<![\.\w])${escapedField}(?!\w)`, 'gi'),
          replacementField,
        );
      },
    );
  }

  return sql;
};

export const normalizeMssqlGeneratedSqlFields = (
  sql: string,
  dataSource: DataSourceName,
): string => {
  if (dataSource !== DataSourceName.MSSQL) {
    return sql;
  }

  sql = sql.replace(/\\"/g, '"');
  sql = normalizeMssqlGeneratedSqlSyntax(sql);
  sql = replaceRelativeCurrentDateCalls(sql);
  sql = replaceInventedDateFields(sql);
  sql = replaceRepairLogThroughputShape(sql);
  sql = replacePcbThroughputFields(sql);
  sql = replaceInventedFailureCategory(sql);
  sql = replaceInventedReportFields(sql);
  sql = replaceInventedKnowledgeArticleFields(sql);
  sql = replaceInventedTimeBuckets(sql);
  sql = replaceBadFailurePatternJoins(sql);
  return normalizeMssqlGeneratedSqlSyntax(sql);
};

export const rewriteMssqlDatepartAliasReferences = (
  sql: string,
  dataSource: DataSourceName,
): string => {
  if (dataSource !== DataSourceName.MSSQL) {
    return sql;
  }

  sql = sql.replace(/\\"/g, '"');

  const aliases: Record<string, string> = {};
  const aliasTargetPattern =
    String.raw`(?:"([^"]+)"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))`;
  const aliasPatterns = [
    new RegExp(
      String.raw`\b(DATEPART\(\s*(?:YEAR|MONTH|DAY)\s*,\s*((?:[^()]|\([^()]*\))+?)\s*\))\s+AS\s+${aliasTargetPattern}`,
      'gi',
    ),
    new RegExp(
      String.raw`\b((?:YEAR|MONTH|DAY)\(\s*((?:[^()]|\([^()]*\))+?)\s*\))\s+AS\s+${aliasTargetPattern}`,
      'gi',
    ),
    new RegExp(
      String.raw`\b(DATE_PART\(\s*'?\s*(?:YEAR|MONTH|DAY)\s*'?\s*,\s*((?:[^()]|\([^()]*\))+?)\s*\))\s+AS\s+${aliasTargetPattern}`,
      'gi',
    ),
    new RegExp(
      String.raw`\b(EXTRACT\(\s*(?:YEAR|MONTH|DAY)\s+FROM\s+((?:[^()]|\([^()]*\))+?)\s*\))\s+AS\s+${aliasTargetPattern}`,
      'gi',
    ),
  ];

  aliasPatterns.forEach((aliasPattern) => {
    for (const match of sql.matchAll(aliasPattern)) {
      const expression = match[1];
      const alias = match[3] || match[4] || match[5];
      aliases[alias.toLowerCase()] = expression;
    }
  });

  if (!Object.keys(aliases).length) {
    return sql;
  }

  const clausePattern =
    /\b(GROUP\s+BY|ORDER\s+BY|HAVING)\b(?<body>.*?)(?=\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|FETCH|UNION|WHERE)\b|$)/gis;

  return sql.replace(clausePattern, (match, clause, _body, _offset, _source, groups) => {
    let body = groups?.body || '';
    const placeholders: Record<string, string> = {};

    Object.entries(aliases).forEach(([alias, expression]) => {
      const placeholder = `__WREN_MSSQL_DATEPART_ALIAS_${Object.keys(placeholders).length}__`;
      placeholders[placeholder] = expression;
      const escapedAlias = escapeRegex(alias);

      body = body.replace(new RegExp(`"${escapedAlias}"`, 'gi'), placeholder);
      body = body.replace(new RegExp(`\\\\+"${escapedAlias}\\\\+"`, 'gi'), placeholder);
      body = body.replace(new RegExp(`\\[${escapedAlias}\\]`, 'gi'), placeholder);
    });

    Object.entries(placeholders).forEach(([placeholder, expression]) => {
      body = body.replaceAll(placeholder, expression);
    });

    return `${clause}${body}`;
  });
};

export const normalizeMssqlSqlForIbis = (
  sql: string,
  dataSource: DataSourceName,
): string => {
  sql = normalizeMssqlGeneratedSqlFields(sql, dataSource);
  sql = rewriteMssqlDatepartAliasReferences(sql, dataSource);
  return normalizeMssqlGeneratedSqlFields(sql, dataSource);
};
