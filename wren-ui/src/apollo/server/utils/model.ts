import {
  IModelColumnRepository,
  ModelColumn,
  ModelNestedColumn,
} from '@server/repositories';
import { replaceAllowableSyntax } from './regex';
import { CompactColumn } from '@server/services/metadataService';

export function getPreviewColumnsStr(modelColumns: ModelColumn[]) {
  if (modelColumns.length === 0) return '*';
  const columns = modelColumns.map((column) => `"${column.referenceName}"`);
  return columns.join(',');
}

export function transformInvalidColumnName(columnName: string) {
  let referenceName = replaceAllowableSyntax(columnName);
  // If the reference name does not start with a letter, add a prefix
  const startWithLetterRegex = /^[A-Za-z]/;
  if (!startWithLetterRegex.test(referenceName)) {
    referenceName = `col_${referenceName}`;
  }
  return referenceName;
}

export function replaceInvalidReferenceName(referenceName: string) {
  // replace dot with underscore
  return referenceName.replace(/\./g, '_');
}

export function findColumnsToUpdate(
  columns: string[],
  existingColumns: ModelColumn[],
  sourceTableColumns: CompactColumn[],
): {
  toDeleteColumnIds: number[];
  toCreateColumns: string[];
  toUpdateColumns: Array<{
    id: number;
    sourceColumnName: string;
    type: string;
  }>;
} {
  const toDeleteColumnIds = existingColumns
    .map(({ id, sourceColumnName }) => {
      const shouldKeep = columns.includes(sourceColumnName);
      return shouldKeep ? undefined : id;
    })
    .filter((id) => id);
  const existColumnNames = existingColumns.map(
    ({ sourceColumnName }) => sourceColumnName,
  );
  const toCreateColumns = columns.filter(
    (columnName) => !existColumnNames.includes(columnName),
  );

  const toUpdateColumns = sourceTableColumns.reduce((acc, sourceColumn) => {
    const existingColumn = existingColumns.find(
      (col) => col.sourceColumnName === sourceColumn.name,
    );
    if (!existingColumn) return acc;

    const columnName = columns.find((col) => col === sourceColumn.name);
    if (!columnName) return acc;

    if (sourceColumn.type === existingColumn.type) return acc;

    return [
      ...acc,
      {
        id: existingColumn.id,
        sourceColumnName: sourceColumn.name,
        type: sourceColumn.type || 'string',
      },
    ];
  }, []);

  return {
    toDeleteColumnIds,
    toCreateColumns,
    toUpdateColumns,
  };
}

export async function updateModelPrimaryKey(
  repository: IModelColumnRepository,
  modelId: number,
  primaryKey: string,
) {
  await repository.resetModelPrimaryKey(modelId);
  if (primaryKey) {
    await repository.setModelPrimaryKey(modelId, primaryKey);
  }
}

export function handleNestedColumns(
  column: CompactColumn,
  parent: {
    modelId: number;
    columnId: number;
    sourceColumnName: string;
    columnPath?: string[];
  },
): Partial<ModelNestedColumn>[] {
  if (!column.nestedColumns) return [];

  const nestedColumnValues = [];
  for (const nestedColumn of column.nestedColumns) {
    const parentColumnPath = (parent as Partial<ModelNestedColumn>)
      .columnPath || [parent.sourceColumnName];
    const name = nestedColumn.name.split(`${parent.sourceColumnName}.`)[1];
    const columnPath = [...parentColumnPath, name];
    const nestedColumnValue = {
      modelId: parent.modelId,
      columnId: parent.columnId,
      columnPath,
      displayName: nestedColumn.name,
      sourceColumnName: nestedColumn.name,
      referenceName: columnPath.map(transformInvalidColumnName).join('.'),
      type: nestedColumn.type || 'string',
      properties: nestedColumn.properties,
    } as Partial<ModelNestedColumn>;
    nestedColumnValues.push(nestedColumnValue);
    nestedColumnValues.push(
      ...handleNestedColumns(nestedColumn, {
        modelId: parent.modelId,
        columnId: parent.columnId,
        sourceColumnName: nestedColumn.name,
        columnPath,
      }),
    );
  }
  return nestedColumnValues;
}
