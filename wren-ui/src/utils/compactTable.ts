import { CompactTable } from '@/apollo/client/graphql/__types__';

type CompactTableLike = Pick<CompactTable, 'name' | 'properties'>;

export const DEFAULT_CATALOG_LABEL = '默认 catalog';

type CompactTableProperties = {
  catalog?: string | null;
  schema?: string | null;
  table?: string | null;
};

const readStringProperty = (
  properties: CompactTableLike['properties'],
  key: keyof CompactTableProperties,
) => {
  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return null;
  }

  const value = (properties as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : null;
};

export const getCompactTableProperties = (
  table: CompactTableLike,
): CompactTableProperties => ({
  catalog: readStringProperty(table.properties, 'catalog'),
  schema: readStringProperty(table.properties, 'schema'),
  table: readStringProperty(table.properties, 'table'),
});

export const getCompactTableCatalogLabel = (table: CompactTableLike) =>
  getCompactTableProperties(table).catalog || DEFAULT_CATALOG_LABEL;

export const getCompactTableSchemaLabel = (table: CompactTableLike) =>
  getCompactTableProperties(table).schema || '-';

export const getCompactTableBaseName = (table: CompactTableLike) =>
  getCompactTableProperties(table).table || table.name;

export const getCompactTableScopedName = (table: CompactTableLike) => {
  const { schema, table: tableName } = getCompactTableProperties(table);

  if (schema && tableName) {
    return `${schema}.${tableName}`;
  }

  return tableName || table.name;
};

export const getCompactTableQualifiedName = (table: CompactTableLike) => {
  const {
    catalog,
    schema,
    table: tableName,
  } = getCompactTableProperties(table);

  if (catalog && schema && tableName) {
    return `${catalog}.${schema}.${tableName}`;
  }

  if (schema && tableName) {
    return `${schema}.${tableName}`;
  }

  return tableName || table.name;
};
