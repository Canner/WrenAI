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
import {
  trim,
  getLogger,
  replaceInvalidReferenceName,
  transformInvalidColumnName,
  handleNestedColumns,
} from '@server/utils';
import {
  DUCKDB_CONNECTION_INFO,
  KnowledgeBase,
  Model,
  ModelColumn,
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
import { CompactTable, ProjectData } from '../services';
import { DuckDBPrepareOptions } from '@server/adaptors/wrenEngineAdaptor';
import { AskRuntimeIdentity } from '@server/models/adaptor';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import DataSourceSchemaDetector, {
  SchemaChangeType,
} from '@server/managers/dataSourceSchemaDetector';
import { encryptConnectionInfo } from '../dataSource';
import { TelemetryEvent } from '../telemetry/telemetry';
import { resolveRuntimeProject as resolveScopedRuntimeProject } from '../utils/runtimeExecutionContext';
import { syncLatestExecutableKnowledgeBaseSnapshot } from '../utils/knowledgeBaseRuntime';
import {
  toCanonicalPersistedRuntimeIdentityFromScope,
  toProjectBridgeRuntimeIdentity,
} from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('DataSourceResolver');
logger.level = 'debug';

export enum OnboardingStatusEnum {
  NOT_STARTED = 'NOT_STARTED',
  DATASOURCE_SAVED = 'DATASOURCE_SAVED',
  ONBOARDING_FINISHED = 'ONBOARDING_FINISHED',
  WITH_SAMPLE_DATASET = 'WITH_SAMPLE_DATASET',
}

export const MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE =
  '当前为系统自动维护的联邦运行时，请前往知识库 → 连接器维护数据源。';

export class ProjectResolver {
  constructor() {
    this.getSettings = this.getSettings.bind(this);
    this.updateCurrentProject = this.updateCurrentProject.bind(this);
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
    this.getProjectRecommendationQuestions =
      this.getProjectRecommendationQuestions.bind(this);
  }

  public async getSettings(_root: any, _arg: any, ctx: IContext) {
    const project = await this.getActiveRuntimeProjectOrThrow(ctx);
    await this.assertKnowledgeBaseReadAccess(ctx);
    const knowledgeBase = await this.resolveActiveRuntimeKnowledgeBase(ctx);
    const generalConnectionInfo =
      ctx.projectService.getGeneralConnectionInfo(project);
    const dataSourceType = project.type;

    const result = {
      productVersion: ctx.config.wrenProductVersion || '',
      dataSource: {
        type: dataSourceType,
        properties: this.buildDataSourceSettingsProperties({
          project,
          knowledgeBase,
          generalConnectionInfo,
        }) as DataSourceProperties,
        sampleDataset: knowledgeBase?.sampleDataset ?? project.sampleDataset,
      },
      language: knowledgeBase?.language ?? project.language,
    };
    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: knowledgeBase ? 'knowledge_base' : 'project',
      resourceId: knowledgeBase?.id || project.id,
      payloadJson: {
        operation: 'get_settings',
      },
    });
    return result;
  }

  public async getProjectRecommendationQuestions(
    _root: any,
    _arg: any,
    ctx: IContext,
  ) {
    const project = await this.getActiveRuntimeProjectOrThrow(ctx);
    await this.assertKnowledgeBaseReadAccess(ctx);
    const result = await ctx.projectService.getProjectRecommendationQuestions(
      project.id,
    );
    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      payloadJson: {
        operation: 'get_project_recommendation_questions',
      },
    });
    return result;
  }

  public async updateCurrentProject(
    _root: any,
    arg: { data: { language: string } },
    ctx: IContext,
  ) {
    const { language } = arg.data;
    const [knowledgeBase, project] = await Promise.all([
      this.resolveActiveRuntimeKnowledgeBase(ctx),
      this.resolveActiveRuntimeProject(ctx),
    ]);

    if (!project && !knowledgeBase) {
      throw new Error('Active runtime project is required for this operation');
    }

    await this.assertKnowledgeBaseWriteAccess(ctx);

    await Promise.all([
      project
        ? ctx.projectRepository.updateOne(project.id, {
            language,
          })
        : Promise.resolve(null),
      knowledgeBase
        ? ctx.knowledgeBaseRepository.updateOne(knowledgeBase.id, {
            language,
          })
        : Promise.resolve(null),
    ]);

    // only generating for user's data source
    if (
      project &&
      (knowledgeBase?.sampleDataset ?? project.sampleDataset) === null
    ) {
      await ctx.projectService.generateProjectRecommendationQuestions(
        project.id,
        this.getCurrentRuntimeScopeId(ctx),
      );
    }
    await this.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: knowledgeBase ? 'knowledge_base' : 'project',
      resourceId: knowledgeBase?.id || project?.id || null,
      afterJson: {
        language,
      },
      payloadJson: {
        operation: 'update_current_project',
      },
    });
    return true;
  }

  public async resetCurrentProject(_root: any, _arg: any, ctx: IContext) {
    const project = await this.resolveActiveRuntimeProject(ctx);
    if (!project) {
      return true;
    }
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const eventName = TelemetryEvent.SETTING_RESET_PROJECT;
    try {
      const id = project.id;
      await ctx.schemaChangeRepository.deleteAllBy({ projectId: id });
      await ctx.deployService.deleteAllByProjectId(id);
      await ctx.askingService.deleteAllByProjectId(id);
      await ctx.modelService.deleteAllViewsByProjectId(id);
      await ctx.modelService.deleteAllModelsByProjectId(id);
      await ctx.projectService.deleteProject(id);
      await ctx.wrenAIAdaptor.delete({
        runtimeIdentity: this.toAskRuntimeIdentity(
          this.getCurrentPersistedRuntimeIdentity(ctx),
        ),
      });

      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        projectId: id,
        dataSourceType: project.type,
      });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'project',
        resourceId: id,
        payloadJson: {
          operation: 'reset_current_project',
          dataSourceType: project.type,
        },
      });
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { dataSourceType: project.type, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }

    return true;
  }

  public async startSampleDataset(
    _root: any,
    _arg: { data: SampleDatasetData },
    ctx: IContext,
  ) {
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { name } = _arg.data;
    const dataset = sampleDatasets[snakeCase(name)];
    if (!dataset) {
      throw new Error('Sample dataset not found');
    }
    if (!(name in SampleDatasetName)) {
      throw new Error('Invalid sample dataset name');
    }
    const eventName = TelemetryEvent.CONNECTION_START_SAMPLE_DATASET;
    const eventProperties = {
      datasetName: name,
    };
    try {
      // create duckdb datasource
      const initSql = buildInitSql(name as SampleDatasetName);
      const duckdbDatasourceProperties = {
        displayName: name,
        initSql,
        extensions: [],
        configurations: {},
      };
      const project = await this.createProjectFromDataSource(
        {
          type: DataSourceName.DUCKDB,
          properties: duckdbDatasourceProperties,
        },
        ctx,
      );

      // list all the tables in the data source
      const tables =
        await ctx.projectService.getProjectDataSourceTables(project);
      const tableNames = tables.map((table) => table.name);

      // save tables as model and modelColumns
      const { models, columns } = await this.overwriteModelsAndColumns(
        tableNames,
        ctx,
        project,
      );

      await ctx.modelService.updatePrimaryKeys(project.id, dataset.tables);
      await ctx.modelService.batchUpdateModelProperties(
        project.id,
        dataset.tables,
      );
      await ctx.modelService.batchUpdateColumnProperties(
        project.id,
        dataset.tables,
      );

      // save relations
      const relations = getRelations(name as SampleDatasetName) || [];
      const mappedRelations = this.buildRelationInput(
        relations,
        models,
        columns,
      );
      await ctx.modelService.saveRelations(mappedRelations);

      // mark current project as using sample dataset
      const updatedProject = await ctx.projectRepository.updateOne(project.id, {
        sampleDataset: name,
      });
      await this.deploy(ctx, updatedProject);
      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'project',
        resourceId: updatedProject.id,
        afterJson: {
          sampleDataset: name,
        },
        payloadJson: {
          operation: 'start_sample_dataset',
          datasetName: name,
        },
      });
      return {
        name,
        projectId: updatedProject.id,
        runtimeScopeId: String(updatedProject.id),
      };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { ...eventProperties, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async getOnboardingStatus(_root: any, _arg: any, ctx: IContext) {
    await this.assertKnowledgeBaseReadAccess(ctx);
    const knowledgeBase = await this.resolveActiveRuntimeKnowledgeBase(ctx);
    const project = await this.resolveActiveRuntimeProject(ctx);
    const sampleDataset =
      knowledgeBase?.sampleDataset ?? project?.sampleDataset;

    if (sampleDataset) {
      await this.recordKnowledgeBaseReadAudit(ctx, {
        resourceType: knowledgeBase ? 'knowledge_base' : 'project',
        resourceId: knowledgeBase?.id || project?.id || null,
        payloadJson: {
          operation: 'get_onboarding_status',
        },
      });
      return {
        status: OnboardingStatusEnum.WITH_SAMPLE_DATASET,
      };
    }

    if (!project) {
      if (
        knowledgeBase?.primaryConnectorId ||
        knowledgeBase?.defaultKbSnapshotId
      ) {
        await this.recordKnowledgeBaseReadAudit(ctx, {
          resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
          resourceId: knowledgeBase?.id || ctx.runtimeScope?.workspace?.id,
          payloadJson: {
            operation: 'get_onboarding_status',
          },
        });
        return {
          status: OnboardingStatusEnum.DATASOURCE_SAVED,
        };
      }

      await this.recordKnowledgeBaseReadAudit(ctx, {
        resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
        resourceId: knowledgeBase?.id || ctx.runtimeScope?.workspace?.id,
        payloadJson: {
          operation: 'get_onboarding_status',
        },
      });
      return {
        status: OnboardingStatusEnum.NOT_STARTED,
      };
    }

    const { id } = project;
    const models = await ctx.modelRepository.findAllBy({ projectId: id });
    if (!models.length) {
      await this.recordKnowledgeBaseReadAudit(ctx, {
        resourceType: knowledgeBase ? 'knowledge_base' : 'project',
        resourceId: knowledgeBase?.id || project.id,
        payloadJson: {
          operation: 'get_onboarding_status',
        },
      });
      return {
        status: OnboardingStatusEnum.DATASOURCE_SAVED,
      };
    } else {
      await this.recordKnowledgeBaseReadAudit(ctx, {
        resourceType: knowledgeBase ? 'knowledge_base' : 'project',
        resourceId: knowledgeBase?.id || project.id,
        payloadJson: {
          operation: 'get_onboarding_status',
        },
      });
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
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const project = await this.createProjectFromDataSource(args.data, ctx);
    await this.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      afterJson: {
        type: project.type,
        displayName: project.displayName,
      },
      payloadJson: {
        operation: 'save_data_source',
      },
    });

    return {
      type: project.type,
      properties: {
        displayName: project.displayName,
        ...ctx.projectService.getGeneralConnectionInfo(project),
      },
    };
  }

  public async updateDataSource(
    _root: any,
    args: { data: DataSource },
    ctx: IContext,
  ) {
    const knowledgeBase = await this.resolveActiveRuntimeKnowledgeBase(ctx);
    const { properties } = args.data;
    const { displayName, ...connectionInfo } = properties;
    const project = await this.getActiveRuntimeProjectOrThrow(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    if (this.isManagedFederatedRuntimeProject(project, knowledgeBase)) {
      throw new Error(MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE);
    }
    const dataSourceType = project.type;

    // only new connection info needed to encrypt
    const toUpdateConnectionInfo = encryptConnectionInfo(
      dataSourceType,
      connectionInfo as any,
    );

    if (dataSourceType === DataSourceName.DUCKDB) {
      // prepare duckdb environment in wren-engine
      const { initSql, extensions, configurations } =
        toUpdateConnectionInfo as DUCKDB_CONNECTION_INFO;
      await this.buildDuckDbEnvironment(ctx, {
        initSql,
        extensions,
        configurations,
      });
    } else {
      const updatedProject = {
        ...project,
        displayName,
        connectionInfo: {
          ...project.connectionInfo,
          ...toUpdateConnectionInfo,
        },
      } as Project;

      await ctx.projectService.getProjectDataSourceTables(updatedProject);
      logger.debug(`Data source tables fetched`);
    }
    const updatedProject = await ctx.projectRepository.updateOne(project.id, {
      displayName,
      connectionInfo: { ...project.connectionInfo, ...toUpdateConnectionInfo },
    });
    await this.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'project',
      resourceId: updatedProject.id,
      afterJson: {
        type: updatedProject.type,
        displayName: updatedProject.displayName,
      },
      payloadJson: {
        operation: 'update_data_source',
      },
    });
    return {
      type: updatedProject.type,
      properties: {
        displayName: updatedProject.displayName,
        ...ctx.projectService.getGeneralConnectionInfo(updatedProject),
      },
    };
  }

  public async listDataSourceTables(_root: any, _arg: any, ctx: IContext) {
    const project = await this.getActiveRuntimeProjectOrThrow(ctx);
    await this.assertKnowledgeBaseReadAccess(ctx);
    const result = await ctx.projectService.getProjectDataSourceTables(project);
    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      payloadJson: {
        operation: 'list_data_source_tables',
      },
    });
    return result;
  }

  public async saveTables(
    _root: any,
    arg: {
      data: { tables: string[] };
    },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.CONNECTION_SAVE_TABLES;

    // get current project
    const project = await this.getActiveRuntimeProjectOrThrow(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    try {
      // delete existing models and columns
      const { models, columns } = await this.overwriteModelsAndColumns(
        arg.data.tables,
        ctx,
        project,
      );
      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        dataSourceType: project.type,
        tablesCount: models.length,
        columnsCount: columns.length,
      });

      // async deploy to wren-engine and ai service
      this.deploy(ctx, project);
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'project',
        resourceId: project.id,
        payloadJson: {
          operation: 'save_tables',
          tablesCount: models.length,
          columnsCount: columns.length,
        },
      });
      return { models: models, columns };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { dataSourceType: project.type, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async autoGenerateRelation(_root: any, _arg: any, ctx: IContext) {
    const project = await this.getActiveRuntimeProjectOrThrow(ctx);
    await this.assertKnowledgeBaseReadAccess(ctx);

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
    const relations: AnalysisRelationInfo[] = [];
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
    // group by model
    const result = models.map(({ id, displayName, referenceName }) => ({
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
    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      payloadJson: {
        operation: 'auto_generate_relation',
      },
    });
    return result;
  }

  public async saveRelations(
    _root: any,
    arg: { data: { relations: RelationData[] } },
    ctx: IContext,
  ) {
    const eventName = TelemetryEvent.CONNECTION_SAVE_RELATION;
    try {
      const project = await this.getActiveRuntimeProjectOrThrow(ctx);
      await this.assertKnowledgeBaseWriteAccess(ctx);
      await this.ensureModelsBelongToProject(
        ctx,
        arg.data.relations.flatMap(({ fromModelId, toModelId }) => [
          fromModelId,
          toModelId,
        ]),
        project.id,
      );
      const savedRelations = await ctx.modelService.saveRelations(
        arg.data.relations,
      );
      // async deploy
      this.deploy(ctx, project);
      ctx.telemetry.sendEvent(eventName, {
        relationCount: savedRelations.length,
      });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'project',
        resourceId: project.id,
        payloadJson: {
          operation: 'save_relations',
          relationCount: savedRelations.length,
        },
      });
      return savedRelations;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async getSchemaChange(_root: any, _arg: any, ctx: IContext) {
    const project = await this.getActiveRuntimeProjectOrThrow(ctx);
    await this.assertKnowledgeBaseReadAccess(ctx);
    const lastSchemaChange =
      await ctx.schemaChangeRepository.findLastSchemaChange(project.id);

    if (!lastSchemaChange) {
      const result = {
        deletedTables: null,
        deletedColumns: null,
        modifiedColumns: null,
        lastSchemaChangeTime: null,
      };
      await this.recordKnowledgeBaseReadAudit(ctx, {
        resourceType: 'project',
        resourceId: project.id,
        payloadJson: {
          operation: 'get_schema_change',
        },
      });
      return result;
    }

    const models = await ctx.modelRepository.findAllBy({
      projectId: project.id,
    });
    const modelIds = models.map((model) => model.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);

    const modelRelationships = await ctx.relationRepository.findRelationInfoBy({
      modelIds,
    });

    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });

    const resolves = lastSchemaChange.resolve;
    const unresolvedChanges = (
      Object.values(SchemaChangeType) as SchemaChangeType[]
    ).reduce((result, key) => {
      const isResolved = resolves[key];
      const changes = lastSchemaChange.change[key];
      // return if resolved or no changes
      if (isResolved || !changes) return result;

      // Mapping with affected models and columns and affected calculated fields and relationships data into schema change
      const affecteds = schemaDetector.getAffectedResources(changes, {
        models,
        modelColumns,
        modelRelationships,
      });

      const affectedChanges = affecteds.length ? affecteds : null;
      return { ...result, [key]: affectedChanges };
    }, {});

    const result = {
      ...unresolvedChanges,
      lastSchemaChangeTime: lastSchemaChange.createdAt,
    };
    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      payloadJson: {
        operation: 'get_schema_change',
      },
    });
    return result;
  }

  public async triggerDataSourceDetection(
    _root: any,
    _arg: any,
    ctx: IContext,
  ) {
    const project = await this.getActiveRuntimeProjectOrThrow(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    const eventName = TelemetryEvent.MODELING_DETECT_SCHEMA_CHANGE;
    try {
      const hasSchemaChange = await schemaDetector.detectSchemaChange();
      ctx.telemetry.sendEvent(eventName, { hasSchemaChange });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'project',
        resourceId: project.id,
        payloadJson: {
          operation: 'trigger_data_source_detection',
          hasSchemaChange,
        },
      });
      return hasSchemaChange;
    } catch (error: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
  }

  public async resolveSchemaChange(
    _root: any,
    arg: { where: { type: SchemaChangeType } },
    ctx: IContext,
  ) {
    const { type } = arg.where;
    const project = await this.getActiveRuntimeProjectOrThrow(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const schemaDetector = new DataSourceSchemaDetector({
      ctx,
      projectId: project.id,
    });
    const eventName = TelemetryEvent.MODELING_RESOLVE_SCHEMA_CHANGE;
    try {
      await schemaDetector.resolveSchemaChange(type);
      ctx.telemetry.sendEvent(eventName, { type });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'project',
        resourceId: project.id,
        payloadJson: {
          operation: 'resolve_schema_change',
          type,
        },
      });
    } catch (error: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { type, error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
    return true;
  }

  private async createProjectFromDataSource(
    dataSource: DataSource,
    ctx: IContext,
  ): Promise<Project> {
    const { type, properties } = dataSource;
    // Currently only can create one project
    await this.resetCurrentProject(null, null, ctx);

    const { displayName, ...connectionInfo } = properties;
    const project = await ctx.projectService.createProject({
      displayName,
      type,
      connectionInfo,
    } as ProjectData);
    logger.debug(`Project created.`);

    // init dashboard
    logger.debug('Dashboard init...');
    await ctx.dashboardService.initDashboard(project.id, {
      knowledgeBaseId: ctx.runtimeScope?.knowledgeBase?.id || null,
      kbSnapshotId: ctx.runtimeScope?.kbSnapshot?.id || null,
      deployHash: ctx.runtimeScope?.deployHash || null,
      createdBy: ctx.runtimeScope?.userId || null,
    });
    logger.debug('Dashboard created.');

    const eventName = TelemetryEvent.CONNECTION_SAVE_DATA_SOURCE;
    const eventProperties = {
      dataSourceType: type,
    };

    // try to connect to the data source
    try {
      // handle duckdb connection
      if (type === DataSourceName.DUCKDB) {
        const duckdbConnectionInfo =
          connectionInfo as Partial<DUCKDB_CONNECTION_INFO>;
        await this.buildDuckDbEnvironment(ctx, {
          initSql: duckdbConnectionInfo.initSql || '',
          extensions: duckdbConnectionInfo.extensions || [],
          configurations: duckdbConnectionInfo.configurations || {},
        });
      } else {
        // handle other data source
        await ctx.projectService.getProjectDataSourceTables(project);
        const version =
          await ctx.projectService.getProjectDataSourceVersion(project);
        await ctx.projectService.updateProject(project.id, {
          version,
        });
        logger.debug(`Data source tables fetched`);
      }
      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
    } catch (err: any) {
      logger.error(
        'Failed to get project tables',
        JSON.stringify(err, null, 2),
      );
      await ctx.projectRepository.deleteOne(project.id);
      ctx.telemetry.sendEvent(
        eventName,
        { eventProperties, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }

    return project;
  }

  private async deploy(ctx: IContext, project: Project) {
    const { manifest } = await ctx.mdlService.makeCurrentModelMDL(project.id);
    const deployRes = await ctx.deployService.deploy(
      manifest,
      this.buildBridgeRuntimeIdentity(ctx, project.id),
      false,
    );

    // only generating for user's data source
    if (project.sampleDataset === null) {
      await ctx.projectService.generateProjectRecommendationQuestions(
        project.id,
        this.getCurrentRuntimeScopeId(ctx),
      );
    }

    if (deployRes.status === 'SUCCESS') {
      const knowledgeBase = await this.resolveActiveRuntimeKnowledgeBase(ctx);
      await syncLatestExecutableKnowledgeBaseSnapshot({
        knowledgeBase,
        knowledgeBaseRepository: ctx.knowledgeBaseRepository,
        kbSnapshotRepository: ctx.kbSnapshotRepository,
        deployLogRepository: ctx.deployRepository,
        deployService: ctx.deployService,
        modelRepository: ctx.modelRepository,
        relationRepository: ctx.relationRepository,
        viewRepository: ctx.viewRepository,
      });
    }

    return deployRes;
  }

  private getCurrentRuntimeScopeId(ctx: IContext) {
    return ctx.runtimeScope?.selector?.runtimeScopeId || null;
  }

  private buildDataSourceSettingsProperties({
    project,
    knowledgeBase,
    generalConnectionInfo,
  }: {
    project: Project;
    knowledgeBase: KnowledgeBase | null;
    generalConnectionInfo: Record<string, any>;
  }) {
    const managedFederatedRuntime = this.isManagedFederatedRuntimeProject(
      project,
      knowledgeBase,
    );

    return {
      displayName:
        managedFederatedRuntime && knowledgeBase?.name
          ? knowledgeBase.name
          : project.displayName,
      ...generalConnectionInfo,
      ...(managedFederatedRuntime
        ? {
            managedFederatedRuntime: true,
            readonlyReason: MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE,
          }
        : {}),
    };
  }

  private isManagedFederatedRuntimeProject(
    project?: Project | null,
    knowledgeBase?: KnowledgeBase | null,
  ) {
    return Boolean(
      project &&
        knowledgeBase?.runtimeProjectId &&
        project.id === knowledgeBase.runtimeProjectId &&
        project.type === DataSourceName.TRINO,
    );
  }

  private async getActiveRuntimeProjectOrThrow(
    ctx: IContext,
  ): Promise<Project> {
    const project = await this.resolveActiveRuntimeProject(ctx);
    if (!project) {
      throw new Error('Active runtime project is required for this operation');
    }

    return project;
  }

  private async resolveActiveRuntimeProject(
    ctx: IContext,
  ): Promise<Project | null> {
    if (!ctx.runtimeScope) {
      return null;
    }

    return await resolveScopedRuntimeProject(
      ctx.runtimeScope,
      ctx.projectService,
    );
  }

  private async resolveActiveRuntimeKnowledgeBase(
    ctx: IContext,
  ): Promise<KnowledgeBase | null> {
    if (!ctx.runtimeScope) {
      return null;
    }

    if (ctx.runtimeScope.knowledgeBase) {
      return ctx.runtimeScope.knowledgeBase;
    }

    const knowledgeBaseId = ctx.runtimeScope.selector?.knowledgeBaseId;
    if (!knowledgeBaseId) {
      return null;
    }

    return await ctx.knowledgeBaseRepository.findOneBy({
      id: knowledgeBaseId,
    });
  }

  private getCurrentPersistedRuntimeIdentity(
    ctx: IContext,
  ): PersistedRuntimeIdentity | null {
    return ctx.runtimeScope
      ? toCanonicalPersistedRuntimeIdentityFromScope(ctx.runtimeScope)
      : null;
  }

  private toAskRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity | null,
  ): AskRuntimeIdentity | null {
    if (!runtimeIdentity) {
      return null;
    }

    return {
      ...(typeof runtimeIdentity.projectId === 'number'
        ? { projectId: runtimeIdentity.projectId }
        : {}),
      ...(runtimeIdentity.workspaceId !== undefined
        ? { workspaceId: runtimeIdentity.workspaceId ?? null }
        : {}),
      ...(runtimeIdentity.knowledgeBaseId !== undefined
        ? { knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null }
        : {}),
      ...(runtimeIdentity.kbSnapshotId !== undefined
        ? { kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null }
        : {}),
      ...(runtimeIdentity.deployHash !== undefined
        ? { deployHash: runtimeIdentity.deployHash ?? null }
        : {}),
      ...(runtimeIdentity.actorUserId !== undefined
        ? { actorUserId: runtimeIdentity.actorUserId ?? null }
        : {}),
    };
  }

  private async assertKnowledgeBaseWriteAccess(ctx: IContext) {
    const { actor, resource } =
      await this.getKnowledgeBaseWriteAuthorizationTarget(ctx);
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource,
    });
  }

  private async assertKnowledgeBaseReadAccess(ctx: IContext) {
    const { actor, resource } =
      await this.getKnowledgeBaseReadAuthorizationTarget(ctx);
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.read',
      resource,
    });
  }

  private async getKnowledgeBaseReadAuthorizationTarget(ctx: IContext) {
    const runtimeIdentity = this.getCurrentPersistedRuntimeIdentity(ctx);
    const workspaceId =
      ctx.runtimeScope?.workspace?.id || runtimeIdentity?.workspaceId || null;
    const knowledgeBase = await this.resolveActiveRuntimeKnowledgeBase(ctx);

    return {
      actor:
        ctx.authorizationActor ||
        buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope),
      resource: {
        resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
        resourceId: knowledgeBase?.id || workspaceId,
        workspaceId,
        attributes: {
          workspaceKind: ctx.runtimeScope?.workspace?.kind || null,
          knowledgeBaseKind: knowledgeBase?.kind || null,
        },
      },
    };
  }

  private async getKnowledgeBaseWriteAuthorizationTarget(ctx: IContext) {
    const runtimeIdentity = this.getCurrentPersistedRuntimeIdentity(ctx);
    const workspaceId =
      ctx.runtimeScope?.workspace?.id || runtimeIdentity?.workspaceId || null;
    const knowledgeBase = await this.resolveActiveRuntimeKnowledgeBase(ctx);

    return {
      actor:
        ctx.authorizationActor ||
        buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope),
      resource: {
        resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
        resourceId: knowledgeBase?.id || workspaceId,
        workspaceId,
        attributes: {
          workspaceKind: ctx.runtimeScope?.workspace?.kind || null,
          knowledgeBaseKind: knowledgeBase?.kind || null,
        },
      },
    };
  }

  private async recordKnowledgeBaseWriteAudit(
    ctx: IContext,
    {
      resourceType,
      resourceId,
      afterJson,
      payloadJson,
    }: {
      resourceType: string;
      resourceId?: string | number | null;
      afterJson?: Record<string, any> | null;
      payloadJson?: Record<string, any> | null;
    },
  ) {
    const { actor, resource } =
      await this.getKnowledgeBaseWriteAuthorizationTarget(ctx);
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: {
        ...resource,
        resourceType,
        resourceId: resourceId ?? resource.resourceId ?? null,
      },
      result: 'succeeded',
      afterJson: afterJson || undefined,
      payloadJson: payloadJson || undefined,
    });
  }

  private async recordKnowledgeBaseReadAudit(
    ctx: IContext,
    {
      resourceType,
      resourceId,
      payloadJson,
    }: {
      resourceType?: string | null;
      resourceId?: string | number | null;
      payloadJson?: Record<string, any> | null;
    },
  ) {
    const { actor, resource } =
      await this.getKnowledgeBaseReadAuthorizationTarget(ctx);
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.read',
      resource: {
        ...resource,
        resourceType: resourceType || resource.resourceType,
        resourceId: resourceId ?? resource.resourceId ?? null,
      },
      result: 'allowed',
      payloadJson: payloadJson || undefined,
    });
  }

  private buildBridgeRuntimeIdentity(ctx: IContext, bridgeProjectId: number) {
    const runtimeIdentity = this.getCurrentPersistedRuntimeIdentity(ctx);

    if (!runtimeIdentity) {
      return toProjectBridgeRuntimeIdentity(bridgeProjectId);
    }

    return {
      ...runtimeIdentity,
      projectId: bridgeProjectId,
      deployHash: null,
    };
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
        description: relation.description,
      } as RelationData;
    });
    return relationInput;
  }

  private async ensureModelsBelongToProject(
    ctx: IContext,
    modelIds: number[],
    projectId: number,
  ) {
    const uniqueModelIds = [...new Set(modelIds)];
    const models = await ctx.modelRepository.findAllByIds(uniqueModelIds);
    if (
      models.length !== uniqueModelIds.length ||
      models.some((model) => model.projectId !== projectId)
    ) {
      throw new Error('Relation model not found in active project');
    }
  }

  private async overwriteModelsAndColumns(
    tables: string[],
    ctx: IContext,
    project: Project,
  ) {
    // delete existing models and columns
    await ctx.modelService.deleteAllModelsByProjectId(project.id);

    const compactTables: CompactTable[] =
      await ctx.projectService.getProjectDataSourceTables(project);

    const selectedTables = compactTables.filter((table) =>
      tables.includes(table.name),
    );

    // create models
    const modelValues = selectedTables.map((table) => {
      const properties = table?.properties;
      // compactTable contain schema and catalog, these information are for building tableReference in mdl
      const model = {
        projectId: project.id,
        displayName: table.name, // use table name as displayName, referenceName and tableName
        referenceName: replaceInvalidReferenceName(table.name),
        sourceTableName: table.name,
        cached: false,
        refreshTime: null,
        properties: properties ? JSON.stringify(properties) : null,
      } as Partial<Model>;
      return model;
    });
    const models = await ctx.modelRepository.createMany(modelValues);

    // create columns
    const columnValues = selectedTables.flatMap((table) => {
      const compactColumns = table.columns;
      const primaryKey = table.primaryKey;
      const model = models.find((m) => m.sourceTableName === table.name);
      if (!model) {
        return [];
      }
      return compactColumns.map(
        (column) =>
          ({
            modelId: model.id,
            isCalculated: false,
            displayName: column.name,
            referenceName: transformInvalidColumnName(column.name),
            sourceColumnName: column.name,
            type: column.type || 'string',
            notNull: column.notNull || false,
            isPk: primaryKey === column.name,
            properties: column.properties
              ? JSON.stringify(column.properties)
              : null,
          }) as Partial<ModelColumn>,
      );
    });
    const columns = await ctx.modelColumnRepository.createMany(columnValues);

    // create nested columns
    const compactColumns = selectedTables.flatMap((table) => table.columns);
    const nestedColumnValues = compactColumns.flatMap((compactColumn) => {
      const column = columns.find(
        (c) => c.sourceColumnName === compactColumn.name,
      );
      if (!column) {
        return [];
      }
      return handleNestedColumns(compactColumn, {
        modelId: column.modelId,
        columnId: column.id,
        sourceColumnName: column.sourceColumnName,
      });
    });
    await ctx.modelNestedColumnRepository.createMany(nestedColumnValues);

    return { models, columns };
  }

  private concatInitSql(initSql: string, extensions: string[]) {
    const installExtensions = extensions
      .map((ext) => `INSTALL ${ext};`)
      .join('\n');
    return trim(`${installExtensions}\n${initSql}`);
  }

  private async buildDuckDbEnvironment(
    ctx: IContext,
    options: {
      initSql: string;
      extensions: string[];
      configurations: Record<string, any>;
    },
  ): Promise<void> {
    const { initSql, extensions, configurations } = options;
    const initSqlWithExtensions = this.concatInitSql(initSql, extensions);
    await ctx.wrenEngineAdaptor.prepareDuckDB({
      sessionProps: configurations,
      initSql: initSqlWithExtensions,
    } as DuckDBPrepareOptions);

    // check can list dataset table
    await ctx.wrenEngineAdaptor.listTables();

    // patch wren-engine config
    const config = {
      'wren.datasource.type': 'duckdb',
    };
    await ctx.wrenEngineAdaptor.patchConfig(config);
  }
}
