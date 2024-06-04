import {
  DataSource,
  DataSourceName,
  DataSourceProperties,
  IContext,
  RelationData,
  SampleDatasetData,
} from '../types';
import { getLogger } from '@server/utils';
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
import { snakeCase } from 'lodash';
import { DataSourceStrategyFactory } from '../factories/onboardingFactory';

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

    const strategy = DataSourceStrategyFactory.create(type, { ctx });
    const project = await strategy.createDataSource(properties);

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
    const project = await ctx.projectService.getCurrentProject();

    const strategy = DataSourceStrategyFactory.create(project.type, {
      ctx,
      project,
    });
    const nextProject = await strategy.updateDataSource(properties);
    return {
      type: nextProject.type,
      properties: this.getDataSourceProperties(nextProject),
    };
  }

  public async listDataSourceTables(_root: any, _arg, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const dataSourceType = project.type;
    const strategy = DataSourceStrategyFactory.create(dataSourceType, {
      ctx,
      project,
    });
    return await strategy.listTable({ formatToCompactTable: true });
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

    // generate relation
    const strategy = DataSourceStrategyFactory.create(project.type, {
      project,
      ctx,
    });
    const relations = await strategy.analysisRelation(models, columns);
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
    const strategy = DataSourceStrategyFactory.create(project.type, {
      ctx,
      project,
    });
    const { models, columns } = await strategy.saveModels(tables);

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
}
