import { differenceWith, isEmpty, isEqual } from 'lodash';
import { CompactTable } from '@server/connectors/connector';
import { DataSourceStrategyFactory } from '@server/factories/onboardingFactory';
import { IContext } from '@server/types';
import { getLogger } from 'log4js';

const logger = getLogger('DataSourceSchemaDetector');
logger.level = 'debug';

type DataSourceSchema = {
  name: string;
  columns: {
    name: string;
    type: string;
  }[];
};

type DataSourceSchemaChange = {
  [SchemaChangeType.DELETED_TABLES]: DataSourceSchema[];
  [SchemaChangeType.DELETED_COLUMNS]: DataSourceSchema[];
  [SchemaChangeType.MODIFIED_COLUMNS]: DataSourceSchema[];
};

enum SchemaChangeType {
  // the tables has been deleted
  DELETED_TABLES = 'deletedTables',
  // the columns has been deleted
  DELETED_COLUMNS = 'deletedColumns',
  // the columns type has been changed
  MODIFIED_COLUMNS = 'modifiedColumns',
}

interface IDataSourceSchemaDetector {
  detectSchemaChange(): Promise<void>;
}

export default class DataSourceSchemaDetector
  implements IDataSourceSchemaDetector
{
  public ctx: IContext;
  public projectId: string;

  constructor({ ctx }: { ctx: IContext }) {
    this.ctx = ctx;
  }

  public async detectSchemaChange() {
    const diffSchema = await this.getDiffSchema();
    if (diffSchema) {
      this.addSchemaChange(diffSchema);
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
    const project = await this.ctx.projectService.getCurrentProject();

    const getResolveState = (change) => (!!change ? false : null);

    const schemaChange = JSON.stringify(diffSchema);
    const lastSchemaChange =
      await this.ctx.schemaChangeRepository.findLastSchemaChange(project.id);
    // If the schema change is the same as the last one, we don't need to create a new one.
    const isNewSchemaChange = lastSchemaChange?.change !== schemaChange;

    if (isNewSchemaChange) {
      this.ctx.schemaChangeRepository.createOne({
        projectId: project.id,
        change: schemaChange,
        // Set the resolve to false if there are any changes. It will set resolve to true once the schema has been synced.
        resolve: JSON.stringify({
          [SchemaChangeType.DELETED_TABLES]: getResolveState(
            diffSchema[SchemaChangeType.DELETED_TABLES],
          ),
          [SchemaChangeType.DELETED_COLUMNS]: getResolveState(
            diffSchema[SchemaChangeType.DELETED_COLUMNS],
          ),
          [SchemaChangeType.MODIFIED_COLUMNS]: getResolveState(
            diffSchema[SchemaChangeType.MODIFIED_COLUMNS],
          ),
        }),
      });
    }
  }

  private async getCurrentSchema(): Promise<DataSourceSchema[]> {
    const project = await this.ctx.projectService.getCurrentProject();
    const models = await this.ctx.modelRepository.findAllBy({
      projectId: project.id,
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
    const project = await this.ctx.projectService.getCurrentProject();
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
