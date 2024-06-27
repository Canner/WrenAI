import { IModelColumnRepository, ModelColumn } from '@server/repositories';
import { replaceAllowableSyntax } from './regex';
import { CompactColumn } from '@server/services/metadataService';

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
