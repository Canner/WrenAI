import { DataSourceName } from '@server/types';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const inferMssqlTimestampExpression = (sql: string): string => {
  const qualifiedTimestamp = sql.match(
    /"([^"]+)"\."(created_at|updated_at|generated_at|created_date|date)"/i,
  );
  if (qualifiedTimestamp) {
    return qualifiedTimestamp[0];
  }

  const fromTable = sql.match(/\bFROM\s+"([^"]+)"/i);
  if (fromTable) {
    return `"${fromTable[1]}"."created_at"`;
  }

  const bracketedFromTable = sql.match(/\bFROM\s+\[([^\]]+)\]/i);
  if (bracketedFromTable) {
    return `"${bracketedFromTable[1]}"."created_at"`;
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
          String.raw`(^|,)\s*(?:(?:"[^"]+"\.)"${bucket}"|(?:\[[^\]]+\]\.)\[${bucket}\]|"${bucket}"|\[${bucket}\])(?=\s*(?:,|$))`,
          'gi',
        ),
        `$1 ${expression} AS "${alias}"`,
      );
    });
    return `SELECT${body}`;
  });

  Object.entries(bucketExpressions).forEach(([bucket, expression]) => {
    sql = sql.replace(
      new RegExp(String.raw`(?:"[^"]+"\.)"${bucket}"`, 'gi'),
      expression,
    );
    sql = sql.replace(
      new RegExp(String.raw`(?:\[[^\]]+\]\.)\[${bucket}\]`, 'gi'),
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
    });
    return `${clause}${body}`;
  });

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
  sql = replaceInventedDateFields(sql);
  sql = replaceInventedTimeBuckets(sql);
  return sql;
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
  return rewriteMssqlDatepartAliasReferences(sql, dataSource);
};
