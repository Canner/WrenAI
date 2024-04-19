import {
  DataSource,
  DataSourceName,
  IContext,
  RelationData,
  SampleDatasetData,
} from '../types';
import { getLogger } from '@server/utils';
import { Model, ModelColumn, Project } from '../repositories';
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
    const dataset = sampleDatasets[snakeCase(name)];
    if (!dataset) {
      throw new Error('Sample dataset not found');
    }
    if (!(name in SampleDatasetName)) {
      throw new Error('Invalid sample dataset name');
    }

    // create duckdb datasource
    const initSql = buildInitSql(name as SampleDatasetName);
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

    await ctx.modelService.batchUpdateModelDescription(dataset.tables);
    await ctx.modelService.batchUpdateColumnDescription(dataset.tables);

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
    await this.removeCurrentProject(ctx);
    const strategy = DataSourceStrategyFactory.create(type, { ctx });
    await strategy.saveDataSource(properties);
    return args.data;
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
    const savedRelations = await ctx.modelService.saveRelations(
      arg.data.relations,
    );
    // async deploy
    this.deploy(ctx);
    return savedRelations;
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

  private async deploy(ctx: IContext) {
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
          `Model not found, fromModelName "${fromModelName}" to toModelname: "${toModelName}"`,
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
    await this.resetCurrentProjectModel(ctx, project.id);

    // create model and columns
    const strategy = DataSourceStrategyFactory.create(project.type, {
      ctx,
      project,
    });
    const { models, columns } = await strategy.saveModels(tables);

    return { models, columns };
  }
}
