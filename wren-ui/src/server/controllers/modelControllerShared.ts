import { CompactTable } from '@server/services';

export const isMissingRuntimeExecutionContextError = (error: unknown) =>
  error instanceof Error &&
  (error.message === 'No deployment found, please deploy your project first' ||
    error.message ===
      'MDL runtime identity requires deploy metadata or resolvable project metadata');

export const parseJsonObject = (value?: string | null): Record<string, any> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export type ViewMetadataColumn = {
  name: string;
  properties?: Record<string, any>;
};

export type ViewMetadataProperties = Record<string, any> & {
  columns?: ViewMetadataColumn[];
};

export enum SyncStatusEnum {
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCRONIZED = 'SYNCRONIZED',
  UNSYNCRONIZED = 'UNSYNCRONIZED',
}

const readCompactTableProperty = (
  table: CompactTable,
  key: 'catalog' | 'schema' | 'table',
) => {
  const properties =
    table?.properties && typeof table.properties === 'object'
      ? (table.properties as Record<string, unknown>)
      : null;
  const value = properties?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
};

export const resolveCompactTableNameCandidates = (table: CompactTable) => {
  const catalog = readCompactTableProperty(table, 'catalog');
  const schema = readCompactTableProperty(table, 'schema');
  const baseTableName = readCompactTableProperty(table, 'table');
  const candidates = new Set<string>();

  const push = (value?: string | null) => {
    if (!value) {
      return;
    }
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return;
    }
    candidates.add(normalizedValue);
  };

  push(table.name);
  push(baseTableName);
  push(schema && baseTableName ? `${schema}.${baseTableName}` : null);
  push(
    catalog && schema && baseTableName
      ? `${catalog}.${schema}.${baseTableName}`
      : null,
  );

  return Array.from(candidates);
};

export const findConnectionTableByNameSupport = (
  tableName: string,
  connectionTables: CompactTable[],
) => {
  const normalizedTableName = tableName.trim();
  return connectionTables.find((table) =>
    resolveCompactTableNameCandidates(table).includes(normalizedTableName),
  );
};

export const validateTableExistSupport = (
  tableName: string,
  connectionTables: CompactTable[],
) => {
  if (!findConnectionTableByNameSupport(tableName, connectionTables)) {
    throw new Error(`Table ${tableName} not found in the connection`);
  }
};

export const validateColumnsExistSupport = (
  tableName: string,
  fields: string[],
  connectionTables: CompactTable[],
) => {
  const tableColumns = findConnectionTableByNameSupport(
    tableName,
    connectionTables,
  )?.columns;
  const existingColumns = tableColumns ?? [];
  for (const field of fields) {
    if (!existingColumns.find((column) => column.name === field)) {
      throw new Error(
        `Column "${field}" not found in table "${tableName}" in the connection`,
      );
    }
  }
};

export const determineMetadataValueSupport = (value: string) =>
  value === '' ? null : value;
