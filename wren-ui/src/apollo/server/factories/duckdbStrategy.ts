import { IConnector, CompactTable } from '../connectors/connector';
import {
  DUCKDB_CONNECTION_INFO,
  Model,
  ModelColumn,
  Project,
} from '../repositories';
import { DataSourceName, DuckDBDataSourceProperties, IContext } from '../types';
import {
  DuckDBConnector,
  DuckDBListTableOptions,
  DuckDBPrepareOptions,
} from '../connectors/duckdbConnector';
import { trim } from '../utils';
import { IDataSourceStrategy } from './dataSourceStrategy';
import {
  findColumnsToUpdate,
  updateModelPrimaryKey,
  transformInvalidColumnName,
} from './util';
import { getLogger } from '@server/utils';

const logger = getLogger('DuckDBStrategy');
logger.level = 'debug';

export class DuckDBStrategy implements IDataSourceStrategy {
  connector: IConnector<any, any>;
  project: Project;
  ctx: IContext;

  constructor({ ctx, project }: { ctx: IContext; project?: Project }) {
    if (project) {
      this.project = project;
    }
    this.ctx = ctx;
  }

  public async createDataSource(properties: DuckDBDataSourceProperties) {
    const { displayName, initSql, extensions, configurations } = properties;
    const initSqlWithExtensions = this.concatInitSql(initSql, extensions);

    await this.testConnection({
      initSql: initSqlWithExtensions,
      configurations,
    });

    await this.patchConfigToWrenEngine();
    const connectionInfo = {
      initSql: trim(initSql),
      extensions,
      configurations,
    } as DUCKDB_CONNECTION_INFO;

    // save DataSource to database
    const project = await this.ctx.projectRepository.createOne({
      displayName,
      schema: 'public',
      catalog: 'wrenai',
      type: DataSourceName.DUCKDB,
      connectionInfo,
    });
    return project;
  }

  public async updateDataSource(
    properties: DuckDBDataSourceProperties,
  ): Promise<any> {
    const { displayName, initSql, extensions, configurations } = properties;
    const initSqlWithExtensions = this.concatInitSql(initSql, extensions);

    await this.testConnection({
      initSql: initSqlWithExtensions,
      configurations,
    });

    await this.patchConfigToWrenEngine();

    const connectionInfo = {
      initSql: trim(initSql),
      extensions,
      configurations,
    } as DUCKDB_CONNECTION_INFO;
    const project = await this.ctx.projectRepository.updateOne(
      this.project.id,
      {
        displayName,
        connectionInfo,
      },
    );
    return project;
  }

  public async listTable({ formatToCompactTable }) {
    const connector = new DuckDBConnector({
      wrenEngineAdaptor: this.ctx.wrenEngineAdaptor,
    });
    const listTableOptions = {
      format: formatToCompactTable,
    } as DuckDBListTableOptions;
    const tables = (await connector.listTables(
      listTableOptions,
    )) as CompactTable[];
    return tables;
  }

  public async saveModels(tables: string[]) {
    const connector = new DuckDBConnector({
      wrenEngineAdaptor: this.ctx.wrenEngineAdaptor,
    });
    const listTableOptions = { format: true } as DuckDBListTableOptions;
    const dataSourceColumns = (await connector.listTables(
      listTableOptions,
    )) as CompactTable[];
    const models = await this.createModels(
      tables,
      dataSourceColumns as CompactTable[],
    );
    // create columns
    const columns = await this.createAllColumns(
      tables,
      models,
      dataSourceColumns as CompactTable[],
    );
    return { models, columns };
  }

  public async saveModel(
    table: string,
    columns: string[],
    primaryKey?: string,
  ) {
    const connector = new DuckDBConnector({
      wrenEngineAdaptor: this.ctx.wrenEngineAdaptor,
    });
    const listTableOptions = { format: true } as DuckDBListTableOptions;
    const dataSourceColumns = (await connector.listTables(
      listTableOptions,
    )) as CompactTable[];
    const model = await this.createModels(
      [table],
      dataSourceColumns as CompactTable[],
    );
    const modelColumns = await this.createColumns(
      columns,
      model[0],
      dataSourceColumns,
      primaryKey,
    );
    return { model, columns: modelColumns };
  }

  public async updateModel(
    model: Model,
    columns: string[],
    primaryKey?: string,
  ) {
    const connector = new DuckDBConnector({
      wrenEngineAdaptor: this.ctx.wrenEngineAdaptor,
    });
    const listTableOptions = { format: true } as DuckDBListTableOptions;
    const dataSourceColumns = (await connector.listTables(
      listTableOptions,
    )) as CompactTable[];
    const existingColumns = await this.ctx.modelColumnRepository.findAllBy({
      modelId: model.id,
    });
    const { toDeleteColumnIds, toCreateColumns } = findColumnsToUpdate(
      columns,
      existingColumns,
    );
    await updateModelPrimaryKey(
      this.ctx.modelColumnRepository,
      model.id,
      primaryKey,
    );
    if (toCreateColumns.length) {
      await this.createColumns(
        toCreateColumns,
        model,
        dataSourceColumns,
        primaryKey,
      );
    }
    if (toDeleteColumnIds.length) {
      await this.ctx.modelColumnRepository.deleteMany(toDeleteColumnIds);
    }
  }

  public async analysisRelation(_models, _columns) {
    return [];
  }

  private async testConnection(args: {
    configurations: Record<string, any>;
    initSql: string;
  }) {
    const { initSql, configurations } = args;

    const connector = new DuckDBConnector({
      wrenEngineAdaptor: this.ctx.wrenEngineAdaptor,
    });

    // prepare duckdb environment in wren-engine
    const prepareOption = {
      sessionProps: configurations,
      initSql,
    } as DuckDBPrepareOptions;
    await connector.prepare(prepareOption);

    // check DataSource is valid and can connect to it
    const connected = await connector.connect();
    if (!connected) {
      throw new Error('Can not connect to data source');
    }
    // check can list dataset table
    try {
      await connector.listTables({ format: false });
    } catch (_e) {
      throw new Error('Can not list tables in dataset');
    }
  }

  private async patchConfigToWrenEngine() {
    // update wren-engine config
    const config = {
      'wren.datasource.type': 'duckdb',
    };
    await this.ctx.wrenEngineAdaptor.patchConfig(config);
  }

  private concatInitSql(initSql: string, extensions: string[]) {
    const installExtensions = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');
    return trim(`${installExtensions}\n${initSql}`);
  }

  private async createModels(tables: string[], compactTables: CompactTable[]) {
    const projectId = this.project.id;

    const modelValues = tables.map((tableName) => {
      const compactTable = compactTables.find(
        (table) => table.name === tableName,
      );

      // compactTable contain schema and catalog, these information are for building tableReference in mdl
      const properties = { ...compactTable.properties, table: tableName };
      const model = {
        projectId,
        displayName: tableName, //use table name as displayName, referenceName and tableName
        referenceName: tableName,
        sourceTableName: tableName,
        refSql: `select * from ${compactTable.properties.schema}.${tableName}`,
        cached: false,
        refreshTime: null,
        properties: properties ? JSON.stringify(properties) : null,
      } as Partial<Model>;
      return model;
    });

    const models = await this.ctx.modelRepository.createMany(modelValues);
    return models;
  }

  private async createColumns(
    columns: string[],
    model: Model,
    compactTables: CompactTable[],
    primaryKey?: string,
  ) {
    const columnValues = columns.reduce((acc, columnName) => {
      const compactColumns = compactTables.find(
        (table) => table.name === model.sourceTableName,
      )?.columns;
      if (!compactColumns) {
        throw new Error('Table not found');
      }
      const compactColumn = compactColumns.find(
        (column) => column.name === columnName,
      );
      if (!compactColumn) {
        throw new Error('Column not found');
      }
      const columnValue = {
        modelId: model.id,
        isCalculated: false,
        displayName: columnName,
        sourceColumnName: columnName,
        referenceName: transformInvalidColumnName(columnName),
        type: compactColumn.type || 'string',
        notNull: compactColumn.notNull,
        isPk: primaryKey === columnName,
        properties: JSON.stringify(compactColumn.properties),
      } as Partial<ModelColumn>;
      acc.push(columnValue);
      return acc;
    }, []);
    const res = await this.ctx.modelColumnRepository.createMany(columnValues);
    return res;
  }

  private async createAllColumns(
    tables: string[],
    models: Model[],
    compactTables: CompactTable[],
  ) {
    const columnValues = tables.reduce((acc, tableName) => {
      const modelId = models.find((m) => m.sourceTableName === tableName)?.id;
      if (!modelId) {
        throw new Error(`Model not found: ${tableName}`);
      }
      const compactColumns = compactTables.find(
        (table) => table.name === tableName,
      )?.columns;
      if (!compactColumns) {
        throw new Error('Table not found');
      }
      for (const compactColumn of compactColumns) {
        const columnName = compactColumn.name;
        const columnValue = {
          modelId,
          isCalculated: false,
          displayName: columnName,
          sourceColumnName: columnName,
          referenceName: transformInvalidColumnName(columnName),
          type: compactColumn.type || 'string',
          notNull: compactColumn.notNull,
          isPk: false,
          properties: JSON.stringify(compactColumn.properties),
        } as Partial<ModelColumn>;
        acc.push(columnValue);
      }
      return acc;
    }, []);
    let columns = [];
    const batch = 100;
    for (let i = 0; i < columnValues.length; i += batch) {
      logger.debug(`Creating columns: ${i} - ${i + batch}`);
      const columnValueChunk = columnValues.slice(i, i + batch);
      const columnChunk =
        await this.ctx.modelColumnRepository.createMany(columnValueChunk);
      columns = columns.concat(columnChunk);
    }
    return columns;
  }
}
