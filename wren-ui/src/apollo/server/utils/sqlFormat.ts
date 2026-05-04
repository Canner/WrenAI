import { format, FormatOptionsWithLanguage } from 'sql-formatter';
import { getLogger } from './logger';

const logger = getLogger('SQL Format');

export function safeFormatSQL(
  sql: string,
  options?: FormatOptionsWithLanguage,
): string {
  try {
    return format(sql, options);
  } catch (err) {
    try {
      logger.debug(`Fallback to Trino dialect for SQL formatting...`);
      // Try using Trino as the fallback dialect
      return format(sql, { ...options, language: 'trino' });
    } catch (_fallbackError) {
      logger.error(`Failed to format SQL: ${err.message}`);
      return sql;
    }
  }
}
