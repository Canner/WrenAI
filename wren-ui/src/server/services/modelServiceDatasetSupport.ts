import { SampleDatasetTable } from '@server/data';
import { getLogger } from '@server/utils';
import { ModelColumn } from '@server/repositories';
import {
  GenerateReferenceNameData,
  ModelServiceDependencies,
} from './modelServiceTypes';

const logger = getLogger('ModelService');
logger.level = 'debug';

export const updatePrimaryKeys = async (
  deps: ModelServiceDependencies,
  bridgeProjectId: number,
  tables: SampleDatasetTable[],
): Promise<void> => {
  logger.debug('start update primary keys');
  const models = await deps.modelRepository.findAllBy({
    projectId: bridgeProjectId,
  });
  const tableToUpdate = tables.filter((table) => table.primaryKey);
  for (const table of tableToUpdate) {
    if (!table.primaryKey) {
      continue;
    }
    const model = models.find(
      (item) => item.sourceTableName === table.tableName,
    );
    if (!model) {
      logger.debug(`Model not found, table name: ${table.tableName}`);
      continue;
    }
    await deps.modelColumnRepository.setModelPrimaryKey(
      model.id,
      table.primaryKey,
    );
  }
};

export const batchUpdateModelProperties = async (
  deps: ModelServiceDependencies,
  bridgeProjectId: number,
  tables: SampleDatasetTable[],
): Promise<void> => {
  logger.debug('start batch update model description');
  const models = await deps.modelRepository.findAllBy({
    projectId: bridgeProjectId,
  });

  await Promise.all(
    tables.map(async (table) => {
      const model = models.find(
        (item) => item.sourceTableName === table.tableName,
      );
      if (!model) {
        logger.debug(`Model not found, table name: ${table.tableName}`);
        return;
      }
      const properties = model.properties
        ? { ...JSON.parse(model.properties), ...table.properties }
        : { ...table.properties };
      await deps.modelRepository.updateOne(model.id, {
        displayName: table.properties?.displayName || model.displayName,
        properties: JSON.stringify(properties),
      });
    }),
  );
};

export const batchUpdateColumnProperties = async (
  deps: ModelServiceDependencies,
  bridgeProjectId: number,
  tables: SampleDatasetTable[],
): Promise<void> => {
  logger.debug('start batch update column description');
  const models = await deps.modelRepository.findAllBy({
    projectId: bridgeProjectId,
  });
  const sourceColumns = (await deps.modelColumnRepository.findColumnsByModelIds(
    models.map((model) => model.id),
  )) as ModelColumn[];
  const transformedColumns = tables.reduce<
    Array<{
      tableName: string;
      name: string;
      description?: string;
      properties?: Record<string, any>;
    }>
  >((acc, table) => {
    const columns = table.columns?.map((column) => ({
      ...column,
      tableName: table.tableName,
    }));
    if (columns) {
      acc.push(...columns);
    }
    return acc;
  }, []);

  await Promise.all(
    transformedColumns.map(async (column) => {
      if (!column.properties) {
        return;
      }
      const model = models.find(
        (item) => item.sourceTableName === column.tableName,
      );
      if (!model) {
        logger.debug(`Model not found, table name: ${column.tableName}`);
        return;
      }
      const sourceColumn = sourceColumns.find(
        (item) =>
          item.modelId === model.id && item.sourceColumnName === column.name,
      );
      if (!sourceColumn) {
        logger.debug(
          `Column not found, table name: ${column.tableName}, column name: ${column.name}`,
        );
        return;
      }
      const properties = sourceColumn.properties
        ? {
            ...JSON.parse(sourceColumn.properties),
            ...column.properties,
          }
        : { description: column.description };
      await deps.modelColumnRepository.updateOne(sourceColumn.id, {
        properties: JSON.stringify(properties),
      });
    }),
  );
};

export const generateReferenceName = (
  data: GenerateReferenceNameData,
): string => {
  const { sourceTableName, existedReferenceNames } = data;
  if (!existedReferenceNames.includes(sourceTableName)) {
    return sourceTableName;
  }
  return `${sourceTableName}_${existedReferenceNames.length + 1}`;
};
