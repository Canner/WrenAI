const NAMED_SQL_PARAM_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/;

const inferDryRunLiteralForNamedSqlParam = (paramName: string) => {
  if (/(^|_)(date|day)(_|$)/i.test(paramName)) {
    return "DATE '2026-04-01'";
  }

  if (/(^|_)(time|timestamp)(_|$)|(_at)$/i.test(paramName)) {
    return "TIMESTAMP '2026-04-01 00:00:00'";
  }

  if (/(^|_)(is|has|flag|enabled|active|deleted)(_|$)/i.test(paramName)) {
    return 'TRUE';
  }

  if (
    /(^|_)(id|no|count|num|amount|total|size|days|month|year|percent|ratio|score|price|salary|age|limit|offset)(_|$)/i.test(
      paramName,
    )
  ) {
    return '0';
  }

  return "'sample'";
};

export const prepareSqlForDryRunValidation = (sql: string) => {
  let result = '';
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      result += current;
      if (current === '\n') inLineComment = false;
      index += 1;
      continue;
    }

    if (inBlockComment) {
      result += current;
      if (current === '*' && next === '/') {
        result += next;
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (current === '-' && next === '-') {
        result += current + next;
        inLineComment = true;
        index += 2;
        continue;
      }

      if (current === '/' && next === '*') {
        result += current + next;
        inBlockComment = true;
        index += 2;
        continue;
      }
    }

    if (!inDoubleQuote && !inBacktick && current === "'") {
      result += current;
      if (inSingleQuote && next === "'") {
        result += next;
        index += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      index += 1;
      continue;
    }

    if (!inSingleQuote && !inBacktick && current === '"') {
      result += current;
      inDoubleQuote = !inDoubleQuote;
      index += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && current === '`') {
      result += current;
      inBacktick = !inBacktick;
      index += 1;
      continue;
    }

    const canReplaceNamedParam =
      !inSingleQuote &&
      !inDoubleQuote &&
      !inBacktick &&
      current === ':' &&
      next !== ':' &&
      sql[index - 1] !== ':';

    if (canReplaceNamedParam) {
      const remaining = sql.slice(index + 1);
      const match = remaining.match(NAMED_SQL_PARAM_PATTERN);
      if (match) {
        result += inferDryRunLiteralForNamedSqlParam(match[0]);
        index += 1 + match[0].length;
        continue;
      }
    }

    result += current;
    index += 1;
  }

  return result;
};
