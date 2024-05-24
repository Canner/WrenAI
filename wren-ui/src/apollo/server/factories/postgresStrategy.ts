import { capitalize } from 'lodash';
import { IDataSourceStrategy } from './dataSourceStrategy';
import {
  AnalysisRelationInfo,
  DataSourceName,
  IContext,
  RelationType,
  PGDataSourceProperties,
} from '../types';
import { Model, ModelColumn, Project } from '../repositories';
import {
  PostgresColumnResponse,
  PostgresConnector,
} from '../connectors/postgresConnector';
import { Encryptor, getLogger } from '../utils';
import {
  findColumnsToUpdate,
  updateModelPrimaryKey,
  transformInvalidColumnName,
} from './util';

const logger = getLogger('PostgresStrategy');
logger.level = 'debug';

export class PostgresStrategy implements IDataSourceStrategy {
  private project?: Project;
  private ctx: IContext;

  constructor({ ctx, project }: { ctx: IContext; project?: Project }) {
    this.project = project;
    this.ctx = ctx;
  }

  public async createDataSource(properties: PGDataSourceProperties) {
    const { displayName, host, port, database, user, password, ssl } =
      properties;

    await this.testConnection(properties);

    await this.patchConfigToWrenEngine(properties);

    // save DataSource to database
    const credentials = { password } as any;
    const encryptor = new Encryptor(this.ctx.config);
    const encryptedCredentials = encryptor.encrypt(credentials);

    const project = await this.ctx.projectRepository.createOne({
      displayName,
      schema: 'public',
      catalog: 'wrenai',
      type: DataSourceName.POSTGRES,
      host,
      port,
      database,
      user,
      credentials: encryptedCredentials,
      configurations: { ssl },
    });
    return project;
  }

  public async updateDataSource(
    properties: PGDataSourceProperties,
  ): Promise<any> {
    const { displayName, user, password: newPassword, ssl } = properties;
    const {
      host,
      port,
      database,
      credentials: oldEncryptedCredentials,
    } = this.project;

    const encryptor = new Encryptor(this.ctx.config);
    const { password: oldPassword } = JSON.parse(
      encryptor.decrypt(oldEncryptedCredentials),
    );
    const password = newPassword || oldPassword;

    const newProperties = {
      host,
      port,
      database,
      user,
      password,
      ssl,
    };

    await this.testConnection(newProperties);

    await this.patchConfigToWrenEngine(newProperties);

    const credentials = { password } as any;
    const encryptedCredentials = encryptor.encrypt(credentials);
    const project = await this.ctx.projectRepository.updateOne(
      this.project.id,
      {
        displayName,
        user,
        credentials: encryptedCredentials,
      },
    );
    return project;
  }

  public async listTable({
    formatToCompactTable,
  }: {
    formatToCompactTable: boolean;
  }) {
    const connector = this.getPGConnector();

    // list tables
    const listTableOptions = {
      format: formatToCompactTable,
    };

    const tables = await connector.listTables(listTableOptions);
    return tables;
  }

  public async saveModels(tables: string[]) {
    const connector = this.getPGConnector();
    const dataSourceColumns = (await connector.listTables({
      format: false,
    })) as PostgresColumnResponse[];

    const models = await this.createModels(tables, connector);
    // create columns
    const columns = await this.createAllColumns(
      tables,
      models,
      dataSourceColumns as PostgresColumnResponse[],
      connector,
    );
    return { models, columns };
  }

  public async saveModel(
    table: string,
    columns: string[],
    primaryKey?: string,
  ) {
    const connector = this.getPGConnector();
    const dataSourceColumns = (await connector.listTables({
      format: false,
    })) as PostgresColumnResponse[];

    const models = await this.createModels([table], connector);
    const model = models[0];
    // create columns
    const modelColumns = await this.createColumns(
      columns,
      model,
      dataSourceColumns as PostgresColumnResponse[],
      primaryKey,
    );
    return { model, columns: modelColumns };
  }

  public async updateModel(
    model: Model,
    columns: string[],
    primaryKey?: string,
  ) {
    const connector = this.getPGConnector();
    const dataSourceColumns = (await connector.listTables({
      format: false,
    })) as PostgresColumnResponse[];
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
        dataSourceColumns as PostgresColumnResponse[],
        primaryKey,
      );
    }
    if (toDeleteColumnIds.length) {
      await this.ctx.modelColumnRepository.deleteMany(toDeleteColumnIds);
    }
  }

  public async analysisRelation(models: Model[], columns: ModelColumn[]) {
    const connector = this.getPGConnector();
    const constraints = await connector.listConstraints();
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

  private async testConnection(properties: any) {
    const connector = new PostgresConnector(properties);

    // check DataSource is valid and can connect to it
    await connector.connect();

    // check can list dataset table
    try {
      await connector.listTables({ format: false });
    } catch (_e) {
      throw new Error('Can not list tables in dataset');
    }
  }

  private async patchConfigToWrenEngine(properties: any) {
    const { host, port, database, user, password, ssl } = properties;
    const sslMode = ssl ? '?sslmode=require' : '';
    // update wren-engine config
    const jdbcUrl = `jdbc:postgresql://${host}:${port}/${database}${sslMode}`;
    const config = {
      'wren.datasource.type': 'postgres',
      'postgres.jdbc.url': jdbcUrl,
      'postgres.user': user,
      'postgres.password': password,
    };
    await this.ctx.wrenEngineAdaptor.patchConfig(config);
  }

  private getPGConnector() {
    // get credentials decrypted
    const { credentials: encryptedCredentials } = this.project;
    const encryptor = new Encryptor(this.ctx.config);
    const credentials = JSON.parse(encryptor.decrypt(encryptedCredentials));

    // connect to data source
    const connector = new PostgresConnector({
      user: this.project.user,
      password: credentials.password,
      host: this.project.host,
      database: this.project.database,
      port: this.project.port,
      ssl: this.project.configurations?.ssl,
    });
    return connector;
  }

  private async createModels(tables: string[], connector: PostgresConnector) {
    const projectId = this.project.id;
    const modelValues = tables.map((compactTableName) => {
      const { schema, tableName } =
        connector.parseCompactTableName(compactTableName);
      // make referenceName = schema + _ + tableName
      const referenceName = `${schema}_${tableName}`;
      const model = {
        projectId,
        displayName: compactTableName, // use table name as displayName, referenceName and tableName
        referenceName,
        sourceTableName: compactTableName,
        refSql: `select * from "${schema}"."${tableName}"`,
        cached: false,
        refreshTime: null,
      } as Partial<Model>;
      return model;
    });

    const models = await this.ctx.modelRepository.createMany(modelValues);
    return models;
  }

  private async createColumns(
    columns: string[],
    model: Model,
    dataSourceColumns: PostgresColumnResponse[],
    primaryKey?: string,
  ) {
    const columnValues = columns.reduce((acc, columnName) => {
      const tableColumn = dataSourceColumns.find(
        (col) => col.column_name === columnName,
      );
      if (!tableColumn) {
        throw new Error(`Column not found: ${columnName}`);
      }
      const columnValue = {
        modelId: model.id,
        isCalculated: false,
        displayName: columnName,
        sourceColumnName: columnName,
        referenceName: transformInvalidColumnName(columnName),
        type: tableColumn?.data_type || 'string',
        notNull: tableColumn.is_nullable.toLocaleLowerCase() !== 'yes',
        isPk: primaryKey === columnName,
      } as Partial<ModelColumn>;
      acc.push(columnValue);
      return acc;
    }, []);
    const modelColumns = await Promise.all(
      columnValues.map(
        async (column) =>
          await this.ctx.modelColumnRepository.createOne(column),
      ),
    );
    return modelColumns;
  }

  private async createAllColumns(
    tables: string[],
    models: Model[],
    dataSourceColumns: PostgresColumnResponse[],
    connector: PostgresConnector,
  ) {
    const columnValues = tables.reduce((acc, compactTableName) => {
      // sourceTableName is the same as compactTableName when we create models
      const modelId = models.find(
        (m) => m.sourceTableName === compactTableName,
      )?.id;

      if (!modelId) {
        throw new Error('Model not found');
      }

      // get columns of the table
      // format the table_name & table_schema of the column to match compactTableName
      const tableColumns = dataSourceColumns.filter(
        (col) =>
          connector.formatCompactTableName(col.table_name, col.table_schema) ===
          compactTableName,
      );

      // create column for each column in the table
      // and add it to accumulated columnValues
      // columnValues will be used to create columns in database
      for (const tableColumn of tableColumns) {
        const columnName = tableColumn.column_name;
        const columnValue = {
          modelId,
          isCalculated: false,
          displayName: columnName,
          sourceColumnName: columnName,
          referenceName: transformInvalidColumnName(columnName),
          type: tableColumn?.data_type || 'string',
          notNull: tableColumn.is_nullable.toLocaleLowerCase() !== 'yes',
          isPk: false,
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
