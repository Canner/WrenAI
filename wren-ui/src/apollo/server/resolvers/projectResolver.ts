import {
  AnalysisRelationInfo,
  DataSource,
  DataSourceName,
  DataSourceProperties,
  IContext,
  RelationData,
  RelationType,
  SampleDatasetData,
} from '../types';
import { getLogger, replaceInvalidReferenceName, trim } from '@server/utils';
import {
  BIG_QUERY_CONNECTION_INFO,
  DUCKDB_CONNECTION_INFO,
  Model,
  ModelColumn,
  POSTGRES_CONNECTION_INFO,
  Project,
} from '../repositories';
import {
  SampleDatasetName,
  SampleDatasetRelationship,
  buildInitSql,
  getRelations,
  sampleDatasets,
} from '@server/data';
import { snakeCase, flatMap } from 'lodash';
import { CompactTable, ProjectData } from '../services';
import { replaceAllowableSyntax } from '../utils/regex';
import { DuckDBPrepareOptions } from '@server/adaptors/wrenEngineAdaptor';
import DataSourceSchemaDetector, {
  DataSourceSchema,
  SchemaChangeType,
} from '@server/managers/dataSourceSchemaDetector';

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
    this.getSettings = this.getSettings.bind(this);
    this.resetCurrentProject = this.resetCurrentProject.bind(this);
    this.saveDataSource = this.saveDataSource.bind(this);
    this.updateDataSource = this.updateDataSource.bind(this);
    this.listDataSourceTables = this.listDataSourceTables.bind(this);
    this.saveTables = this.saveTables.bind(this);
    this.autoGenerateRelation = this.autoGenerateRelation.bind(this);
    this.saveRelations = this.saveRelations.bind(this);
    this.getOnboardingStatus = this.getOnboardingStatus.bind(this);
    this.startSampleDataset = this.startSampleDataset.bind(this);
    this.triggerDataSourceDetection =
      this.triggerDataSourceDetection.bind(this);
    this.getSchemaChange = this.getSchemaChange.bind(this);
  }

  public async getSettings(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const dataSourceType = project.type;

    return {
      productVersion: ctx.config.wrenProductVersion || '',
      dataSource: {
        type: dataSourceType,
        properties: this.getDataSourceProperties(project),
        sampleDataset: project.sampleDataset,
      },
    };
  }

  public async resetCurrentProject(_root: any, _arg: any, ctx: IContext) {
    let id: number;
    try {
      const project = await ctx.projectService.getCurrentProject();
      id = project.id;
    } catch {
      // no project found
      return true;
    }

    await ctx.deployService.deleteAllByProjectId(id);
    await ctx.askingService.deleteAllByProjectId(id);
    await ctx.modelService.deleteAllViewsByProjectId(id);
    await ctx.modelService.deleteAllModelsByProjectId(id);

    await ctx.projectService.deleteProject(id);

    return true;
  }

  public async startSampleDataset(
    _root: any,
    _arg: { data: SampleDatasetData },
    ctx: IContext,
  ) {
    const { name } = _arg.data;
    const dataset = sampleDatasets[snakeCase(name)];
    if (!dataset) {
      throw new Error('Sample dataset not found');
    }
    if (!(name in SampleDatasetName)) {
      throw new Error('Invalid sample dataset name');
    }
    // telemetry
    ctx.telemetry.send_event('start_sample_dataset', { datasetName: name });

    // create duckdb datasource
    const initSql = buildInitSql(name as SampleDatasetName);
    logger.debug({ initSql });
    const duckdbDatasourceProperties = {
      initSql,
      extensions: [],
      configurations: {},
    };
    await this.saveDataSource(
      _root,
      {
        data: {
          type: DataSourceName.DUCKDB,
          properties: duckdbDatasourceProperties,
        } as DataSource,
      },
      ctx,
    );
    const project = await ctx.projectService.getCurrentProject();

    // list all the tables in the data source
    const tables = await this.listDataSourceTables(_root, _arg, ctx);
    const tableNames = tables.map((table) => table.name);

    // save tables as model and modelColumns
    await this.overwriteModelsAndColumns(tableNames, ctx, project);

    await ctx.modelService.updatePrimaryKeys(dataset.tables);
    await ctx.modelService.batchUpdateModelProperties(dataset.tables);
    await ctx.modelService.batchUpdateColumnProperties(dataset.tables);

    // save relations
    const relations = getRelations(name as SampleDatasetName);
    const models = await ctx.modelRepository.findAll();
    const columns = await ctx.modelColumnRepository.findAll();
    const mappedRelations = this.buildRelationInput(relations, models, columns);
    await ctx.modelService.saveRelations(mappedRelations);

    // mark current project as using sample dataset
    await ctx.projectRepository.updateOne(project.id, {
      sampleDataset: name,
    });
    await this.deploy(ctx);
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
    // Currently only can create one project
    await this.resetCurrentProject(_root, args, ctx);

    const { displayName, ...connectionInfo } = properties;
    const project = await ctx.projectService.createProject({
      displayName,
      type,
      connectionInfo,
    } as ProjectData);
    logger.debug(`Created project: ${JSON.stringify(project)}`);
    // try to connect to the data source
    try {
      if (type === DataSourceName.DUCKDB) {
        // handle duckdb connection
        connectionInfo as DUCKDB_CONNECTION_INFO;
        const { initSql, extensions } = connectionInfo;
        const initSqlWithExtensions = this.concatInitSql(initSql, extensions);

        // prepare duckdb environment in wren-engine
        await ctx.wrenEngineAdaptor.prepareDuckDB({
          sessionProps: connectionInfo.configurations,
          initSql: initSqlWithExtensions,
        } as DuckDBPrepareOptions);

        // check can list dataset table
        await ctx.wrenEngineAdaptor.listTables();

        // patch wren-engine config
        const config = {
          'wren.datasource.type': 'duckdb',
        };
        await ctx.wrenEngineAdaptor.patchConfig(config);
      } else {
        const tables =
          await ctx.projectService.getProjectDataSourceTables(project);
        logger.debug(
          `Can connect to the data source, tables: ${JSON.stringify(tables[0])}...`,
        );
      }
    } catch (err) {
      logger.error(
        'Failed to get project tables',
        JSON.stringify(err, null, 2),
      );
      await ctx.projectRepository.deleteOne(project.id);
      throw err;
    }

    // telemetry
    ctx.telemetry.send_event('save_data_source', { dataSourceType: type });
    ctx.telemetry.send_event('onboarding_step_1', { step: 'save_data_source' });

    return {
      type: project.type,
      properties: this.getDataSourceProperties(project),
    };
  }

  public async updateDataSource(
    _root: any,
    args: { data: DataSource },
    ctx: IContext,
  ) {
    const { properties } = args.data;
    const { displayName, ...connectionInfo } = properties;
    const project = await ctx.projectService.getCurrentProject();
    const dataSourceType = project.type;

    // only new connection info needed to encrypt
    const toUpdateConnectionInfo =
      ctx.projectService.encryptSensitiveConnectionInfo(connectionInfo as any);

    if (dataSourceType === DataSourceName.DUCKDB) {
      // prepare duckdb environment in wren-engine
      const { initSql, extensions } = toUpdateConnectionInfo;
      const initSqlWithExtensions = this.concatInitSql(initSql, extensions);
      await ctx.wrenEngineAdaptor.prepareDuckDB({
        sessionProps: toUpdateConnectionInfo.configurations,
        initSql: initSqlWithExtensions,
      } as DuckDBPrepareOptions);

      // check can list dataset table
      try {
        await ctx.wrenEngineAdaptor.listTables();
      } catch (_e) {
        throw new Error('Can not list tables in dataset');
      }

      // patch wren-engine config
      const config = {
        'wren.datasource.type': 'duckdb',
      };
      await ctx.wrenEngineAdaptor.patchConfig(config);
    } else {
      const updatedProject = {
        ...project,
        displayName,
        connectionInfo: {
          ...project.connectionInfo,
          ...toUpdateConnectionInfo,
        },
      } as Project;
      const tables =
        await ctx.projectService.getProjectDataSourceTables(updatedProject);
      logger.debug(
        `Can connect to the data source, tables: ${JSON.stringify(tables[0])}...`,
      );
    }
    const nextProject = await ctx.projectRepository.updateOne(project.id, {
      displayName,
      connectionInfo: { ...project.connectionInfo, ...toUpdateConnectionInfo },
    });
    return {
      type: nextProject.type,
      properties: this.getDataSourceProperties(nextProject),
    };
  }

  public async listDataSourceTables(_root: any, _arg, ctx: IContext) {
    return await ctx.projectService.getProjectDataSourceTables();
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

    // delete existing models and columns
    const { models, columns } = await this.overwriteModelsAndColumns(
      tables,
      ctx,
      project,
    );

    // telemetry
    ctx.telemetry.send_event('save_tables', {
      tablesCount: models.length,
      columnsCount: columns.length,
    });
    ctx.telemetry.send_event('onboarding_step_2', { step: 'save_models' });

    // async deploy to wren-engine and ai service
    this.deploy(ctx);
    return { models: models, columns };
  }

  public async autoGenerateRelation(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();

    // get models and columns
    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    const modelIds = models.map((m) => m.id);
    const columns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const constraints =
      await ctx.projectService.getProjectSuggestedConstraint(project);

    // generate relation
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
        name: constraint.constraintName,
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
    logger.debug({ relations });
    // group by model
    return models.map(({ id, displayName, referenceName }) => ({
      id,
      displayName,
      referenceName,
      relations: relations.filter(
        (relation) =>
          relation.fromModelId === id &&
          // exclude self-referential relationship
          relation.toModelId !== relation.fromModelId,
      ),
    }));
  }

  public async saveRelations(
    _root: any,
    arg: { data: { relations: RelationData[] } },
    ctx: IContext,
  ) {
    const savedRelations = await ctx.modelService.saveRelations(
      arg.data.relations,
    );
    ctx.telemetry.send_event('onboarding_step_3', { step: 'save_relation' });

    // async deploy
    this.deploy(ctx);
    return savedRelations;
  }

  public async getSchemaChange(_root: any, _arg: any, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const lastSchemaChange =
      await ctx.schemaChangeRepository.findLastSchemaChange(project.id);

    if (lastSchemaChange) {
      const models = await ctx.modelRepository.findAllBy({
        projectId: project.id,
      });
      const modelIds = models.map((model) => model.id);
      const modelColumns =
        await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);

      // Mapping with affected models and columns data into schame change
      const mappingAffectedToSchemaChange = (changes: DataSourceSchema[]) => {
        const affecteds = flatMap(changes, (change) => {
          const affectedModel = models.find(
            (model) => model.sourceTableName === change.name,
          );
          return affectedModel
            ? {
                sourceTableName: change.name,
                displayName: affectedModel.displayName,
                columns: flatMap(change.columns, (column) => {
                  const affectedColumn = modelColumns.find(
                    (modelColumn) =>
                      modelColumn.sourceColumnName === column.name &&
                      modelColumn.modelId === affectedModel.id,
                  );
                  return affectedColumn
                    ? {
                        sourceColumnName: column.name,
                        displayName: affectedColumn?.displayName,
                        type: column.type,
                      }
                    : [];
                }),
              }
            : [];
        });
        return affecteds.length ? affecteds : null;
      };

      const resolves = lastSchemaChange.resolve;
      const unresolvedChanges = Object.keys(resolves).reduce((result, key) => {
        const isResolved = resolves[key];
        const changes = lastSchemaChange.change[key];
        // return if resolved or no changes
        if (isResolved || !changes) return result;

        const affectedChanges = mappingAffectedToSchemaChange(changes);
        return { ...result, [key]: affectedChanges };
      }, {});

      return unresolvedChanges;
    }
  }

  public async triggerDataSourceDetection(
    _root: any,
    _arg: any,
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getCurrentProject();
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    await schemaDetector.detectSchemaChange();
    return true;
  }

  public async resolveSchemaChange(
    _root: any,
    arg: { where: { type: SchemaChangeType } },
    ctx: IContext,
  ) {
    const { type } = arg.where;
    const project = await ctx.projectService.getCurrentProject();
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    await schemaDetector.resolveSchemaChange(type);
    return true;
  }

  private async deploy(ctx: IContext) {
    const { id } = await ctx.projectService.getCurrentProject();
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL();
    return await ctx.deployService.deploy(manifest, id);
  }

  private buildRelationInput(
    relations: SampleDatasetRelationship[],
    models: Model[],
    columns: ModelColumn[],
  ) {
    const relationInput = relations.map((relation) => {
      const { fromModelName, fromColumnName, toModelName, toColumnName, type } =
        relation;
      const fromModelId = models.find(
        (model) => model.sourceTableName === fromModelName,
      )?.id;
      const toModelId = models.find(
        (model) => model.sourceTableName === toModelName,
      )?.id;
      if (!fromModelId || !toModelId) {
        throw new Error(
          `Model not found, fromModelName "${fromModelName}" to toModelName: "${toModelName}"`,
        );
      }

      const fromColumnId = columns.find(
        (column) =>
          column.referenceName === fromColumnName &&
          column.modelId === fromModelId,
      )?.id;
      const toColumnId = columns.find(
        (column) =>
          column.referenceName === toColumnName && column.modelId === toModelId,
      )?.id;
      if (!fromColumnId || !toColumnId) {
        throw new Error(
          `Column not found fromColumnName: ${fromColumnName} toColumnName: ${toColumnName}`,
        );
      }
      return {
        fromModelId,
        fromColumnId,
        toModelId,
        toColumnId,
        type,
      } as RelationData;
    });
    return relationInput;
  }

  private async overwriteModelsAndColumns(
    tables: string[],
    ctx: IContext,
    project: Project,
  ) {
    // delete existing models and columns
    await ctx.modelService.deleteAllModelsByProjectId(project.id);

    // create model and columns
    const compactTables: CompactTable[] =
      await ctx.projectService.getProjectDataSourceTables(project);

    const modelValues = tables.map((tableName) => {
      const compactTable = compactTables.find(
        (table) => table.name === tableName,
      );
      if (!compactTable) {
        throw new Error(`Table not found in data source: ${tableName}`);
      }
      const properties = compactTable?.properties;
      // compactTable contain schema and catalog, these information are for building tableReference in mdl
      const model = {
        projectId: project.id,
        displayName: tableName, //use table name as displayName, referenceName and tableName
        referenceName: replaceInvalidReferenceName(tableName),
        sourceTableName: tableName,
        cached: false,
        refreshTime: null,
        properties: properties ? JSON.stringify(properties) : null,
      } as Partial<Model>;
      return model;
    });
    const models = await ctx.modelRepository.createMany(modelValues);

    const columnValues = [];
    tables.forEach((tableName) => {
      const compactTable = compactTables.find(
        (table) => table.name === tableName,
      );
      const compactColumns = compactTable.columns;
      const primaryKey = compactTable.primaryKey;
      const model = models.find((m) => m.sourceTableName === compactTable.name);
      compactColumns.forEach((column) => {
        const columnValue = {
          modelId: model.id,
          isCalculated: false,
          displayName: column.name,
          referenceName: this.transformInvalidColumnName(column.name),
          sourceColumnName: column.name,
          type: column.type || 'string',
          notNull: column.notNull || false,
          isPk: primaryKey === column.name,
          properties: column.properties
            ? JSON.stringify(column.properties)
            : null,
        } as Partial<ModelColumn>;
        columnValues.push(columnValue);
      });
    });
    const columns = await ctx.modelColumnRepository.createMany(columnValues);

    return { models, columns };
  }

  private getDataSourceProperties(project: Project) {
    const dataSourceType = project.type;
    const properties = {
      displayName: project.displayName,
    } as DataSourceProperties;

    if (dataSourceType === DataSourceName.BIG_QUERY) {
      const { projectId, datasetId } =
        project.connectionInfo as BIG_QUERY_CONNECTION_INFO;
      properties.projectId = projectId;
      properties.datasetId = datasetId;
    } else if (dataSourceType === DataSourceName.DUCKDB) {
      const { initSql, extensions, configurations } =
        project.connectionInfo as DUCKDB_CONNECTION_INFO;
      properties.initSql = initSql;
      properties.extensions = extensions;
      properties.configurations = configurations;
    } else if (dataSourceType === DataSourceName.POSTGRES) {
      const { host, port, database, user, ssl } =
        project.connectionInfo as POSTGRES_CONNECTION_INFO;
      properties.host = host;
      properties.port = port;
      properties.database = database;
      properties.user = user;
      properties.ssl = ssl;
    }

    return properties;
  }

  private transformInvalidColumnName(columnName: string) {
    let referenceName = replaceAllowableSyntax(columnName);
    // If the reference name does not start with a letter, add a prefix
    const startWithLetterRegex = /^[A-Za-z]/;
    if (!startWithLetterRegex.test(referenceName)) {
      referenceName = `col_${referenceName}`;
    }
    return referenceName;
  }

  private concatInitSql(initSql: string, extensions: string[]) {
    const installExtensions = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');
    return trim(`${installExtensions}\n${initSql}`);
  }
}
