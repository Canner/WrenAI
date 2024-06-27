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

export interface IDataSourceSchemaDetector {
  detectSchemaChange(): Promise<boolean>;
  resolveSchemaChange(type: string): Promise<void>;
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

    const affectedModels = models.filter(
      (model) =>
        changes.findIndex((table) => table.name === model.sourceTableName) !==
        -1,
    );
    const allCalculatedFields =
      await this.ctx.modelColumnRepository.findAllCalculatedFields();

    const modelIds = affectedModels.map((model) => model.id);
    const modelColumns =
      await this.ctx.modelColumnRepository.findColumnsByModelIds(modelIds);

    const modelRelationships =
      await this.ctx.relationRepository.findRelationInfoBy({
        columnIds: modelColumns.map((column) => column.id),
      });

    // Handle resolve deleted tables
    if (schemaChangeType === SchemaChangeType.DELETED_TABLES) {
      await Promise.all(
        affectedModels.map(async (model) => {
          // Get all columns of the model including calculated fields
          const selfModelColumnsWithCalculatedFields = modelColumns.filter(
            (column) => column.modelId === model.id,
          );

          // Get only columns of the model without calculated fields
          const selfModelColumns = selfModelColumnsWithCalculatedFields.filter(
            (column) => !column.isCalculated,
          );

          // Get affected calculated fields and affected relationships
          const affectedMaterials = await this.getAffectedResources(
            model,
            selfModelColumns,
            {
              models,
              allCalculatedFields,
              modelRelationships,
            },
          );

          // delete columns and calculated fields
          const affectedColumns = uniqBy(
            [
              ...selfModelColumnsWithCalculatedFields,
              ...affectedMaterials.calculatedFields,
            ],
            'id',
          );

          logger.debug(
            `Start to remove columns and calculated fields. ${affectedColumns.map(
              (column) => `${column.displayName} (${column.referenceName})`,
            )}.`,
          );

          const columnIds = affectedColumns.map((column) => column.id);
          await this.ctx.modelColumnRepository.deleteAllByColumnIds(columnIds);

          // delete relationships
          logger.debug(
            `Start to remove relationships "${affectedMaterials.relationships.map(
              (relationship) =>
                `${relationship.displayName} (${relationship.referenceName})`,
            )}" from model "${model.referenceName}".`,
          );

          const relationshipIds = affectedMaterials.relationships.map(
            (relationship) => relationship.id,
          );
          return await this.ctx.relationRepository.deleteAllByRelationshipIds(
            relationshipIds,
          );
        }),
      );

      // delete models
      const affectedTableNames = changes.map((table) => table.name);
      logger.debug(
        `Start to remove tables "${affectedTableNames}" from models.`,
      );
      await this.ctx.modelRepository.deleteAllBySourceTableNames(
        affectedTableNames,
      );
      await this.updateResolveToSchemaChange(lastSchemaChange, [
        schemaChangeType,
      ]);
    }

    // Handle resolve deleted table columns
    if (schemaChangeType === SchemaChangeType.DELETED_COLUMNS) {
      await Promise.all(
        affectedModels.map(async (model) => {
          const affectedColumns = changes.find(
            (table) => table.name === model.sourceTableName,
          ).columns;

          const columns: ModelColumn[] = affectedColumns.reduce(
            (result, column) => {
              const affectedColumn = modelColumns.find(
                (modelColumn) =>
                  modelColumn.sourceColumnName === column.name &&
                  modelColumn.modelId === model.id,
              );
              if (affectedColumn) {
                result.push(affectedColumn);
              }
              return result;
            },
            [],
          );

          const affectedMaterials = await this.getAffectedResources(
            model,
            columns,
            {
              models,
              allCalculatedFields,
              modelRelationships,
            },
          );

          // delete calculated fields
          const affectedCalculatedFields = uniqBy(
            affectedMaterials.calculatedFields,
            'id',
          );

          logger.debug(
            `Start to remove all affected calculated fields "${affectedCalculatedFields.map(
              (column) => `${column.displayName} (${column.referenceName})`,
            )}".`,
          );

          const columnIds = affectedCalculatedFields.map((column) => column.id);
          await this.ctx.modelColumnRepository.deleteAllByColumnIds(columnIds);

          // delete relationships
          logger.debug(
            `Start to remove relationships "${affectedMaterials.relationships.map(
              (relationship) =>
                `${relationship.displayName} (${relationship.referenceName})`,
            )}" from model "${model.referenceName}".`,
          );

          const relationshipIds = affectedMaterials.relationships.map(
            (relationship) => relationship.id,
          );

          await this.ctx.relationRepository.deleteAllByRelationshipIds(
            relationshipIds,
          );

          // delete columns
          const affectedColumnNames = affectedColumns.map(
            (column) => column.name,
          );

          logger.debug(
            `Start to remove columns "${affectedColumnNames}" from model "${model.referenceName}".`,
          );

          return await this.ctx.modelColumnRepository.deleteAllBySourceColumnNames(
            model.id,
            affectedColumnNames,
          );
        }),
      );
      await this.updateResolveToSchemaChange(lastSchemaChange, [
        schemaChangeType,
      ]);
    }
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

  private async getAffectedResources(
    model: Model,
    columns: ModelColumn[],
    {
      models,
      allCalculatedFields,
      modelRelationships,
    }: {
      models: Model[];
      allCalculatedFields: ModelColumn[];
      modelRelationships: RelationInfo[];
    },
  ): Promise<{
    relationships: Array<{
      id: number;
      displayName: string;
      referenceName: string;
    }>;
    calculatedFields: ModelColumn[];
  }> {
    return columns.reduce(
      (result, column) => {
        // collect affected calculated fields if it's target column
        const affectedCalculatedFieldsByColumnId = allCalculatedFields.filter(
          (calculatedField) => {
            const lineage = JSON.parse(calculatedField.lineage);
            return lineage && lineage[lineage.length - 1] === column.id;
          },
        );

        result.calculatedFields.push(...affectedCalculatedFieldsByColumnId);

        // collect affected relationships
        const affectedRelationships = modelRelationships
          .map((relationship) =>
            [relationship.fromColumnId, relationship.toColumnId].includes(
              column.id,
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
              return lineage && lineage[lineage.length - 1] === relationship.id;
            });

          result.calculatedFields.push(
            ...affectedCalculatedFieldsByRelationshipId,
          );
        });

        return result;
      },
      {
        relationships: [],
        calculatedFields: [],
      },
    );
  }
}
