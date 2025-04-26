import { ColumnMetadata } from '@server/services/queryService';

/**
 * Transform raw data (columns + rows) into an array of objects
 * @param columns Column metadata (name, type)
 * @param rows Raw data rows
 * @returns Array of objects with column names as keys
 */
export const transformToObjects = (
  columns: ColumnMetadata[],
  rows: any[][],
): Record<string, any>[] => {
  if (!rows || !columns || rows.length === 0 || columns.length === 0) {
    return [];
  }

  // throw an error if the number of columns in the rows does not match the number of columns in the columns array
  if (rows[0].length !== columns.length) {
    throw new Error(
      'Number of columns in the rows does not match the number of columns in the columns array',
    );
  }

  return rows.map((row) => {
    const obj: Record<string, any> = {};
    columns.forEach((col, index) => {
      obj[col.name] = row[index];
    });
    return obj;
  });
};
