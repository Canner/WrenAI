import { IConnector, CompactTable } from '../connectors/connector';
import { Model, ModelColumn, Project } from '../repositories';
import { DataSourceName, IContext } from '../types';
import {
  DuckDBConnector,
  DuckDBListTableOptions,
  DuckDBPrepareOptions,
} from '../connectors/duckdbConnector';
import { IDataSourceStrategy } from './dataSourceStrategy';

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

  public async saveDataSource(properties: any) {
    const { displayName, extensions, configurations } = properties;
    const initSql = this.concatInitSql(properties.initSql, extensions);
    const connector = new DuckDBConnector({
      wrenEngineAdaptor: this.ctx.wrenEngineAdaptor,
    });

    // prepare duckdb environment in wren-engine
    const prepareOption = {
      sessionProps: configurations,
      initSql,
    } as DuckDBPrepareOptions;
    await connector.prepare(prepareOption);

    // update wren-engine config
    const config = {
      'wren.datasource.type': 'duckdb',
    };
    await this.ctx.wrenEngineAdaptor.patchConfig(config);

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

    // save DataSource to database
    const project = await this.ctx.projectRepository.createOne({
      displayName,
      schema: 'public',
      catalog: 'wrenai',
      type: DataSourceName.DUCKDB,
      initSql,
      configurations,
      extensions,
    });
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
    const columns = await this.createColumns(
      tables,
      models,
      dataSourceColumns as CompactTable[],
    );
    return { models, columns };
  }

  public async analysisRelation(_models, _columns) {
    return [];
  }

  private concatInitSql(initSql: string, extensions: string[]) {
    const installExtensions = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');
    return `${installExtensions}\n${initSql}`;
  }

  private async createModels(tables: string[], compactTables: CompactTable[]) {
    const projectId = this.project.id;

    const modelValues = tables.map((tableName) => {
      const compactTable = compactTables.find(
        (table) => table.name === tableName,
      );
      const properties = compactTable.properties
        ? JSON.stringify(compactTable.properties)
        : null;
      const model = {
        projectId,
        displayName: tableName, //use table name as displayName, referenceName and tableName
        referenceName: tableName,
        sourceTableName: tableName,
        refSql: `select * from ${compactTable.properties.schema}.${tableName}`,
        cached: false,
        refreshTime: null,
        properties,
      } as Partial<Model>;
      return model;
    });

    const models = await this.ctx.modelRepository.createMany(modelValues);
    return models;
  }

  private async createColumns(
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
          referenceName: columnName,
          type: compactColumn.type || 'string',
          notNull: compactColumn.notNull,
          isPk: false,
          properties: JSON.stringify(compactColumn.properties),
        } as Partial<ModelColumn>;
        acc.push(columnValue);
      }
      return acc;
    }, []);
    const columns =
      await this.ctx.modelColumnRepository.createMany(columnValues);
    return columns;
  }
}
