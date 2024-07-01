import { camelCase, differenceWith, isEmpty, isEqual, uniqBy } from 'lodash';
import { IContext } from '@server/types';
import { getLogger } from 'log4js';
import { SchemaChange } from '@server/repositories/schemaChangeRepository';
import { Model, ModelColumn, RelationInfo } from '../repositories';

const logger = getLogger('DataSourceSchemaDetector');
logger.level = 'debug';

export type DataSourceSchema = {
  name: string;
  columns: {
    name: string;
    type: string;
  }[];
};

export type DataSourceSchemaChange = {
  [SchemaChangeType.DELETED_TABLES]?: DataSourceSchema[];
  [SchemaChangeType.DELETED_COLUMNS]?: DataSourceSchema[];
  [SchemaChangeType.MODIFIED_COLUMNS]?: DataSourceSchema[];
};

export type DataSourceSchemaResolve = {
  [SchemaChangeType.DELETED_TABLES]?: boolean;
  [SchemaChangeType.DELETED_COLUMNS]?: boolean;
  [SchemaChangeType.MODIFIED_COLUMNS]?: boolean;
};

export enum SchemaChangeType {
  // the tables has been deleted
  DELETED_TABLES = 'deletedTables',
  // the columns has been deleted
  DELETED_COLUMNS = 'deletedColumns',
  // the columns type has been changed
  MODIFIED_COLUMNS = 'modifiedColumns',
}

interface AffectedResources {
  sourceTableName: string;
  referenceName: string;
  displayName: string;
  modelId: number;
  columns: Array<{
    sourceColumnName: string;
    displayName: string;
    type: string;
  }>;
  relationships: Array<{
    id: number;
    displayName: string;
    referenceName: string;
  }>;
  calculatedFields: ModelColumn[];
}

export interface IDataSourceSchemaDetector {
  detectSchemaChange(): Promise<boolean>;
  resolveSchemaChange(type: string): Promise<void>;
  getAffectedResources(
    changes: DataSourceSchema[],
    {
      models,
      modelColumns,
      modelRelationships,
    }: {
      models: Model[];
      modelColumns: ModelColumn[];
      modelRelationships: RelationInfo[];
    },
  ): AffectedResources[];
}

export default class DataSourceSchemaDetector
  implements IDataSourceSchemaDetector
{
  public ctx: IContext;
  public projectId: number;

  constructor({ ctx, projectId }: { ctx: IContext; projectId: number }) {
    this.ctx = ctx;
    this.projectId = projectId;
  }

  public async detectSchemaChange() {
    const diffSchema = await this.getDiffSchema();
    if (diffSchema) {
      await this.addSchemaChange(diffSchema);
    } else {
      // Mark resolve all in last schema change if it has unresolved flag when no schema change detected.
      const lastSchemaChange =
        await this.ctx.schemaChangeRepository.findLastSchemaChange(
          this.projectId,
        );
      if (lastSchemaChange !== null) {
        const hasUnresolved = Object.values(lastSchemaChange.resolve).some(
          (resolve) => !resolve,
        );
        if (hasUnresolved) {
          await this.updateResolveToSchemaChange(
            lastSchemaChange,
            Object.values(SchemaChangeType),
          );
        }
      }
    }

    return !!diffSchema;
  }

  public async resolveSchemaChange(type: string) {
    const schemaChangeType = camelCase(type) as SchemaChangeType;
    const supportedTypes = [
      SchemaChangeType.DELETED_TABLES,
      SchemaChangeType.DELETED_COLUMNS,
    ];
    if (!supportedTypes.includes(schemaChangeType)) {
      throw new Error('Resolved scheme change type is not supported.');
    }

    const lastSchemaChange =
      await this.ctx.schemaChangeRepository.findLastSchemaChange(
        this.projectId,
      );
    const changes = lastSchemaChange?.change[schemaChangeType];
    const isResolved = lastSchemaChange?.resolve[schemaChangeType];

    if (isResolved) {
      throw new Error(
        `Schema change "${schemaChangeType}" has nothing to resolve.`,
      );
    }

    const models = await this.ctx.modelRepository.findAllBy({
      projectId: this.projectId,
    });

    const modelIds = models.map((model) => model.id);
    const modelColumns =
      await this.ctx.modelColumnRepository.findColumnsByModelIds(modelIds);

    const modelRelationships =
      await this.ctx.relationRepository.findRelationInfoBy({
        modelIds,
      });

    const affectedResources = this.getAffectedResources(changes, {
      models,
      modelColumns,
      modelRelationships,
    });

    /**
     * Handle resolve scheme change for DELETED_TABLES / DELETED_COLUMNS
     *  1. Remove all affected calculated fields
     *  2. Remove all affected columns if DELETED_COLUMNS
     *  3. Remove all affected tables if DELETED_TABLES
     *
     *  Considering that we have set up foreign keys, some data will be automatically deleted in cascade,
     *  so there is no need to perform additional deletions. (E.g., relationships, model's column)
     */
    await Promise.all(
      affectedResources.map(async (resource) => {
        // both DELETED_TABLES and DELETED_COLUMNS need to remove all affected calculated fields
        logger.debug(
          `Start to remove all affected calculated fields "${resource.calculatedFields.map(
            (column) => `${column.displayName} (${column.referenceName})`,
          )}".`,
        );

        const columnIds = resource.calculatedFields.map((column) => column.id);
        await this.ctx.modelColumnRepository.deleteAllByColumnIds(columnIds);

        // remove columns if SchemaChangeType is DELETED_COLUMNS
        if (schemaChangeType === SchemaChangeType.DELETED_COLUMNS) {
          const affectedColumnNames = resource.columns.map(
            (column) => column.sourceColumnName,
          );

          logger.debug(
            `Start to remove columns "${affectedColumnNames}" from model "${resource.referenceName}".`,
          );

          await this.ctx.modelColumnRepository.deleteAllBySourceColumnNames(
            resource.modelId,
            affectedColumnNames,
          );
        }
        return;
      }),
    );

    // remove tables if SchemaChangeType is DELETED_TABLES
    if (schemaChangeType === SchemaChangeType.DELETED_TABLES) {
      // delete models
      const affectedTableNames = changes.map((table) => table.name);

      logger.debug(
        `Start to remove tables "${affectedTableNames}" from models.`,
      );

      await this.ctx.modelRepository.deleteAllBySourceTableNames(
        affectedTableNames,
      );
    }

    // update resolve flag
    await this.updateResolveToSchemaChange(lastSchemaChange, [
      schemaChangeType,
    ]);
  }

  /**
   * According to affected models and column data, we also need to find affected resources, including calculated fields and relationships.
   *
   * Find all affected resources include:
   *  - columns (called "affected column")
   *  - relationships (called "affected relationship")
   *  - calculated fields:
   *    - calculated fields which were affected by affected columns
   *    - calculated fields which were affected by affected relationships
   */
  public getAffectedResources(
    changes: DataSourceSchema[],
    {
      models,
      modelColumns,
      modelRelationships,
    }: {
      models: Model[];
      modelColumns: ModelColumn[];
      modelRelationships: RelationInfo[];
    },
  ) {
    const affectedModels = models.filter(
      (model) =>
        changes.findIndex((table) => table.name === model.sourceTableName) !==
        -1,
    );

    const affectedResources = affectedModels.map((model) => {
      const affectedColumns = changes.find(
        (table) => table.name === model.sourceTableName,
      ).columns;

      const allCalculatedFields = modelColumns.filter(
        (column) => column.isCalculated,
      );

      const affectedMaterials = affectedColumns.reduce(
        (result, column) => {
          const affectedColumn = modelColumns.find(
            (modelColumn) =>
              modelColumn.sourceColumnName === column.name &&
              modelColumn.modelId === model.id,
          );

          result.columns.push({
            sourceColumnName: column.name,
            displayName: affectedColumn.displayName,
            type: column.type,
          });

          // collect affected calculated fields if it's target column
          const affectedCalculatedFieldsByColumnId = allCalculatedFields.filter(
            (calculatedField) => {
              const lineage = JSON.parse(calculatedField.lineage);
              return (
                lineage && lineage[lineage.length - 1] === affectedColumn.id
              );
            },
          );

          result.calculatedFields.push(...affectedCalculatedFieldsByColumnId);

          // collect affected relationships
          const affectedRelationships = modelRelationships
            .map((relationship) =>
              [relationship.fromColumnId, relationship.toColumnId].includes(
                affectedColumn.id,
              )
                ? relationship
                : null,
            )
            .filter((relationship) => !!relationship);

          affectedRelationships.forEach((relationship) => {
            const referenceName =
              model.referenceName === relationship.fromModelName
                ? relationship.toModelName
                : relationship.fromModelName;

            const displayName = models.find(
              (model) => model.referenceName === referenceName,
            )?.displayName;

            result.relationships.push({
              displayName,
              id: relationship.id,
              referenceName,
            });

            // collect affected calculated fields if the relationship is in use
            const affectedCalculatedFieldsByRelationshipId =
              allCalculatedFields.filter((calculatedField) => {
                const lineage = JSON.parse(calculatedField.lineage);

                // pop the column ID from the lineage
                lineage.pop();
                return lineage && lineage.includes(relationship.id);
              });

            result.calculatedFields.push(
              ...affectedCalculatedFieldsByRelationshipId,
            );
          });

          return result;
        },
        { columns: [], relationships: [], calculatedFields: [] },
      );

      // unique calculated fields by id since it can be duplicated
      const calculatedFields = uniqBy(affectedMaterials.calculatedFields, 'id');

      return {
        sourceTableName: model.sourceTableName,
        displayName: model.displayName,
        referenceName: model.referenceName,
        modelId: model.id,
        ...affectedMaterials,
        calculatedFields,
      };
    });

    return affectedResources;
  }

  private async getDiffSchema() {
    logger.info('Start to detect Data Source Schema changes.');
    const currentSchema = await this.getCurrentSchema();
    const latestSchema = await this.getLatestSchema();

    const diffSchema = currentSchema.reduce((result, currentTable) => {
      const lastestTable = latestSchema.find(
        (table) => table.name === currentTable.name,
      );
      // If the table is not found in the latest schema, it means the table has been deleted.
      if (!lastestTable) {
        result[SchemaChangeType.DELETED_TABLES] = [
          ...(result[SchemaChangeType.DELETED_TABLES] || []),
          currentTable,
        ];
        return result;
      }

      // If the table is found in the latest schema, we need to diff the columns.
      const diffColumns = differenceWith(
        currentTable.columns,
        lastestTable.columns,
        isEqual,
      );
      if (diffColumns.length > 0) {
        const deletedColumnChange = { name: currentTable.name, columns: [] };
        const modifiedColumnChange = { name: currentTable.name, columns: [] };

        for (const currentColumn of diffColumns) {
          const latestColumn = lastestTable.columns.find(
            (column) => column.name === currentColumn.name,
          );
          // If the column is not found in the latest schema, it means the column has been deleted.
          if (!latestColumn) {
            deletedColumnChange.columns.push(currentColumn);
            continue;
          }
          // If the column is found in the latest schema, it means the column has been modified.
          // save latest column as modified column
          modifiedColumnChange.columns.push(latestColumn);
        }

        // If there are any deleted or modified columns, we need to add them to the result.
        if (deletedColumnChange.columns.length > 0) {
          result[SchemaChangeType.DELETED_COLUMNS] = [
            ...(result[SchemaChangeType.DELETED_COLUMNS] || []),
            deletedColumnChange,
          ];
        }
        if (modifiedColumnChange.columns.length > 0) {
          result[SchemaChangeType.MODIFIED_COLUMNS] = [
            ...(result[SchemaChangeType.MODIFIED_COLUMNS] || []),
            modifiedColumnChange,
          ];
        }
      }

      return result;
    }, {});

    if (!isEmpty(diffSchema)) {
      logger.debug('Diff Schema:', JSON.stringify(diffSchema));
      logger.info('Data Source Schema has changed.');
      return diffSchema as DataSourceSchemaChange;
    }

    logger.info('No changes in Data Source Schema.');
    return null;
  }

  private async addSchemaChange(diffSchema: DataSourceSchemaChange) {
    const getResolveState = (change) => (!!change ? false : undefined);

    const lastSchemaChange =
      await this.ctx.schemaChangeRepository.findLastSchemaChange(
        this.projectId,
      );
    // If the schema change is the same as the last one, we don't need to create a new one.
    const isNewSchemaChange =
      JSON.stringify(lastSchemaChange?.change) !== JSON.stringify(diffSchema);

    if (isNewSchemaChange) {
      await this.ctx.schemaChangeRepository.createOne({
        projectId: this.projectId,
        change: diffSchema,
        // Set the resolve to false if there are any changes. It will set resolve to true once the schema has been synced.
        resolve: {
          [SchemaChangeType.DELETED_TABLES]: getResolveState(
            diffSchema[SchemaChangeType.DELETED_TABLES],
          ),
          [SchemaChangeType.DELETED_COLUMNS]: getResolveState(
            diffSchema[SchemaChangeType.DELETED_COLUMNS],
          ),
          [SchemaChangeType.MODIFIED_COLUMNS]: getResolveState(
            diffSchema[SchemaChangeType.MODIFIED_COLUMNS],
          ),
        },
      });
    }
  }

  private async getCurrentSchema(): Promise<DataSourceSchema[]> {
    const models = await this.ctx.modelRepository.findAllBy({
      projectId: this.projectId,
    });
    const modelIds = models.map((model) => model.id);
    const modelColumns =
      await this.ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const result = models.map((model) => {
      return {
        name: model.sourceTableName,
        columns: modelColumns
          .filter(
            (column) => column.modelId === model.id && !column.isCalculated,
          )
          .map((column) => ({
            name: column.sourceColumnName,
            type: column.type,
          })),
      };
    });
    return result;
  }

  private async getLatestSchema(): Promise<DataSourceSchema[]> {
    const project = await this.ctx.projectRepository.findOneBy({
      id: this.projectId,
    });
    const latestDataSourceTables =
      await this.ctx.projectService.getProjectDataSourceTables(project);
    const result = latestDataSourceTables.map((table) => {
      return {
        name: table.name,
        columns: table.columns.map((column) => {
          return {
            name: column.name,
            type: column.type,
          };
        }),
      };
    });
    return result;
  }

  private async updateResolveToSchemaChange(
    lastSchemaChange: SchemaChange,
    schemaChangeTypes: SchemaChangeType[],
  ) {
    await this.ctx.schemaChangeRepository.updateOne(lastSchemaChange.id, {
      resolve: {
        ...lastSchemaChange.resolve,
        ...schemaChangeTypes.reduce(
          (result, type) => ({ ...result, [type]: true }),
          {},
        ),
      },
    });
    logger.info(`Schema change "${schemaChangeTypes}" resolved successfully.`);
  }
}
