import { BigQueryOptions } from '@google-cloud/bigquery';
import { IConnector, CompactTable } from '../connectors/connector';
import { Model, ModelColumn, Project } from '../repositories';
import {
  AnalysisRelationInfo,
  DataSourceName,
  IContext,
  RelationType,
} from '../types';
import {
  BQColumnResponse,
  BQConnector,
  BQListTableOptions,
} from '../connectors/bqConnector';
import { Encryptor, toBase64 } from '../utils';
import {
  DuckDBConnector,
  DuckDBListTableOptions,
  DuckDBPrepareOptions,
} from '../connectors/duckdbConnector';

export interface IDataSourceStrategy {
  saveDataSource(properties: any): Promise<any>;
  listTable({
    formatToCompactTable,
  }: {
    formatToCompactTable: boolean;
  }): Promise<CompactTable[] | any[]>;
  saveModels(models: any): Promise<any>;
  analysisRelation(
    models: Model[],
    columns: ModelColumn[],
  ): Promise<AnalysisRelationInfo[]>;
}

export class BigQueryStrategy implements IDataSourceStrategy {
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
    const { displayName, projectId, datasetId, credentials } = properties;
    const { config } = this.ctx;
    let filePath = '';
    // check DataSource is valid and can connect to it
    filePath = this.ctx.projectService.writeCredentialFile(
      credentials,
      config.persistCredentialDir,
    );
    const connectionOption: BigQueryOptions = {
      projectId,
      keyFilename: filePath,
    };
    const connector = new BQConnector(connectionOption);
    await connector.prepare();

    // update wren-engine config
    const wrenEngineConfig = {
      'wren.datasource.type': 'bigquery',
      'bigquery.project-id': projectId,
      'bigquery.credentials-key': toBase64(JSON.stringify(credentials)),
    };
    await this.ctx.wrenEngineAdaptor.patchConfig(wrenEngineConfig);

    // check can connect to bigquery
    const connected = await connector.connect();
    if (!connected) {
      throw new Error('Can not connect to data source');
    }
    // check this credential have permission can list dataset table
    try {
      await connector.listTables({ datasetId });
    } catch (_e) {
      throw new Error('Can not list tables in dataset');
    }
    // save DataSource to database
    const encryptor = new Encryptor(config);
    const encryptedCredentials = encryptor.encrypt(credentials);

    // TODO: add displayName, schema, catalog to the DataSource, depends on the MDL structure
    const project = await this.ctx.projectRepository.createOne({
      displayName,
      schema: 'tbd',
      catalog: 'tbd',
      type: DataSourceName.BIG_QUERY,
      projectId,
      datasetId,
      credentials: encryptedCredentials,
    });
    return project;
  }

  public async listTable({ formatToCompactTable }) {
    const filePath = await this.ctx.projectService.getCredentialFilePath(
      this.project,
    );
    const connector = await this.getBQConnector(filePath);
    const listTableOptions = {
      datasetId: this.project.datasetId,
      format: formatToCompactTable,
    } as BQListTableOptions;
    const tables = await connector.listTables(listTableOptions);
    return tables;
  }

  public async saveModels(tables: string[]) {
    const filePath = await this.ctx.projectService.getCredentialFilePath(
      this.project,
    );
    const connector = await this.getBQConnector(filePath);
    const listTableOptions = {
      datasetId: this.project.datasetId,
      format: false,
    } as BQListTableOptions;
    const dataSourceColumns = (await connector.listTables(
      listTableOptions,
    )) as BQColumnResponse[];

    const models = await this.createModels(
      this.project,
      tables,
      dataSourceColumns,
    );
    // create columns
    const columns = await this.createColumns(
      tables,
      models,
      dataSourceColumns as BQColumnResponse[],
    );
    return { models, columns };
  }

  public async analysisRelation(models, columns) {
    const filePath = await this.ctx.projectService.getCredentialFilePath(
      this.project,
    );
    const connector = await this.getBQConnector(filePath);
    const listConstraintOptions = {
      datasetId: this.project.datasetId,
    };
    const constraints = await connector.listConstraints(listConstraintOptions);
    const relations = [];
    for (const constraint of constraints) {
      const {
        constraintTable,
        constraintColumn,
        constraintedTable,
        constraintedColumn,
      } = constraint;
      // validate tables and columns exists in our models and model columns
      const fromModel = models.find(
        (m) => m.sourceTableName === constraintTable,
      );
      const toModel = models.find(
        (m) => m.sourceTableName === constraintedTable,
      );
      if (!fromModel || !toModel) {
        continue;
      }
      const fromColumn = columns.find(
        (c) =>
          c.modelId === fromModel.id && c.sourceColumnName === constraintColumn,
      );
      const toColumn = columns.find(
        (c) =>
          c.modelId === toModel.id && c.sourceColumnName === constraintedColumn,
      );
      if (!fromColumn || !toColumn) {
        continue;
      }
      // create relation
      const relation: AnalysisRelationInfo = {
        // upper case the first letter of the sourceTableName
        name:
          fromModel.sourceTableName.charAt(0).toUpperCase() +
          fromModel.sourceTableName.slice(1) +
          toModel.sourceTableName.charAt(0).toUpperCase() +
          toModel.sourceTableName.slice(1),
        fromModelId: fromModel.id,
        fromModelReferenceName: fromModel.referenceName,
        fromColumnId: fromColumn.id,
        fromColumnReferenceName: fromColumn.referenceName,
        toModelId: toModel.id,
        toModelReferenceName: toModel.referenceName,
        toColumnId: toColumn.id,
        toColumnReferenceName: toColumn.referenceName,
        // TODO: add join type
        type: RelationType.ONE_TO_MANY,
      };
      relations.push(relation);
    }
    return relations;
  }

  private async getBQConnector(filePath: string) {
    // fetch tables
    const { projectId } = this.project;
    const connectionOption: BigQueryOptions = {
      projectId,
      keyFilename: filePath,
    };
    return new BQConnector(connectionOption);
  }
  private async createModels(
    project: Project,
    tables: string[],
    dataSourceColumns: BQColumnResponse[],
  ) {
    const projectId = this.project.id;
    const tableDescriptionMap = dataSourceColumns
      .filter((col) => col.table_description)
      .reduce((acc, column) => {
        acc[column.table_name] = column.table_description;
        return acc;
      }, {});
    const modelValues = tables.map((tableName) => {
      const description = tableDescriptionMap[tableName];
      const properties = description ? JSON.stringify({ description }) : null;
      const model = {
        projectId,
        displayName: tableName, //use table name as displayName, referenceName and tableName
        referenceName: tableName,
        sourceTableName: tableName,
        refSql: `select * from "${project.datasetId}".${tableName}`,
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
    dataSourceColumns: BQColumnResponse[],
  ) {
    const columnValues = tables.reduce((acc, tableName) => {
      const modelId = models.find((m) => m.sourceTableName === tableName)?.id;
      if (!modelId) {
        throw new Error('Model not found');
      }
      const tableColumns = dataSourceColumns.filter(
        (col) => col.table_name === tableName,
      );
      for (const tableColumn of tableColumns) {
        const columnName = tableColumn.column_name;
        const properties = tableColumn.column_description
          ? JSON.stringify({
              description: tableColumn.column_description,
            })
          : null;
        const columnValue = {
          modelId,
          isCalculated: false,
          displayName: columnName,
          sourceColumnName: columnName,
          referenceName: columnName,
          type: tableColumn?.data_type || 'string',
          notNull: tableColumn.is_nullable.toLocaleLowerCase() !== 'yes',
          isPk: false,
          properties,
        } as Partial<ModelColumn>;
        acc.push(columnValue);
      }
      return acc;
    }, []);
    const columns = await Promise.all(
      columnValues.map(
        async (column) =>
          await this.ctx.modelColumnRepository.createOne(column),
      ),
    );
    return columns;
  }
}

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
      schema: 'tbd',
      catalog: 'tbd',
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

export class DataSourceStrategyFactory {
  static create(dataSourceType: string, options: any): IDataSourceStrategy {
    switch (dataSourceType) {
      case DataSourceName.BIG_QUERY:
        return new BigQueryStrategy(options);
      case DataSourceName.DUCKDB:
        return new DuckDBStrategy(options);
      default:
        throw new Error(`Unsupported data source type: ${dataSourceType}`);
    }
  }
}
