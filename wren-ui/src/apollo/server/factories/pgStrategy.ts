import { IDataSourceStrategy } from './dataSourceStrategy';
import {
  AnalysisRelationInfo,
  DataSourceName,
  IContext,
  RelationType,
  PGDataSourceProperties,
} from '../types';
import { Model, ModelColumn, Project } from '../repositories';
import { PGColumnResponse, PGConnector } from '../connectors/pgConnector';
import { Encryptor } from '../utils';

export class PGStrategy implements IDataSourceStrategy {
  private project?: Project;
  private ctx: IContext;

  constructor({ ctx, project }: { ctx: IContext; project?: Project }) {
    this.project = project;
    this.ctx = ctx;
  }

  public async createDataSource(properties: PGDataSourceProperties) {
    const { displayName, host, port, database, user, password } = properties;

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
      type: DataSourceName.PG,
      host,
      port,
      database,
      user,
      credentials: encryptedCredentials,
    });
    return project;
  }

  public async updateDataSource(
    properties: PGDataSourceProperties,
  ): Promise<any> {
    const { displayName, user, password: newPassword } = properties;
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

    await this.testConnection({
      host,
      port,
      database,
      user,
      password,
    });

    await this.patchConfigToWrenEngine({
      host,
      port,
      database,
      user,
      password,
    });

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
    })) as PGColumnResponse[];

    const models = await this.createModels(this.project, tables);
    // create columns
    const columns = await this.createColumns(
      tables,
      models,
      dataSourceColumns as PGColumnResponse[],
    );
    return { models, columns };
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

  private async testConnection(properties: any) {
    const connector = new PGConnector(properties);

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

  private async patchConfigToWrenEngine(properties: any) {
    const { host, port, database, user, password } = properties;
    // update wren-engine config
    const jdbcUrl = `jdbc:postgresql://${host}:${port}/${database}`;
    const config = {
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
    const connector = new PGConnector({
      user: this.project.user,
      password: credentials.password,
      host: this.project.host,
      database: this.project.database,
      port: this.project.port,
    });
    return connector;
  }

  private async createModels(project: Project, tables: string[]) {
    const projectId = this.project.id;
    const modelValues = tables.map((tableName) => {
      const model = {
        projectId,
        displayName: tableName, //use table name as displayName, referenceName and tableName
        referenceName: tableName,
        sourceTableName: tableName,
        refSql: `select * from "${project.schema}".${tableName}`,
        cached: false,
        refreshTime: null,
      } as Partial<Model>;
      return model;
    });

    const models = await this.ctx.modelRepository.createMany(modelValues);
    return models;
  }

  private async createColumns(
    tables: string[],
    models: Model[],
    dataSourceColumns: PGColumnResponse[],
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
        const columnValue = {
          modelId,
          isCalculated: false,
          displayName: columnName,
          sourceColumnName: columnName,
          referenceName: columnName,
          type: tableColumn?.data_type || 'string',
          notNull: tableColumn.is_nullable.toLocaleLowerCase() !== 'yes',
          isPk: false,
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
