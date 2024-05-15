import { IModelColumnRepository, ModelColumn } from '../repositories';
import { replaceAllowableSyntax } from '@server/utils/regex';

export function findColumnsToUpdate(
  columns: string[],
  existingColumns: ModelColumn[],
): {
  toDeleteColumnIds: number[];
  toCreateColumns: string[];
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
  return {
    toDeleteColumnIds,
    toCreateColumns,
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

export function adaptColumnNameToReferenceName(columnName: string) {
  let referenceName = replaceAllowableSyntax(columnName);
  // If the reference name does not start with a letter, add a prefix
  const startWithLetterRegex = /^[A-Za-z]/;
  if (!startWithLetterRegex.test(referenceName)) {
    referenceName = `r_${referenceName}`;
  }
  return referenceName;
}
