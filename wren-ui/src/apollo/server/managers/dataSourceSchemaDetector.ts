import { camelCase, differenceWith, isEmpty, isEqual } from 'lodash';
import { CompactTable } from '@server/connectors/connector';
import { DataSourceStrategyFactory } from '@server/factories/onboardingFactory';
import { IContext } from '@server/types';
import { getLogger } from 'log4js';

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
  detectSchemaChange(): Promise<void>;
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
      this.addSchemaChange(diffSchema);
    }
  }

  public async resolveSchemaChange(type: string) {
    const schemaChangeType = camelCase(type) as SchemaChangeType;
    const supportedTypes = [
      SchemaChangeType.DELETED_TABLES,
      SchemaChangeType.DELETED_COLUMNS,
    ];
    if (supportedTypes.includes(schemaChangeType)) {
      const lastSchemaChange =
        await this.ctx.schemaChangeRepository.findLastSchemaChange(
          this.projectId,
        );
      const changes = lastSchemaChange?.change[schemaChangeType];
      const isResolved = lastSchemaChange?.resolve[schemaChangeType];

      if (isResolved !== false) {
        throw new Error(
          `Schema change "${schemaChangeType}" has nothing to resolve.`,
        );
      }

      // Handle resolve deleted tables
      if (schemaChangeType === SchemaChangeType.DELETED_TABLES) {
        const affectedTableNames = changes.map((table) => table.name);
        logger.debug(
          `Start to remove tables "${affectedTableNames}" from models.`,
        );
        await this.ctx.modelRepository.deleteAllBySourceTableNames(
          affectedTableNames,
        );
        await updateResolveToSchemaChange(this.ctx);
      }

      // Handle resolve deleted table columns
      if (schemaChangeType === SchemaChangeType.DELETED_COLUMNS) {
        const models = await this.ctx.modelRepository.findAllBy({
          projectId: this.projectId,
        });
        const affectedModels = models.filter(
          (model) =>
            changes.findIndex(
              (table) => table.name === model.sourceTableName,
            ) !== -1,
        );
        await Promise.all(
          affectedModels.map(async (model) => {
            const affectedColumnNames = changes
              .find((table) => table.name === model.sourceTableName)
              .columns.map((column) => column.name);
            logger.debug(
              `Start to remove columns "${affectedColumnNames}" from model "${model.referenceName}".`,
            );
            return await this.ctx.modelColumnRepository.deleteAllBySourceColumnNames(
              model.id,
              affectedColumnNames,
            );
          }),
        );
        await updateResolveToSchemaChange(this.ctx);
      }

      async function updateResolveToSchemaChange(ctx: IContext) {
        await ctx.schemaChangeRepository.updateOne(lastSchemaChange.id, {
          ...lastSchemaChange,
          resolve: {
            ...lastSchemaChange.resolve,
            [schemaChangeType]: true,
          },
        });
        logger.info(
          `Schema change "${schemaChangeType}" resolved successfully.`,
        );
      }
    } else {
      throw new Error('Resolved scheme change type is not supported.');
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
        for (const currentColumn of diffColumns) {
          const latestColumn = lastestTable.columns.find(
            (column) => column.name === currentColumn.name,
          );
          // If the column is not found in the latest schema, it means the column has been deleted.
          if (!latestColumn) {
            result[SchemaChangeType.DELETED_COLUMNS] = [
              ...(result[SchemaChangeType.DELETED_COLUMNS] || []),
              { name: currentTable.name, columns: [currentColumn] },
            ];
            continue;
          }

          // If the column is found in the latest schema, it means the column has been modified.
          result[SchemaChangeType.MODIFIED_COLUMNS] = [
            ...(result[SchemaChangeType.MODIFIED_COLUMNS] || []),
            {
              name: currentTable.name,
              // show the latest column type
              columns: [latestColumn],
            },
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
    const getResolveState = (change) => (!!change ? false : null);

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
    const dataSourceType = project.type;
    const strategy = DataSourceStrategyFactory.create(dataSourceType, {
      ctx: this.ctx,
      project,
    });
    const latestDataSourceTables = (await strategy.listTable({
      formatToCompactTable: true,
    })) as CompactTable[];
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
}
