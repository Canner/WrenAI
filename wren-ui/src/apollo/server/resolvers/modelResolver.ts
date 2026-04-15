import {
  CreateModelData,
  UpdateModelData,
  UpdateModelMetadataInput,
  CreateCalculatedFieldData,
  UpdateCalculatedFieldData,
  UpdateViewMetadataInput,
  PreviewSQLData,
} from '../models';
import {
  DataSourceName,
  IContext,
  RelationData,
  UpdateRelationData,
} from '../types';
import { getLogger, transformInvalidColumnName } from '@server/utils';
import { DeployResponse } from '../services/deployService';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import { isEmpty, isNil } from 'lodash';
import { replaceAllowableSyntax } from '../utils/regex';
import { Model, ModelColumn, Relation, View } from '../repositories';
import {
  findColumnsToUpdate,
  getPreviewColumnsStr,
  handleNestedColumns,
  replaceInvalidReferenceName,
  updateModelPrimaryKey,
} from '../utils/model';
import { CompactTable, PreviewDataResponse } from '@server/services';
import { TelemetryEvent } from '../telemetry/telemetry';
import { PersistedRuntimeIdentity } from '../context/runtimeScope';
import {
  assertLatestExecutableRuntimeScope,
  resolveRuntimeExecutionContext,
  resolveRuntimeProject,
} from '../utils/runtimeExecutionContext';
import { syncLatestExecutableKnowledgeBaseSnapshot } from '../utils/knowledgeBaseRuntime';
import * as Errors from '../utils/error';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';
import {
  hasCanonicalRuntimeIdentity,
  normalizeCanonicalPersistedRuntimeIdentity,
  resolvePersistedProjectBridgeId,
  toCanonicalPersistedRuntimeIdentityFromScope,
  toPersistedRuntimeIdentityPatch,
} from '../utils/persistedRuntimeIdentity';

const logger = getLogger('ModelResolver');
logger.level = 'debug';

const parseJsonObject = (value?: string | null): Record<string, any> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

type ViewMetadataColumn = {
  name: string;
  properties?: Record<string, any>;
};

type ViewMetadataProperties = Record<string, any> & {
  columns?: ViewMetadataColumn[];
};

export enum SyncStatusEnum {
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCRONIZED = 'SYNCRONIZED',
  UNSYNCRONIZED = 'UNSYNCRONIZED',
}

export class ModelResolver {
  constructor() {
    // model & model column
    this.listModels = this.listModels.bind(this);
    this.getModel = this.getModel.bind(this);
    this.createModel = this.createModel.bind(this);
    this.updateModel = this.updateModel.bind(this);
    this.deleteModel = this.deleteModel.bind(this);
    this.updateModelMetadata = this.updateModelMetadata.bind(this);
    this.deploy = this.deploy.bind(this);
    this.getMDL = this.getMDL.bind(this);
    this.checkModelSync = this.checkModelSync.bind(this);

    // view
    this.listViews = this.listViews.bind(this);
    this.getView = this.getView.bind(this);
    this.validateView = this.validateView.bind(this);
    this.createView = this.createView.bind(this);
    this.deleteView = this.deleteView.bind(this);
    this.updateViewMetadata = this.updateViewMetadata.bind(this);

    // preview
    this.previewModelData = this.previewModelData.bind(this);
    this.previewViewData = this.previewViewData.bind(this);
    this.previewSql = this.previewSql.bind(this);
    this.getNativeSql = this.getNativeSql.bind(this);

    // calculated field
    this.createCalculatedField = this.createCalculatedField.bind(this);
    this.validateCalculatedField = this.validateCalculatedField.bind(this);
    this.updateCalculatedField = this.updateCalculatedField.bind(this);
    this.deleteCalculatedField = this.deleteCalculatedField.bind(this);

    // relation
    this.createRelation = this.createRelation.bind(this);
    this.updateRelation = this.updateRelation.bind(this);
    this.deleteRelation = this.deleteRelation.bind(this);
  }

  public async createRelation(
    _root: any,
    args: { data: RelationData },
    ctx: IContext,
  ) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { data } = args;
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    await this.ensureModelsScope(ctx, [data.fromModelId, data.toModelId]);

    const eventName = TelemetryEvent.MODELING_CREATE_RELATION;
    try {
      const relation = await ctx.modelService.createRelationByRuntimeIdentity(
        runtimeIdentity,
        data,
      );
      ctx.telemetry.sendEvent(eventName, { data });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'relation',
        resourceId: relation?.id ?? null,
        afterJson: relation as any,
        payloadJson: {
          operation: 'create_relation',
        },
      });
      return relation;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async updateRelation(
    _root: any,
    args: { data: UpdateRelationData; where: { id: number } },
    ctx: IContext,
  ) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { data, where } = args;
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    await this.ensureRelationScope(ctx, where.id);
    const eventName = TelemetryEvent.MODELING_UPDATE_RELATION;
    try {
      const relation = await ctx.modelService.updateRelationByRuntimeIdentity(
        runtimeIdentity,
        data,
        where.id,
      );
      ctx.telemetry.sendEvent(eventName, { data });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'relation',
        resourceId: where.id,
        afterJson: relation as any,
        payloadJson: {
          operation: 'update_relation',
        },
      });
      return relation;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async deleteRelation(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const relationId = args.where.id;
    await this.ensureRelationScope(ctx, relationId);
    await ctx.modelService.deleteRelationByRuntimeIdentity(
      runtimeIdentity,
      relationId,
    );
    await this.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'relation',
      resourceId: relationId,
      payloadJson: {
        operation: 'delete_relation',
      },
    });
    return true;
  }

  public async createCalculatedField(
    _root: any,
    _args: { data: CreateCalculatedFieldData },
    ctx: IContext,
  ) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    await this.ensureModelScope(ctx, _args.data.modelId);
    const eventName = TelemetryEvent.MODELING_CREATE_CF;
    try {
      const column =
        await ctx.modelService.createCalculatedFieldByRuntimeIdentity(
          runtimeIdentity,
          _args.data,
        );
      ctx.telemetry.sendEvent(eventName, { data: _args.data });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'calculated_field',
        resourceId: column?.id ?? null,
        afterJson: column as any,
        payloadJson: {
          operation: 'create_calculated_field',
        },
      });
      return column;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: _args.data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async validateCalculatedField(_root: any, args: any, ctx: IContext) {
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { name, modelId, columnId } = args.data;
    await this.ensureModelScope(ctx, modelId);
    if (!isNil(columnId)) {
      await this.ensureColumnScope(ctx, columnId);
    }
    return await ctx.modelService.validateCalculatedFieldNaming(
      name,
      modelId,
      columnId,
    );
  }

  public async updateCalculatedField(
    _root: any,
    _args: { data: UpdateCalculatedFieldData; where: { id: number } },
    ctx: IContext,
  ) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { data, where } = _args;
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const column = await this.ensureColumnScope(
      ctx,
      where.id,
      'Calculated field not found',
    );
    if (!column.isCalculated) {
      throw new Error('Calculated field not found');
    }

    const eventName = TelemetryEvent.MODELING_UPDATE_CF;
    try {
      const column =
        await ctx.modelService.updateCalculatedFieldByRuntimeIdentity(
          runtimeIdentity,
          data,
          where.id,
        );
      ctx.telemetry.sendEvent(eventName, { data });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'calculated_field',
        resourceId: where.id,
        afterJson: column as any,
        payloadJson: {
          operation: 'update_calculated_field',
        },
      });
      return column;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async deleteCalculatedField(_root: any, args: any, ctx: IContext) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const columnId = args.where.id;
    const column = await this.ensureColumnScope(
      ctx,
      columnId,
      'Calculated field not found',
    );
    if (!column.isCalculated) {
      throw new Error('Calculated field not found');
    }
    await ctx.modelColumnRepository.deleteOne(columnId);
    await this.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'calculated_field',
      resourceId: columnId,
      payloadJson: {
        operation: 'delete_calculated_field',
      },
    });
    return true;
  }

  public async checkModelSync(_root: any, _args: any, ctx: IContext) {
    await this.assertKnowledgeBaseReadAccess(ctx);
    const runtimeIdentity = this.getCurrentRuntimeIdentity(ctx);
    const { manifest, project } =
      await ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity(
        runtimeIdentity,
      );
    const currentHash = ctx.deployService.createMDLHashByRuntimeIdentity(
      manifest,
      runtimeIdentity,
      project.id,
    );
    const lastDeploy =
      await ctx.deployService.getLastDeploymentByRuntimeIdentity(
        runtimeIdentity,
      );
    const lastDeployHash = lastDeploy?.hash;
    const inProgressDeployment =
      await ctx.deployService.getInProgressDeploymentByRuntimeIdentity(
        runtimeIdentity,
      );
    if (inProgressDeployment) {
      await this.recordKnowledgeBaseReadAudit(ctx, {
        resourceType: 'project',
        resourceId: project.id,
        payloadJson: {
          operation: 'check_model_sync',
        },
      });
      return { status: SyncStatusEnum.IN_PROGRESS };
    }
    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'project',
      resourceId: project.id,
      payloadJson: {
        operation: 'check_model_sync',
      },
    });
    return currentHash == lastDeployHash
      ? { status: SyncStatusEnum.SYNCRONIZED }
      : { status: SyncStatusEnum.UNSYNCRONIZED };
  }

  public async deploy(
    _root: any,
    args: { force: boolean },
    ctx: IContext,
  ): Promise<DeployResponse> {
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const mdlResult =
      await ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity(
        runtimeIdentity,
      );
    const project =
      mdlResult.project ||
      (await this.getRuntimeProject(
        ctx,
        this.resolveBridgeProjectIdFallback(runtimeIdentity),
      ));
    const resolvedProjectId = project.id;
    if (!project.version && project.type !== DataSourceName.DUCKDB) {
      const version =
        await ctx.projectService.getProjectDataSourceVersion(project);
      await ctx.projectService.updateProject(resolvedProjectId, {
        version,
      });
    }
    const { manifest } = mdlResult;
    const deployRes = await ctx.deployService.deploy(
      manifest,
      {
        ...runtimeIdentity,
        projectId: resolvedProjectId,
      },
      args.force,
    );

    if (deployRes.status === 'SUCCESS') {
      const knowledgeBaseId =
        ctx.runtimeScope?.knowledgeBase?.id || runtimeIdentity.knowledgeBaseId;
      const knowledgeBase = knowledgeBaseId
        ? await ctx.knowledgeBaseRepository.findOneBy({ id: knowledgeBaseId })
        : null;
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

    // only generating for user's data source
    if (project.sampleDataset === null) {
      await ctx.projectService.generateProjectRecommendationQuestions(
        resolvedProjectId,
        this.getCurrentRuntimeScopeId(ctx),
      );
    }
    await this.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'project',
      resourceId: resolvedProjectId,
      afterJson: deployRes as any,
      payloadJson: {
        operation: 'deploy',
      },
    });
    return deployRes;
  }

  public async getMDL(_root: any, args: { hash: string }, ctx: IContext) {
    await this.assertKnowledgeBaseReadAccess(ctx);
    const mdl = await ctx.deployService.getMDLByHash(args.hash);
    await this.recordKnowledgeBaseReadAudit(ctx, {
      payloadJson: {
        operation: 'get_mdl',
        hash: args.hash,
      },
    });
    return {
      hash: args.hash,
      mdl,
    };
  }

  public async listModels(_root: any, _args: any, ctx: IContext) {
    await this.assertKnowledgeBaseReadAccess(ctx);
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const models =
      await ctx.modelService.listModelsByRuntimeIdentity(runtimeIdentity);
    const modelIds = models.map((m) => m.id);
    const modelColumnList =
      await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
    const modelNestedColumnList =
      await ctx.modelNestedColumnRepository.findNestedColumnsByModelIds(
        modelIds,
      );
    const result = [];
    for (const model of models) {
      const modelFields = modelColumnList
        .filter((c) => c.modelId === model.id)
        .map((c) => ({
          ...c,
          properties: parseJsonObject(c.properties),
          nestedColumns: c.type.includes('STRUCT')
            ? modelNestedColumnList.filter((nc) => nc.columnId === c.id)
            : undefined,
        }));
      const fields = modelFields.filter((c) => !c.isCalculated);
      const calculatedFields = modelFields.filter((c) => c.isCalculated);
      result.push({
        ...model,
        fields,
        calculatedFields,
        properties: {
          ...parseJsonObject(model.properties),
        },
      });
    }
    await this.recordKnowledgeBaseReadAudit(ctx, {
      payloadJson: {
        operation: 'list_models',
      },
    });
    return result;
  }

  public async getModel(_root: any, args: any, ctx: IContext) {
    await this.assertKnowledgeBaseReadAccess(ctx);
    const modelId = args.where.id;
    const model = await this.ensureModelScope(ctx, modelId);

    const modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds([
      model.id,
    ]);
    const modelNestedColumns = await ctx.modelNestedColumnRepository.findAllBy({
      modelId: model.id,
    });

    const columns = modelColumns.map((c) => ({
      ...c,
      properties: parseJsonObject(c.properties),
      nestedColumns: c.type.includes('STRUCT')
        ? modelNestedColumns.filter((nc) => nc.columnId === c.id)
        : undefined,
    }));
    const relations = (
      await ctx.relationRepository.findRelationsBy({
        columnIds: modelColumns.map((c) => c.id),
      })
    ).map((r) => ({
      ...r,
      type: r.joinType,
      properties: r.properties ? JSON.parse(r.properties) : {},
    }));

    const result = {
      ...model,
      fields: columns.filter((c) => !c.isCalculated),
      calculatedFields: columns.filter((c) => c.isCalculated),
      relations,
      properties: {
        ...parseJsonObject(model.properties),
      },
    };
    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'model',
      resourceId: model.id,
      payloadJson: {
        operation: 'get_model',
      },
    });
    return result;
  }

  public async createModel(
    _root: any,
    args: { data: CreateModelData },
    ctx: IContext,
  ) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { sourceTableName, fields, primaryKey } = args.data;
    try {
      const model = await this.handleCreateModel(
        ctx,
        sourceTableName,
        fields,
        primaryKey,
      );
      ctx.telemetry.sendEvent(TelemetryEvent.MODELING_CREATE_MODEL, {
        data: args.data,
      });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'model',
        resourceId: model?.id ?? null,
        afterJson: model as any,
        payloadJson: {
          operation: 'create_model',
        },
      });
      return model;
    } catch (error: any) {
      ctx.telemetry.sendEvent(
        TelemetryEvent.MODELING_CREATE_MODEL,
        { data: args.data, error },
        error.extensions?.service,
        false,
      );
      throw error;
    }
  }

  private async handleCreateModel(
    ctx: IContext,
    sourceTableName: string,
    fields: [string],
    primaryKey: string,
  ) {
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const project = await this.getRuntimeProject(
      ctx,
      this.resolveBridgeProjectIdFallback(runtimeIdentity),
    );
    const dataSourceTables =
      await ctx.projectService.getProjectDataSourceTables(project);
    this.validateTableExist(sourceTableName, dataSourceTables);
    this.validateColumnsExist(sourceTableName, fields, dataSourceTables);

    // create model
    const dataSourceTable = dataSourceTables.find(
      (table) => table.name === sourceTableName,
    );
    if (!dataSourceTable) {
      throw new Error('Table not found in the data source');
    }
    const properties = dataSourceTable?.properties;
    const modelValue = {
      ...this.buildPersistedRuntimeIdentityPayload(runtimeIdentity, {
        projectId: project.id,
      }),
      displayName: sourceTableName, //use table name as displayName, referenceName and tableName
      referenceName: replaceInvalidReferenceName(sourceTableName),
      sourceTableName: sourceTableName,
      cached: false,
      refreshTime: null,
      properties: properties ? JSON.stringify(properties) : null,
    } as Partial<Model>;
    const model = await ctx.modelRepository.createOne(modelValue);

    // create columns
    const compactColumns = dataSourceTable.columns.filter((c) =>
      fields.includes(c.name),
    );
    const columnValues = compactColumns.map(
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
    const columns = await ctx.modelColumnRepository.createMany(columnValues);

    // create nested columns
    const nestedColumnValues = compactColumns.flatMap((compactColumn) => {
      const column = columns.find(
        (c) => c.sourceColumnName === compactColumn.name,
      );
      if (!column) return [];
      return handleNestedColumns(compactColumn, {
        modelId: column.modelId,
        columnId: column.id,
        sourceColumnName: column.sourceColumnName,
      });
    });
    await ctx.modelNestedColumnRepository.createMany(nestedColumnValues);
    logger.info(`Model created: ${JSON.stringify(model)}`);

    return model;
  }

  public async updateModel(
    _root: any,
    args: { data: UpdateModelData; where: { id: number } },
    ctx: IContext,
  ) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { fields, primaryKey } = args.data;
    try {
      const model = await this.handleUpdateModel(ctx, args, fields, primaryKey);
      ctx.telemetry.sendEvent(TelemetryEvent.MODELING_UPDATE_MODEL, {
        data: args.data,
      });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'model',
        resourceId: args.where.id,
        afterJson: model as any,
        payloadJson: {
          operation: 'update_model',
        },
      });
      return model;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        TelemetryEvent.MODELING_UPDATE_MODEL,
        { data: args.data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  private async handleUpdateModel(
    ctx: IContext,
    args: { data: UpdateModelData; where: { id: number } },
    fields: [string],
    primaryKey: string,
  ) {
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const project = await this.getRuntimeProject(
      ctx,
      this.resolveBridgeProjectIdFallback(runtimeIdentity),
    );
    const dataSourceTables =
      await ctx.projectService.getProjectDataSourceTables(project);
    const model = await this.ensureModelScope(ctx, args.where.id);
    const existingColumns = await ctx.modelColumnRepository.findAllBy({
      modelId: model.id,
      isCalculated: false,
    });
    const { sourceTableName } = model;
    this.validateTableExist(sourceTableName, dataSourceTables);
    this.validateColumnsExist(sourceTableName, fields, dataSourceTables);

    const sourceTableColumns =
      dataSourceTables.find((table) => table.name === sourceTableName)
        ?.columns ?? [];
    const { toDeleteColumnIds, toCreateColumns, toUpdateColumns } =
      findColumnsToUpdate(fields, existingColumns, sourceTableColumns);
    await updateModelPrimaryKey(
      ctx.modelColumnRepository,
      model.id,
      primaryKey,
    );

    // delete columns
    if (toDeleteColumnIds.length) {
      await ctx.modelColumnRepository.deleteMany(toDeleteColumnIds);
    }

    // create columns
    if (toCreateColumns.length) {
      const compactColumns = sourceTableColumns.filter((sourceColumn) =>
        toCreateColumns.includes(sourceColumn.name),
      );
      const columnValues = compactColumns.map((column) => {
        const columnValue = {
          modelId: model.id,
          isCalculated: false,
          displayName: column.name,
          sourceColumnName: column.name,
          referenceName: transformInvalidColumnName(column.name),
          type: column.type || 'string',
          notNull: column.notNull,
          isPk: primaryKey === column.name,
          properties: column.properties
            ? JSON.stringify(column.properties)
            : null,
        } as Partial<ModelColumn>;
        return columnValue;
      });
      const columns = await ctx.modelColumnRepository.createMany(columnValues);

      // create nested columns
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
    }

    // update columns
    if (toUpdateColumns.length) {
      for (const { id, sourceColumnName, type } of toUpdateColumns) {
        const column = await ctx.modelColumnRepository.updateOne(id, { type });

        // if the struct type is changed, need to re-create nested columns
        if (type.includes('STRUCT')) {
          const sourceColumn = sourceTableColumns.find(
            (sourceColumn) => sourceColumn.name === sourceColumnName,
          );
          if (!sourceColumn) {
            continue;
          }
          await ctx.modelNestedColumnRepository.deleteAllBy({
            columnId: column.id,
          });
          await ctx.modelNestedColumnRepository.createMany(
            handleNestedColumns(sourceColumn, {
              modelId: column.modelId,
              columnId: column.id,
              sourceColumnName: sourceColumnName,
            }),
          );
        }
      }
    }

    logger.info(`Model updated: ${JSON.stringify(model)}`);
    return model;
  }

  // delete model
  public async deleteModel(_root: any, args: any, ctx: IContext) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const modelId = args.where.id;
    await this.ensureModelScope(ctx, modelId);

    // related columns and relationships will be deleted in cascade
    await ctx.modelRepository.deleteOne(modelId);
    await this.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'model',
      resourceId: modelId,
      payloadJson: {
        operation: 'delete_model',
      },
    });
    return true;
  }

  // update model metadata
  public async updateModelMetadata(
    _root: any,
    args: { where: { id: number }; data: UpdateModelMetadataInput },
    ctx: IContext,
  ): Promise<boolean> {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const modelId = args.where.id;
    const data = args.data;

    const model = await this.ensureModelScope(ctx, modelId);
    const eventName = TelemetryEvent.MODELING_UPDATE_MODEL_METADATA;
    try {
      // update model metadata
      await this.handleUpdateModelMetadata(data, model, ctx, modelId);

      // todo: considering using update ... from statement to do a batch update
      // update column metadata
      if (!isEmpty(data.columns)) {
        // find the columns that match the user requested columns
        await this.handleUpdateColumnMetadata(data, ctx);
      }

      // update nested column metadata
      if (!isEmpty(data.nestedColumns)) {
        await this.handleUpdateNestedColumnMetadata(data, ctx);
      }

      // update calculated field metadata
      if (!isEmpty(data.calculatedFields)) {
        await this.handleUpdateCFMetadata(data, ctx);
      }

      // update relationship metadata
      if (!isEmpty(data.relationships)) {
        await this.handleUpdateRelationshipMetadata(data, ctx);
      }

      ctx.telemetry.sendEvent(eventName, { data });
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'model',
        resourceId: modelId,
        payloadJson: {
          operation: 'update_model_metadata',
        },
      });
      return true;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data: data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  private async handleUpdateModelMetadata(
    data: UpdateModelMetadataInput,
    model: Model,
    ctx: IContext,
    modelId: number,
  ) {
    const modelMetadata: any = {};

    // if displayName is not null, or undefined, update the displayName
    if (!isNil(data.displayName)) {
      modelMetadata.displayName = this.determineMetadataValue(data.displayName);
    }

    // if description is not null, or undefined, update the description in properties
    if (!isNil(data.description)) {
      const properties = isNil(model.properties)
        ? {}
        : JSON.parse(model.properties);

      properties.description = this.determineMetadataValue(data.description);
      modelMetadata.properties = JSON.stringify(properties);
    }

    if (!isEmpty(modelMetadata)) {
      await ctx.modelRepository.updateOne(modelId, modelMetadata);
    }
  }

  private async handleUpdateRelationshipMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
  ) {
    const relationshipIds = data.relationships.map((r) => r.id);
    const relationships =
      await ctx.relationRepository.findRelationsByIds(relationshipIds);
    for (const rel of relationships) {
      const requestedMetadata = data.relationships.find((r) => r.id === rel.id);
      if (!requestedMetadata) {
        continue;
      }

      const relationMetadata: any = {};

      if (!isNil(requestedMetadata.description)) {
        const properties = rel.properties ? JSON.parse(rel.properties) : {};
        properties.description = this.determineMetadataValue(
          requestedMetadata.description,
        );
        relationMetadata.properties = JSON.stringify(properties);
      }

      if (!isEmpty(relationMetadata)) {
        await ctx.relationRepository.updateOne(rel.id, relationMetadata);
      }
    }
  }

  private async handleUpdateCFMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
  ) {
    const calculatedFieldIds = data.calculatedFields.map((c) => c.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByIds(calculatedFieldIds);
    for (const col of modelColumns) {
      const requestedMetadata = data.calculatedFields.find(
        (c) => c.id === col.id,
      );
      if (!requestedMetadata) {
        continue;
      }

      const columnMetadata: any = {};
      // check if description is empty
      // if description is empty, skip the update
      // if description is not empty, update the description in properties
      if (!isNil(requestedMetadata.description)) {
        const properties = col.properties ? JSON.parse(col.properties) : {};
        properties.description = this.determineMetadataValue(
          requestedMetadata.description,
        );
        columnMetadata.properties = JSON.stringify(properties);
      }

      if (!isEmpty(columnMetadata)) {
        await ctx.modelColumnRepository.updateOne(col.id, columnMetadata);
      }
    }
  }

  private async handleUpdateColumnMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
  ) {
    const columnIds = data.columns.map((c) => c.id);
    const modelColumns =
      await ctx.modelColumnRepository.findColumnsByIds(columnIds);
    for (const col of modelColumns) {
      const requestedMetadata = data.columns.find((c) => c.id === col.id);
      if (!requestedMetadata) {
        continue;
      }

      // update metadata
      const columnMetadata: any = {};

      if (!isNil(requestedMetadata.displayName)) {
        columnMetadata.displayName = this.determineMetadataValue(
          requestedMetadata.displayName,
        );
      }

      if (!isNil(requestedMetadata.description)) {
        const properties = col.properties ? JSON.parse(col.properties) : {};
        properties.description = this.determineMetadataValue(
          requestedMetadata.description,
        );
        columnMetadata.properties = JSON.stringify(properties);
      }

      if (!isEmpty(columnMetadata)) {
        await ctx.modelColumnRepository.updateOne(col.id, columnMetadata);
      }
    }
  }

  private async handleUpdateNestedColumnMetadata(
    data: UpdateModelMetadataInput,
    ctx: IContext,
  ) {
    const nestedColumnIds = data.nestedColumns.map((nc) => nc.id);
    const modelNestedColumns =
      await ctx.modelNestedColumnRepository.findNestedColumnsByIds(
        nestedColumnIds,
      );
    for (const col of modelNestedColumns) {
      const requestedMetadata = data.nestedColumns.find((c) => c.id === col.id);
      if (!requestedMetadata) {
        continue;
      }

      const nestedColumnMetadata: any = {};

      if (!isNil(requestedMetadata.displayName)) {
        nestedColumnMetadata.displayName = this.determineMetadataValue(
          requestedMetadata.displayName,
        );
      }

      if (!isNil(requestedMetadata.description)) {
        nestedColumnMetadata.properties = {
          ...col.properties,
          description: this.determineMetadataValue(
            requestedMetadata.description,
          ),
        };
      }

      if (!isEmpty(nestedColumnMetadata)) {
        await ctx.modelNestedColumnRepository.updateOne(
          col.id,
          nestedColumnMetadata,
        );
      }
    }
  }

  // list views
  public async listViews(_root: any, _args: any, ctx: IContext) {
    await this.assertKnowledgeBaseReadAccess(ctx);
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const views =
      await ctx.modelService.getViewsByRuntimeIdentity(runtimeIdentity);
    const result = views.map((view) => ({
      ...view,
      displayName: parseJsonObject(view.properties)?.displayName ?? view.name,
    }));
    await this.recordKnowledgeBaseReadAudit(ctx, {
      payloadJson: {
        operation: 'list_views',
      },
    });
    return result;
  }

  public async getView(_root: any, args: any, ctx: IContext) {
    await this.assertKnowledgeBaseReadAccess(ctx);
    const viewId = args.where.id;
    const view = await this.ensureViewScope(ctx, viewId);
    const displayName =
      parseJsonObject(view.properties)?.displayName ?? view.name;
    const result = { ...view, displayName };
    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'view',
      resourceId: view.id,
      payloadJson: {
        operation: 'get_view',
      },
    });
    return result;
  }

  // validate a view name
  public async validateView(_root: any, args: any, ctx: IContext) {
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { name } = args.data;
    return this.validateViewName(name, ctx);
  }

  // create view from sql of a response
  public async createView(_root: any, args: any, ctx: IContext) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const { name: displayName, responseId, rephrasedQuestion } = args.data;
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    await ctx.askingService.assertResponseScope(responseId, runtimeIdentity);

    // validate view name
    const validateResult = await this.validateViewName(
      displayName,
      ctx,
      undefined,
    );
    if (!validateResult.valid) {
      throw new Error(validateResult.message);
    }

    // get sql statement of a response
    const response = await ctx.askingService.getResponseScoped(
      responseId,
      runtimeIdentity,
    );
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }
    if (!response.sql) {
      throw new Error(`Thread response ${responseId} has no SQL`);
    }
    const { project, manifest } = await this.getResponseExecutionContext(
      ctx,
      this.toExecutionRuntimeIdentitySource({
        bridgeProjectId: response.projectId ?? null,
        deployHash: response.deployHash ?? null,
      }),
    );

    // construct cte sql and format it
    const statement = safeFormatSQL(response.sql);

    // describe columns
    const { columns } = await ctx.queryService.describeStatement(statement, {
      project,
      limit: 1,
      modelingOnly: false,
      manifest,
    });

    if (isEmpty(columns)) {
      throw new Error('Failed to describe statement');
    }

    // properties
    const properties = {
      displayName,
      columns,

      // properties from the thread response
      responseId, // helpful for mapping back to the thread response
      question: rephrasedQuestion,
    };

    const eventName = TelemetryEvent.HOME_CREATE_VIEW;
    const eventProperties = {
      statement,
      displayName,
    };
    // create view
    try {
      const name = replaceAllowableSyntax(displayName);
      const view = await ctx.viewRepository.createOne({
        ...this.buildPersistedRuntimeIdentityPayload(runtimeIdentity),
        name,
        statement,
        properties: JSON.stringify(properties),
      });

      // telemetry
      ctx.telemetry.sendEvent(eventName, eventProperties);
      await this.recordKnowledgeBaseWriteAudit(ctx, {
        resourceType: 'view',
        resourceId: view?.id ?? null,
        afterJson: { ...view, displayName } as any,
        payloadJson: {
          operation: 'create_view',
        },
      });

      return { ...view, displayName };
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        {
          ...eventProperties,
          error: err,
        },
        err.extensions?.service,
        false,
      );

      throw err;
    }
  }

  // delete view
  public async deleteView(_root: any, args: any, ctx: IContext) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const viewId = args.where.id;
    await this.ensureViewScope(ctx, viewId);
    await ctx.viewRepository.deleteOne(viewId);
    await this.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'view',
      resourceId: viewId,
      payloadJson: {
        operation: 'delete_view',
      },
    });
    return true;
  }

  public async previewModelData(_root: any, args: any, ctx: IContext) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseReadAccess(ctx);
    const modelId = args.where.id;
    const model = await this.ensureModelScope(ctx, modelId);
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const { project, manifest } = await this.getResponseExecutionContext(
      ctx,
      this.toExecutionRuntimeIdentitySource({
        bridgeProjectId: model.projectId ?? null,
        deployHash: model.deployHash ?? runtimeIdentity.deployHash ?? null,
      }),
    );
    const modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds([
      model.id,
    ]);
    const sql = `select ${getPreviewColumnsStr(modelColumns)} from "${model.referenceName}"`;

    const data = (await ctx.queryService.preview(sql, {
      project,
      modelingOnly: false,
      manifest,
    })) as PreviewDataResponse;

    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'model',
      resourceId: model.id,
      payloadJson: {
        operation: 'preview_model_data',
      },
    });
    return data;
  }

  public async previewViewData(_root: any, args: any, ctx: IContext) {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseReadAccess(ctx);
    const { id: viewId, limit } = args.where;
    const view = await this.ensureViewScope(ctx, viewId);
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const { project, manifest } = await this.getResponseExecutionContext(
      ctx,
      this.toExecutionRuntimeIdentitySource({
        bridgeProjectId: view.projectId ?? null,
        deployHash: view.deployHash ?? runtimeIdentity.deployHash ?? null,
      }),
    );

    const data = (await ctx.queryService.preview(view.statement, {
      project,
      limit,
      manifest,
      modelingOnly: false,
    })) as PreviewDataResponse;
    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'view',
      resourceId: view.id,
      payloadJson: {
        operation: 'preview_view_data',
      },
    });
    return data;
  }

  // Notice: this is used by AI service.
  // any change to this resolver should be synced with AI service.
  public async previewSql(
    _root: any,
    args: { data: PreviewSQLData },
    ctx: IContext,
  ) {
    const { sql, limit, dryRun, runtimeScopeId } = args.data;
    const runtimeScope = runtimeScopeId
      ? await ctx.runtimeScopeResolver.resolveRuntimeScopeId(runtimeScopeId)
      : ctx.runtimeScope!;
    await this.assertExecutableRuntimeScope(ctx, runtimeScope);
    if (!this.isInternalAiServicePreviewRequest(ctx, runtimeScopeId)) {
      await this.assertKnowledgeBaseReadAccess(ctx, runtimeScope);
    }
    const executionContext = await resolveRuntimeExecutionContext({
      runtimeScope,
      projectService: ctx.projectService,
    });
    if (!executionContext) {
      throw new Error('No deployment found, please deploy your project first');
    }
    const { project, manifest } = executionContext;
    const result = await ctx.queryService.preview(sql, {
      project,
      limit: limit,
      modelingOnly: false,
      manifest,
      dryRun,
    });
    await this.recordKnowledgeBaseReadAudit(ctx, {
      runtimeScope,
      payloadJson: {
        operation: 'preview_sql',
      },
    });
    return result;
  }

  private isInternalAiServicePreviewRequest(
    ctx: IContext,
    runtimeScopeId?: string | null,
  ): boolean {
    if (!runtimeScopeId) {
      return false;
    }

    const internalHeader = (ctx as any)?.req?.headers?.[
      'x-wren-ai-service-internal'
    ] as string | string[] | undefined;

    return Array.isArray(internalHeader)
      ? internalHeader.includes('1')
      : internalHeader === '1';
  }

  public async getNativeSql(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<string> {
    const { responseId } = args;
    await this.assertKnowledgeBaseReadAccess(ctx);
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    await ctx.askingService.assertResponseScope(responseId, runtimeIdentity);

    // get sql statement of a response
    const response = await ctx.askingService.getResponseScoped(
      responseId,
      runtimeIdentity,
    );
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }
    if (!response.sql) {
      throw new Error(`Thread response ${responseId} has no SQL`);
    }
    const { project, manifest } = await this.getResponseExecutionContext(
      ctx,
      this.toExecutionRuntimeIdentitySource({
        bridgeProjectId: response.projectId ?? null,
        deployHash: response.deployHash ?? null,
      }),
    );

    // If using a sample dataset, native SQL is not supported
    if (project.sampleDataset) {
      throw new Error(`Doesn't support Native SQL`);
    }

    // construct cte sql and format it
    let nativeSql: string;
    if (project.type === DataSourceName.DUCKDB) {
      logger.info(`Getting native sql from wren engine`);
      nativeSql = await ctx.wrenEngineAdaptor.getNativeSQL(response.sql, {
        manifest,
        modelingOnly: false,
      });
    } else {
      logger.info(`Getting native sql from ibis server`);
      nativeSql = await ctx.ibisServerAdaptor.getNativeSql({
        dataSource: project.type,
        sql: response.sql,
        mdl: manifest,
      });
    }
    const language = project.type === DataSourceName.MSSQL ? 'tsql' : undefined;
    await this.recordKnowledgeBaseReadAudit(ctx, {
      resourceType: 'thread_response',
      resourceId: responseId,
      payloadJson: {
        operation: 'get_native_sql',
      },
    });
    return safeFormatSQL(nativeSql, { language });
  }

  public async updateViewMetadata(
    _root: any,
    args: { where: { id: number }; data: UpdateViewMetadataInput },
    ctx: IContext,
  ): Promise<boolean> {
    await this.assertExecutableRuntimeScope(ctx);
    await this.assertKnowledgeBaseWriteAccess(ctx);
    const viewId = args.where.id;
    const data = args.data;

    const view = await this.ensureViewScope(ctx, viewId);

    // update view metadata
    const properties = parseJsonObject(
      view.properties,
    ) as ViewMetadataProperties;
    let newName = view.name;
    // if displayName is not null, or undefined, update the displayName
    if (!isNil(data.displayName)) {
      await this.validateViewName(data.displayName, ctx, viewId);
      newName = replaceAllowableSyntax(data.displayName);
      properties.displayName = this.determineMetadataValue(data.displayName);
    }

    // if description is not null, or undefined, update the description in properties
    if (!isNil(data.description)) {
      properties.description = this.determineMetadataValue(data.description);
    }

    // view column metadata
    if (!isEmpty(data.columns)) {
      const viewColumns = Array.isArray(properties.columns)
        ? properties.columns
        : [];
      for (const col of viewColumns) {
        const requestedMetadata = data.columns.find(
          (c) => c.referenceName === col.name,
        );
        if (!requestedMetadata) {
          continue;
        }

        if (!isNil(requestedMetadata.description)) {
          col.properties = col.properties || {};
          col.properties.description = this.determineMetadataValue(
            requestedMetadata.description,
          );
        }
      }

      properties.columns = viewColumns;
    }

    await ctx.viewRepository.updateOne(viewId, {
      name: newName,
      properties: JSON.stringify(properties),
    });
    await this.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'view',
      resourceId: viewId,
      payloadJson: {
        operation: 'update_view_metadata',
      },
      afterJson: {
        name: newName,
      },
    });

    return true;
  }

  private determineMetadataValue(value: string) {
    // if it's empty string, meaning users want to remove the value
    // so we return null
    if (value === '') {
      return null;
    }

    // otherwise, return the value
    return value;
  }

  // validate view name
  private async validateViewName(
    viewDisplayName: string,
    ctx: IContext,
    selfView?: number,
  ): Promise<{ valid: boolean; message?: string }> {
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    return ctx.modelService.validateViewNameByRuntimeIdentity(
      runtimeIdentity,
      viewDisplayName,
      selfView,
    );
  }

  private validateTableExist(
    tableName: string,
    dataSourceTables: CompactTable[],
  ) {
    if (!dataSourceTables.find((c) => c.name === tableName)) {
      throw new Error(`Table ${tableName} not found in the data Source`);
    }
  }

  private validateColumnsExist(
    tableName: string,
    fields: string[],
    dataSourceTables: CompactTable[],
  ) {
    const tableColumns = dataSourceTables.find(
      (c) => c.name === tableName,
    )?.columns;
    const existingColumns = tableColumns ?? [];
    for (const field of fields) {
      if (!existingColumns.find((c) => c.name === field)) {
        throw new Error(
          `Column "${field}" not found in table "${tableName}" in the data Source`,
        );
      }
    }
  }

  private getCurrentRuntimeIdentity(ctx: IContext) {
    return toCanonicalPersistedRuntimeIdentityFromScope(ctx.runtimeScope!);
  }

  private getRuntimeSelection(ctx: IContext) {
    return {
      runtimeIdentity: this.getCurrentRuntimeIdentity(ctx),
    };
  }

  private async assertKnowledgeBaseWriteAccess(ctx: IContext) {
    const { actor, resource } =
      this.getKnowledgeBaseWriteAuthorizationTarget(ctx);
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource,
    });
  }

  private async assertKnowledgeBaseReadAccess(
    ctx: IContext,
    runtimeScope = ctx.runtimeScope!,
  ) {
    const { actor, resource } = this.getKnowledgeBaseReadAuthorizationTarget(
      ctx,
      runtimeScope,
    );
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.read',
      resource,
    });
  }

  private getKnowledgeBaseReadAuthorizationTarget(
    ctx: IContext,
    runtimeScope = ctx.runtimeScope!,
  ) {
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const workspaceId =
      runtimeScope?.workspace?.id || runtimeIdentity.workspaceId || null;
    const knowledgeBase = runtimeScope?.knowledgeBase;

    return {
      actor:
        ctx.authorizationActor ||
        buildAuthorizationActorFromRuntimeScope(runtimeScope),
      resource: {
        resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
        resourceId: knowledgeBase?.id || workspaceId,
        workspaceId,
        attributes: {
          workspaceKind: runtimeScope?.workspace?.kind || null,
          knowledgeBaseKind: knowledgeBase?.kind || null,
        },
      },
    };
  }

  private getKnowledgeBaseWriteAuthorizationTarget(ctx: IContext) {
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const workspaceId =
      ctx.runtimeScope?.workspace?.id || runtimeIdentity.workspaceId || null;
    const knowledgeBase = ctx.runtimeScope?.knowledgeBase;

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
      this.getKnowledgeBaseWriteAuthorizationTarget(ctx);
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
      runtimeScope = ctx.runtimeScope!,
      resourceType,
      resourceId,
      payloadJson,
    }: {
      runtimeScope?: IContext['runtimeScope'];
      resourceType?: string | null;
      resourceId?: string | number | null;
      payloadJson?: Record<string, any> | null;
    },
  ) {
    const { actor, resource } = this.getKnowledgeBaseReadAuthorizationTarget(
      ctx,
      runtimeScope!,
    );
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

  private async assertExecutableRuntimeScope(
    ctx: IContext,
    runtimeScope = ctx.runtimeScope!,
  ) {
    try {
      await assertLatestExecutableRuntimeScope({
        runtimeScope,
        knowledgeBaseRepository: ctx.knowledgeBaseRepository,
        kbSnapshotRepository: ctx.kbSnapshotRepository,
      });
    } catch (error) {
      throw Errors.create(Errors.GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT, {
        customMessage:
          error instanceof Error ? error.message : 'Snapshot outdated',
      });
    }
  }

  private getCurrentRuntimeScopeId(ctx: IContext) {
    return ctx.runtimeScope?.selector?.runtimeScopeId || null;
  }

  private async getRuntimeProject(
    ctx: IContext,
    fallbackBridgeProjectId?: number | null,
  ) {
    const project = await resolveRuntimeProject(
      ctx.runtimeScope!,
      ctx.projectService,
      fallbackBridgeProjectId,
    );
    if (!project) {
      throw new Error('No project found for the active runtime scope');
    }

    return project;
  }

  private toExecutionRuntimeIdentitySource(
    source?: {
      bridgeProjectId?: number | null;
      workspaceId?: string | null;
      knowledgeBaseId?: string | null;
      kbSnapshotId?: string | null;
      deployHash?: string | null;
      actorUserId?: string | null;
    } | null,
  ): Partial<PersistedRuntimeIdentity> | null {
    if (!source) {
      return null;
    }

    const runtimeSource: Partial<PersistedRuntimeIdentity> = {};
    if (Object.prototype.hasOwnProperty.call(source, 'bridgeProjectId')) {
      runtimeSource.projectId = source.bridgeProjectId ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(source, 'workspaceId')) {
      runtimeSource.workspaceId = source.workspaceId ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(source, 'knowledgeBaseId')) {
      runtimeSource.knowledgeBaseId = source.knowledgeBaseId ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(source, 'kbSnapshotId')) {
      runtimeSource.kbSnapshotId = source.kbSnapshotId ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(source, 'deployHash')) {
      runtimeSource.deployHash = source.deployHash ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(source, 'actorUserId')) {
      runtimeSource.actorUserId = source.actorUserId ?? null;
    }

    return runtimeSource;
  }

  private buildExecutionRuntimeIdentity(
    ctx: IContext,
    source?: Partial<PersistedRuntimeIdentity> | null,
  ) {
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const hasField = <K extends keyof PersistedRuntimeIdentity>(field: K) =>
      source != null && Object.prototype.hasOwnProperty.call(source, field);

    return normalizeCanonicalPersistedRuntimeIdentity({
      projectId: hasField('projectId')
        ? source?.projectId ?? null
        : runtimeIdentity.projectId ?? null,
      workspaceId: hasField('workspaceId')
        ? source?.workspaceId ?? null
        : runtimeIdentity.workspaceId ?? null,
      knowledgeBaseId: hasField('knowledgeBaseId')
        ? source?.knowledgeBaseId ?? null
        : runtimeIdentity.knowledgeBaseId ?? null,
      kbSnapshotId: hasField('kbSnapshotId')
        ? source?.kbSnapshotId ?? null
        : runtimeIdentity.kbSnapshotId ?? null,
      deployHash: hasField('deployHash')
        ? source?.deployHash ?? null
        : runtimeIdentity.deployHash ?? null,
      actorUserId: hasField('actorUserId')
        ? source?.actorUserId ?? null
        : runtimeIdentity.actorUserId ?? null,
    });
  }

  private resolveBridgeProjectIdFallback(
    runtimeIdentity: PersistedRuntimeIdentity,
    fallbackBridgeProjectId?: number | null,
  ) {
    if (hasCanonicalRuntimeIdentity(runtimeIdentity)) {
      return null;
    }

    return resolvePersistedProjectBridgeId(
      runtimeIdentity,
      fallbackBridgeProjectId,
    );
  }

  private buildPersistedRuntimeIdentityPayload(
    runtimeIdentity: PersistedRuntimeIdentity,
    overrides?: Partial<PersistedRuntimeIdentity>,
  ) {
    return toPersistedRuntimeIdentityPatch({
      ...runtimeIdentity,
      ...overrides,
      projectId: this.resolveBridgeProjectIdFallback(
        runtimeIdentity,
        overrides?.projectId ?? null,
      ),
    });
  }

  private async getResponseExecutionContext(
    ctx: IContext,
    source?: Partial<PersistedRuntimeIdentity> | null,
  ) {
    const runtimeIdentity = this.buildExecutionRuntimeIdentity(ctx, source);
    const deployment =
      await ctx.deployService.getDeploymentByRuntimeIdentity(runtimeIdentity);
    if (!deployment) {
      throw new Error('No deployment found, please deploy your project first');
    }

    const project = await ctx.projectService.getProjectById(
      deployment.projectId,
    );

    return {
      runtimeIdentity: {
        ...runtimeIdentity,
        projectId: deployment.projectId,
        deployHash: runtimeIdentity.deployHash ?? deployment.hash,
      },
      project,
      deployment,
      manifest: deployment.manifest,
    };
  }

  private async ensureModelsScope(
    ctx: IContext,
    modelIds: number[],
    errorMessage = 'Model not found',
  ): Promise<Model[]> {
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const models = await ctx.modelService.getModelsByRuntimeIdentity(
      runtimeIdentity,
      modelIds,
    );
    if (models.length !== [...new Set(modelIds)].length) {
      throw new Error(errorMessage);
    }

    return models;
  }

  private async ensureModelScope(
    ctx: IContext,
    modelId: number,
    errorMessage = 'Model not found',
  ): Promise<Model> {
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const model = await ctx.modelService.getModelByRuntimeIdentity(
      runtimeIdentity,
      modelId,
    );
    if (!model) {
      throw new Error(errorMessage);
    }
    return model;
  }

  private async ensureViewScope(
    ctx: IContext,
    viewId: number,
    errorMessage = 'View not found',
  ): Promise<View> {
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const view = await ctx.modelService.getViewByRuntimeIdentity(
      runtimeIdentity,
      viewId,
    );
    if (!view) {
      throw new Error(errorMessage);
    }

    return view;
  }

  private async ensureRelationScope(
    ctx: IContext,
    relationId: number,
    errorMessage = 'Relation not found',
  ): Promise<Relation> {
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const relation = await ctx.modelService.getRelationByRuntimeIdentity(
      runtimeIdentity,
      relationId,
    );
    if (!relation) {
      throw new Error(errorMessage);
    }

    return relation;
  }

  private async ensureColumnScope(
    ctx: IContext,
    columnId: number,
    errorMessage = 'Column not found',
  ): Promise<ModelColumn> {
    const { runtimeIdentity } = this.getRuntimeSelection(ctx);
    const column = await ctx.modelService.getColumnByRuntimeIdentity(
      runtimeIdentity,
      columnId,
    );
    if (!column) {
      throw new Error(errorMessage);
    }
    return column;
  }
}
