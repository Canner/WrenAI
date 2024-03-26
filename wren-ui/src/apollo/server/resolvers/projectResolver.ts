import { BigQueryOptions } from '@google-cloud/bigquery';
import {
  BQColumnResponse,
  BQConnector,
  BQConstraintResponse,
  BQListTableOptions,
} from '../connectors/bqConnector';
import {
  DataSource,
  DataSourceName,
  IContext,
  RelationData,
  AnalysisRelationInfo,
  RelationType,
  CompactTable,
  SampleDatasetData,
} from '../types';
import { getLogger, Encryptor } from '@server/utils';
import { Model, ModelColumn, Project, Relation } from '../repositories';
import {
  DuckDBConnector,
  DuckDBListTableOptions,
  DuckDBPrepareOptions,
} from '../connectors/duckdbConnector';
import { IConnector } from '../connectors/connector';
import { sampleDatasets } from '../data';
import { snakeCase } from 'lodash';

const logger = getLogger('DataSourceResolver');
logger.level = 'debug';

export enum OnboardingStatusEnum {
  NOT_STARTED = 'NOT_STARTED',
  DATASOURCE_SAVED = 'DATASOURCE_SAVED',
  ONBOARDING_FINISHED = 'ONBOARDING_FINISHED',
  WITH_SAMPLE_DATASET = 'WITH_SAMPLE_DATASET',
}

export class ProjectResolver {
  constructor() {
    this.saveDataSource = this.saveDataSource.bind(this);
    this.listDataSourceTables = this.listDataSourceTables.bind(this);
    this.saveTables = this.saveTables.bind(this);
    this.autoGenerateRelation = this.autoGenerateRelation.bind(this);
    this.saveRelations = this.saveRelations.bind(this);
    this.getOnboardingStatus = this.getOnboardingStatus.bind(this);
    this.startSampleDataset = this.startSampleDataset.bind(this);
  }

  public async startSampleDataset(
    _root: any,
    _arg: { data: SampleDatasetData },
    ctx: IContext,
  ) {
    const { name } = _arg.data;
    logger.debug({ name: snakeCase(name) });
    const dataset = sampleDatasets[snakeCase(name)];
    if (!dataset) {
      throw new Error('Sample dataset not found');
    }
    const duckdbDatasourceProperties = {
      initSql: dataset.initSql,
      extensions: [],
      configurations: {},
    };
    const project = await this.saveDuckDBDataSource(
      duckdbDatasourceProperties,
      ctx,
    );
    const tables = await this.listDataSourceTables(_root, _arg, ctx);
    const tableNames = tables.map((table) => table.name);
    await this.saveTables(_root, { data: { tables: tableNames } }, ctx);
    await ctx.projectRepository.updateOne(project.id, { sampleDataset: name });
    return { name };
  }

  public async getOnboardingStatus(_root: any, _arg: any, ctx: IContext) {
    let project: Project | null;
    try {
      project = await ctx.projectRepository.getCurrentProject();
    } catch (_err: any) {
      return {
        status: OnboardingStatusEnum.NOT_STARTED,
      };
    }
    const { id, sampleDataset } = project;
    if (sampleDataset) {
      return {
        status: OnboardingStatusEnum.WITH_SAMPLE_DATASET,
      };
    }
    const models = await ctx.modelRepository.findAllBy({ projectId: id });
    if (!models.length) {
      return {
        status: OnboardingStatusEnum.DATASOURCE_SAVED,
      };
    } else {
      return {
        status: OnboardingStatusEnum.ONBOARDING_FINISHED,
      };
    }
  }

  public async saveDataSource(
    _root: any,
    args: {
      data: DataSource;
    },
    ctx: IContext,
  ) {
    const { type, properties } = args.data;
    if (type === DataSourceName.BIG_QUERY) {
      await this.saveBigQueryDataSource(properties, ctx);
    } else if (type === DataSourceName.DUCKDB) {
      await this.saveDuckDBDataSource(properties, ctx);
    }
    return args.data;
  }

  public async listDataSourceTables(_root: any, _arg, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    let connector: IConnector<any, any>;
    let listTableOptions: any;
    if (project.type === DataSourceName.BIG_QUERY) {
      const filePath = await ctx.projectService.getCredentialFilePath(project);
      connector = await this.getBQConnector(project, filePath);
      listTableOptions = {
        datasetId: project.datasetId,
        format: true,
      } as BQListTableOptions;
    } else {
      connector = new DuckDBConnector({
        wrenEngineAdaptor: ctx.wrenEngineAdaptor,
      });
      listTableOptions = { format: true } as DuckDBListTableOptions;
    }
    const tables = (await connector.listTables(
      listTableOptions,
    )) as CompactTable[];
    logger.debug(tables);
    return tables;
  }

  public async saveTables(
    _root: any,
    arg: {
      data: { tables: string[] };
    },
    ctx: IContext,
  ) {
    const tables = arg.data.tables;

    // get current project
    const project = await ctx.projectService.getCurrentProject();
    const projectId = project.id;

    // get columns with descriptions
    let connector: IConnector<any, any>;
    let listTableOptions: any;
    let dataSourceColumns: any;
    if (project.type === DataSourceName.BIG_QUERY) {
      const filePath = await ctx.projectService.getCredentialFilePath(project);
      connector = await this.getBQConnector(project, filePath);
      listTableOptions = {
        datasetId: project.datasetId,
        format: false,
      } as BQListTableOptions;
      dataSourceColumns = (await connector.listTables(
        listTableOptions,
      )) as BQColumnResponse[];
    } else {
      connector = new DuckDBConnector({
        wrenEngineAdaptor: ctx.wrenEngineAdaptor,
      });
      listTableOptions = { format: true } as DuckDBListTableOptions;
      dataSourceColumns = (await connector.listTables(
        listTableOptions,
      )) as CompactTable[];
    }

    // delete existing models and columns
    await this.resetCurrentProjectModel(ctx, projectId);

    // create models
    let models: Model[];
    let columns: ModelColumn[];
    if (project.type === DataSourceName.BIG_QUERY) {
      models = await this.createBigQueryModels(
        tables,
        projectId,
        ctx,
        dataSourceColumns,
      );
      // create columns
      columns = await this.createBigQueryColumns(
        tables,
        models,
        dataSourceColumns as BQColumnResponse[],
        ctx,
      );
    } else {
      models = await this.createDuckDBModels(
        tables,
        projectId,
        ctx,
        dataSourceColumns as CompactTable[],
      );
      logger.debug({ models });
      // create columns
      columns = await this.createDuckDBColumns(
        tables,
        models,
        dataSourceColumns as CompactTable[],
        ctx,
      );
    }
    this.deploy(ctx);
    return { models: models, columns };
  }

  public async autoGenerateRelation(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    // Duckdb: skip auto generate relation
    if (project.type === DataSourceName.DUCKDB) {
      return models.map(({ id, sourceTableName }) => ({
        id,
        name: sourceTableName,
        relations: [],
      }));
    }
    const filePath = await ctx.projectService.getCredentialFilePath(project);
    const connector = await this.getBQConnector(project, filePath);
    const listConstraintOptions = {
      datasetId: project.datasetId,
    };
    const constraints = await connector.listConstraints(listConstraintOptions);
    const modelIds = models.map((m) => m.id);
    const columns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const relations = this.analysisRelation(constraints, models, columns);
    return models.map(({ id, sourceTableName }) => ({
      id,
      name: sourceTableName,
      relations: relations.filter((relation) => relation.fromModelId === id),
    }));
  }

  public async saveRelations(
    _root: any,
    arg: { data: { relations: RelationData[] } },
    ctx: IContext,
  ) {
    const { relations } = arg.data;
    const project = await ctx.projectService.getCurrentProject();

    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });

    const columnIds = relations
      .map(({ fromColumnId, toColumnId }) => [fromColumnId, toColumnId])
      .flat();
    const columns = await ctx.modelColumnRepository.findColumnsByIds(columnIds);
    const relationValues = relations.map((relation) => {
      const fromColumn = columns.find(
        (column) => column.id === relation.fromColumnId,
      );
      if (!fromColumn) {
        throw new Error(`Column not found, column Id ${relation.fromColumnId}`);
      }
      const toColumn = columns.find(
        (column) => column.id === relation.toColumnId,
      );
      if (!toColumn) {
        throw new Error(`Column not found, column Id  ${relation.toColumnId}`);
      }
      const relationName = this.generateRelationName(relation, models);
      return {
        projectId: project.id,
        name: relationName,
        fromColumnId: relation.fromColumnId,
        toColumnId: relation.toColumnId,
        joinType: relation.type,
      } as Partial<Relation>;
    });

    const savedRelations = await Promise.all(
      relationValues.map((relation) =>
        ctx.relationRepository.createOne(relation),
      ),
    );

    // async deploy
    this.deploy(ctx);
    return savedRelations;
  }

  private analysisRelation(
    constraints: BQConstraintResponse[],
    models: Model[],
    columns: ModelColumn[],
  ): AnalysisRelationInfo[] {
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

  private async getBQConnector(project: Project, filePath: string) {
    // fetch tables
    const { projectId } = project;
    const connectionOption: BigQueryOptions = {
      projectId,
      keyFilename: filePath,
    };
    return new BQConnector(connectionOption);
  }

  private async createBigQueryColumns(
    tables: string[],
    models: Model[],
    dataSourceColumns: BQColumnResponse[],
    ctx: IContext,
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
          properties: JSON.stringify({
            description: tableColumn.column_description,
          }),
        } as Partial<ModelColumn>;
        acc.push(columnValue);
      }
      return acc;
    }, []);
    const columns = await Promise.all(
      columnValues.map(
        async (column) => await ctx.modelColumnRepository.createOne(column),
      ),
    );
    return columns;
  }

  private async createDuckDBColumns(
    tables: string[],
    models: Model[],
    compactTables: CompactTable[],
    ctx: IContext,
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
    const columns = await ctx.modelColumnRepository.createMany(columnValues);
    return columns;
  }

  private async createBigQueryModels(
    tables: string[],
    id: number,
    ctx: IContext,
    dataSourceColumns: BQColumnResponse[],
  ) {
    const tableDescriptionMap = dataSourceColumns
      .filter((col) => col.table_description)
      .reduce((acc, column) => {
        acc[column.table_name] = column.table_description;
        return acc;
      }, {});
    const modelValues = tables.map((tableName) => {
      const description = tableDescriptionMap[tableName];
      const model = {
        projectId: id,
        displayName: tableName, //use table name as displayName, referenceName and tableName
        referenceName: tableName,
        sourceTableName: tableName,
        refSql: `select * from ${tableName}`,
        cached: false,
        refreshTime: null,
        properties: JSON.stringify({ description }),
      } as Partial<Model>;
      return model;
    });

    const models = await ctx.modelRepository.createMany(modelValues);
    return models;
  }

  private async createDuckDBModels(
    tables: string[],
    id: number,
    ctx: IContext,
    compactTables: CompactTable[],
  ) {
    const modelValues = tables.map((tableName) => {
      const compactTable = compactTables.find(
        (table) => table.name === tableName,
      );
      const properties = compactTable.properties
        ? JSON.stringify(compactTable.properties)
        : null;
      const model = {
        projectId: id,
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

    const models = await ctx.modelRepository.createMany(modelValues);
    return models;
  }

  private async saveDuckDBDataSource(properties: any, ctx: IContext) {
    const { displayName, extensions, configurations } = properties;
    const initSql = this.concatInitSql(properties.initSql, extensions);
    const connector = new DuckDBConnector({
      wrenEngineAdaptor: ctx.wrenEngineAdaptor,
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

    // remove existing datasource
    await this.removeCurrentProject(ctx);

    // save DataSource to database
    const project = await ctx.projectRepository.createOne({
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

  private async saveBigQueryDataSource(properties: any, ctx: IContext) {
    const { displayName, projectId, datasetId, credentials } = properties;
    const { config } = ctx;
    let filePath = '';
    // check DataSource is valid and can connect to it
    filePath = ctx.projectService.writeCredentialFile(
      credentials,
      config.persistCredentialDir,
    );
    const connectionOption: BigQueryOptions = {
      projectId,
      keyFilename: filePath,
    };
    const connector = new BQConnector(connectionOption);
    await connector.prepare();
    const connected = await connector.connect();
    if (!connected) {
      throw new Error('Can not connect to data source');
    }
    // check can list dataset table
    try {
      await connector.listTables({ datasetId });
    } catch (_e) {
      throw new Error('Can not list tables in dataset');
    }
    // save DataSource to database
    const encryptor = new Encryptor(config);
    const encryptedCredentials = encryptor.encrypt(credentials);

    // remove existing datasource
    await this.removeCurrentProject(ctx);

    // TODO: add displayName, schema, catalog to the DataSource, depends on the MDL structure
    const project = await ctx.projectRepository.createOne({
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

  private generateRelationName(relation: RelationData, models: Model[]) {
    const fromModel = models.find((m) => m.id === relation.fromModelId);
    const toModel = models.find((m) => m.id === relation.toModelId);
    if (!fromModel || !toModel) {
      throw new Error('Model not found');
    }
    return (
      fromModel.sourceTableName.charAt(0).toUpperCase() +
      fromModel.sourceTableName.slice(1) +
      toModel.sourceTableName.charAt(0).toUpperCase() +
      toModel.sourceTableName.slice(1)
    );
  }

  private async deploy(ctx) {
    const project = await ctx.projectService.getCurrentProject();
    const manifest = await ctx.mdlService.makeCurrentModelMDL();
    return await ctx.deployService.deploy(manifest, project.id);
  }

  private async resetCurrentProjectModel(ctx, projectId) {
    const existsModels = await ctx.modelRepository.findAllBy({ projectId });
    const modelIds = existsModels.map((m) => m.id);
    await ctx.modelColumnRepository.deleteByModelIds(modelIds);
    await ctx.modelRepository.deleteMany(modelIds);
  }

  private concatInitSql(initSql: string, extensions: string[]) {
    const installExtensions = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');
    return `${installExtensions}\n${initSql}`;
  }

  private async removeCurrentProject(ctx) {
    let currentProject: Project;
    try {
      currentProject = await ctx.projectRepository.getCurrentProject();
    } catch (_err: any) {
      // no project found
      return;
    }
    await this.resetCurrentProjectModel(ctx, currentProject.id);
    await ctx.projectRepository.deleteOne(currentProject.id);
  }
}
