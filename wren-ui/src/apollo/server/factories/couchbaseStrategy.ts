import { IConnector, CompactTable } from '../connectors/connector';
import { Model, ModelColumn, Project } from '../repositories';
import {
  DataSourceName,
  CouchbaseDataSourceProperties,
  IContext
} from '../types';
import {
  CouchbaseConnector,
  CouchbaseListTableOptions,
} from '../connectors/couchbaseConnector';
import { Encryptor } from '../utils';
import { IDataSourceStrategy } from './dataSourceStrategy';
import {
  findColumnsToUpdate,
  updateModelPrimaryKey,
  transformInvalidColumnName,
} from './util';

export class CouchbaseStrategy implements IDataSourceStrategy {
  connector: IConnector<any, any>;
  project: Project;
  ctx: IContext;

  constructor({ ctx, project }: { ctx: IContext; project?: Project }) {
    if (project) {
      this.project = project;
    }
    this.ctx = ctx;
  }

  public async createDataSource(properties: CouchbaseDataSourceProperties) {
    const { displayName, server, user, password, ssl } = properties;

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
      type: DataSourceName.COUCHBASE,
      server,
      user,
      credentials: encryptedCredentials,
      configurations: { ssl },
    });
    return project;
  }

  public async updateDataSource(
    properties: CouchbaseDataSourceProperties,
  ): Promise<any> {
    const { displayName, user, password: newPassword, ssl } = properties;
    const { server, credentials: oldEncryptedCredentials } = this.project;

    const encryptor = new Encryptor(this.ctx.config);
    const { password: oldPassword } = JSON.parse(
      encryptor.decrypt(oldEncryptedCredentials),
    );
    const password = newPassword || oldPassword;

    const newProperties = {
      server,
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
    const connector = this.getCouchbaseConnector();
    const listTableOptions = {
      format: formatToCompactTable,
    };
    const tables = await connector.listTables(listTableOptions);
    return tables;
  }

  public async saveModels(tables: string[]) {
    const connector = this.getCouchbaseConnector();
    const listTableOptions = { format: true } as CouchbaseListTableOptions;
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
    const connector = new CouchbaseConnector({
      wrenEngineAdaptor: this.ctx.wrenEngineAdaptor,
    });
    const listTableOptions = { format: true } as CouchbaseListTableOptions;
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
    const connector = new CouchbaseConnector({
      wrenEngineAdaptor: this.ctx.wrenEngineAdaptor,
    });
    const listTableOptions = { format: true } as CouchbaseListTableOptions;
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

  private async testConnection(properties: any) {
    const connector = new CouchbaseConnector(properties);

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
    const { server, user, password } = properties;
    // update wren-engine config
    const jdbcUrl = `jdbc:couchbase://User='${user}';Password='${password}';Server='${server}'`;
    const config = {
      'wren.datasource.type': 'couchbase',
      'couchbase.jdbc.url': jdbcUrl,
      'couchbase.server': server,
      'couchbase.user': user,
      'couchbase.password': password,
    };
    await this.ctx.wrenEngineAdaptor.patchConfig(config);
  }

  private getCouchbaseConnector() {
    // // get credentials decrypted
    // const { credentials: encryptedCredentials } = this.project;
    // const encryptor = new Encryptor(this.ctx.config);
    // const credentials = JSON.parse(encryptor.decrypt(encryptedCredentials));
    // // connect to data source
    // const connector = new CouchbaseConnector({
    //   user: this.project.user,
    //   password: credentials.password,
    //   server: this.project.server,
    //   ssl: this.project.configurations?.ssl,
    // });
    const connector = new CouchbaseConnector({
      wrenEngineAdaptor: this.ctx.wrenEngineAdaptor,
    });
    return connector;
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
    const columns =
      await this.ctx.modelColumnRepository.createMany(columnValues);
    return columns;
  }
}
