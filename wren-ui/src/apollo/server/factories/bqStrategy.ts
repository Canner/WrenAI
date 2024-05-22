import { BigQueryOptions } from '@google-cloud/bigquery';
import { capitalize } from 'lodash';
import { IConnector } from '../connectors/connector';
import { Model, ModelColumn, Project } from '../repositories';
import {
  AnalysisRelationInfo,
  BigQueryDataSourceProperties,
  DataSourceName,
  IContext,
  RelationType,
} from '../types';
import {
  BQColumnResponse,
  BQConnector,
  BQListTableOptions,
} from '../connectors/bqConnector';
import { Encryptor, toBase64, getLogger } from '../utils';
import { IDataSourceStrategy } from './dataSourceStrategy';
import {
  findColumnsToUpdate,
  updateModelPrimaryKey,
  transformInvalidColumnName,
} from './util';

const logger = getLogger('BigQueryStrategy');
logger.level = 'debug';

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

  public async createDataSource(properties: BigQueryDataSourceProperties) {
    const { displayName, projectId, datasetId, credentials } = properties;
    const { config } = this.ctx;

    await this.testConnection({ projectId, datasetId, credentials });

    await this.patchConfigToWrenEngine({ projectId, credentials });

    // save DataSource to database
    const encryptor = new Encryptor(config);
    const encryptedCredentials = encryptor.encrypt(credentials);
    const project = await this.ctx.projectRepository.createOne({
      displayName,
      schema: 'public',
      catalog: 'wrenai',
      type: DataSourceName.BIG_QUERY,
      projectId,
      datasetId,
      credentials: encryptedCredentials,
    });
    return project;
  }

  public async updateDataSource(
    properties: BigQueryDataSourceProperties,
  ): Promise<any> {
    const { displayName, credentials: newCredentials } = properties;
    const { config } = this.ctx;
    const {
      projectId,
      datasetId,
      credentials: oldEncryptedCredentials,
    } = this.project;

    const encryptor = new Encryptor(config);
    const oldCredentials = JSON.parse(
      encryptor.decrypt(oldEncryptedCredentials),
    );

    const credentials = newCredentials || oldCredentials;

    await this.testConnection({ projectId, datasetId, credentials });

    await this.patchConfigToWrenEngine({ projectId, credentials });

    // update DataSource to database
    const encryptedCredentials = encryptor.encrypt(credentials);
    const project = await this.ctx.projectRepository.updateOne(
      this.project.id,
      {
        displayName,
        credentials: encryptedCredentials,
      },
    );
    return project;
  }

  public async listTable({ formatToCompactTable }) {
    const connector = await this.getBQConnector();
    const listTableOptions = {
      datasetId: this.project.datasetId,
      format: formatToCompactTable,
    } as BQListTableOptions;
    const tables = await connector.listTables(listTableOptions);
    return tables;
  }

  public async saveModels(tables: string[]) {
    const connector = await this.getBQConnector();
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
    const columns = await this.createAllColumns(
      tables,
      models,
      dataSourceColumns as BQColumnResponse[],
    );
    return { models, columns };
  }

  public async saveModel(
    table: string,
    columns: string[],
    primaryKey?: string,
  ) {
    const connector = await this.getBQConnector();
    const listTableOptions = {
      datasetId: this.project.datasetId,
      format: false,
    } as BQListTableOptions;
    const dataSourceColumns = (await connector.listTables(
      listTableOptions,
    )) as BQColumnResponse[];

    const models = await this.createModels(
      this.project,
      [table],
      dataSourceColumns,
    );
    const model = models[0];
    const modelColumns = await this.createColumns(
      columns,
      model,
      dataSourceColumns,
      primaryKey,
    );
    return { model, columns: modelColumns };
  }

  public async updateModel(
    model: Model,
    columns: string[],
    primaryKey: string,
  ) {
    // get current column in the database
    const existingColumns = await this.ctx.modelColumnRepository.findAllBy({
      modelId: model.id,
    });
    const connector = await this.getBQConnector();
    const listTableOptions = {
      datasetId: this.project.datasetId,
      format: false,
    } as BQListTableOptions;
    const dataSourceColumns = (await connector.listTables(
      listTableOptions,
    )) as BQColumnResponse[];

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

  public async analysisRelation(models, columns) {
    const connector = await this.getBQConnector();
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
          capitalize(fromModel.sourceTableName) +
          capitalize(toModel.sourceTableName),
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

  private async testConnection(args: {
    projectId: string;
    datasetId: string;
    credentials: JSON;
  }) {
    const { projectId, datasetId, credentials } = args;
    const { config } = this.ctx;

    // check DataSource is valid and can connect to it
    const filePath = this.ctx.projectService.writeCredentialFile(
      credentials,
      config.persistCredentialDir,
    );

    const connectionOption: BigQueryOptions = {
      projectId,
      keyFilename: filePath,
    };
    const connector = new BQConnector(connectionOption);
    await connector.prepare();

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

    return true;
  }

  private async patchConfigToWrenEngine(args: {
    projectId: string;
    credentials: JSON;
  }) {
    const { projectId, credentials } = args;

    // update wren-engine config
    const wrenEngineConfig = {
      'wren.datasource.type': 'bigquery',
      'bigquery.project-id': projectId,
      'bigquery.credentials-key': toBase64(JSON.stringify(credentials)),
    };
    await this.ctx.wrenEngineAdaptor.patchConfig(wrenEngineConfig);
  }

  private async getBQConnector() {
    const filePath = await this.ctx.projectService.getCredentialFilePath(
      this.project,
    );
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
    columns: string[],
    model: Model,
    dataSourceColumns: BQColumnResponse[],
    primaryKey?: string,
  ) {
    const columnValues = columns.reduce((acc, columnName) => {
      const tableColumn = dataSourceColumns.find(
        (col) => col.column_name === columnName,
      );
      if (!tableColumn) {
        throw new Error(`Column not found: ${columnName}`);
      }
      const properties = tableColumn.column_description
        ? JSON.stringify({
            description: tableColumn.column_description,
          })
        : null;
      const columnValue = {
        modelId: model.id,
        isCalculated: false,
        displayName: columnName,
        sourceColumnName: columnName,
        referenceName: transformInvalidColumnName(columnName),
        type: tableColumn?.data_type || 'string',
        notNull: tableColumn.is_nullable.toLocaleLowerCase() !== 'yes',
        isPk: primaryKey === columnName,
        properties,
      } as Partial<ModelColumn>;
      acc.push(columnValue);
      return acc;
    }, []);
    const modelColumns =
      await this.ctx.modelColumnRepository.createMany(columnValues);
    return modelColumns;
  }

  private async createAllColumns(
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
          referenceName: transformInvalidColumnName(columnName),
          type: tableColumn?.data_type || 'string',
          notNull: tableColumn.is_nullable.toLocaleLowerCase() !== 'yes',
          isPk: false,
          properties,
        } as Partial<ModelColumn>;
        acc.push(columnValue);
      }
      return acc;
    }, []);
    const batch = 100;
    const columns = [];
    for (let i = 0; i < columnValues.length; i += batch) {
      logger.debug(`Creating columns: ${i} - ${i + batch}`);
      const res = await this.ctx.modelColumnRepository.createMany(
        columnValues.slice(i, i + batch),
      );
      columns.push(...res);
    }

    return columns;
  }
}
