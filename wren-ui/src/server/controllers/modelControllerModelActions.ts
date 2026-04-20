import { CreateModelData, UpdateModelData } from '../models';
import { IContext } from '../types';
import { Model, ModelColumn } from '../repositories';
import {
  findColumnsToUpdate,
  handleNestedColumns,
  replaceInvalidReferenceName,
  updateModelPrimaryKey,
} from '../utils/model';
import { CompactTable } from '@server/services';
import { getLogger, transformInvalidColumnName } from '@server/utils';
import { TelemetryEvent } from '../telemetry/telemetry';
import {
  findConnectionTableByNameSupport,
  parseJsonObject,
} from './modelControllerShared';

const logger = getLogger('ModelController');

interface ModelControllerModelDeps {
  assertExecutableRuntimeScope: (
    ctx: IContext,
    runtimeScope?: IContext['runtimeScope'],
  ) => Promise<void>;
  assertKnowledgeBaseWriteAccess: (ctx: IContext) => Promise<void>;
  assertKnowledgeBaseReadAccess: (
    ctx: IContext,
    runtimeScope?: IContext['runtimeScope'],
  ) => Promise<void>;
  recordKnowledgeBaseWriteAudit: (
    ctx: IContext,
    args: {
      resourceType: string;
      resourceId?: string | number | null;
      afterJson?: Record<string, any> | null;
      payloadJson?: Record<string, any> | null;
    },
  ) => Promise<void>;
  recordKnowledgeBaseReadAudit: (
    ctx: IContext,
    args: {
      runtimeScope?: IContext['runtimeScope'];
      resourceType?: string | null;
      resourceId?: string | number | null;
      payloadJson?: Record<string, any> | null;
    },
  ) => Promise<void>;
  getRuntimeSelection: (ctx: IContext) => { runtimeIdentity: any };
  getRuntimeProject: (
    ctx: IContext,
    fallbackBridgeProjectId?: number | null,
  ) => Promise<any>;
  resolveBridgeProjectIdFallback: (
    runtimeIdentity: any,
    fallbackBridgeProjectId?: number | null,
  ) => number | null;
  buildPersistedRuntimeIdentityPayload: (
    runtimeIdentity: any,
    overrides?: Record<string, any>,
  ) => Record<string, any>;
  ensureModelScope: (
    ctx: IContext,
    modelId: number,
    errorMessage?: string,
  ) => Promise<any>;
  validateTableExist: (
    tableName: string,
    connectionTables: CompactTable[],
  ) => void;
  validateColumnsExist: (
    tableName: string,
    fields: string[],
    connectionTables: CompactTable[],
  ) => void;
}

const handleCreateModel = async (
  ctx: IContext,
  sourceTableName: string,
  fields: [string],
  primaryKey: string,
  deps: Pick<
    ModelControllerModelDeps,
    | 'getRuntimeSelection'
    | 'getRuntimeProject'
    | 'resolveBridgeProjectIdFallback'
    | 'validateTableExist'
    | 'validateColumnsExist'
    | 'buildPersistedRuntimeIdentityPayload'
  >,
) => {
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  const project = await deps.getRuntimeProject(
    ctx,
    deps.resolveBridgeProjectIdFallback(runtimeIdentity),
  );
  const connectionTables =
    await ctx.projectService.getProjectConnectionTables(project);
  deps.validateTableExist(sourceTableName, connectionTables);
  deps.validateColumnsExist(sourceTableName, fields, connectionTables);

  const connectionTable = findConnectionTableByNameSupport(
    sourceTableName,
    connectionTables,
  );
  if (!connectionTable) {
    throw new Error('Table not found in the connection');
  }
  const model = await ctx.modelRepository.createOne({
    ...deps.buildPersistedRuntimeIdentityPayload(runtimeIdentity, {
      projectId: project.id,
    }),
    displayName: connectionTable.name,
    referenceName: replaceInvalidReferenceName(connectionTable.name),
    sourceTableName: connectionTable.name,
    cached: false,
    refreshTime: null,
    properties: connectionTable.properties
      ? JSON.stringify(connectionTable.properties)
      : null,
  } as Partial<Model>);

  const compactColumns = connectionTable.columns.filter((column) =>
    fields.includes(column.name),
  );
  const columns = await ctx.modelColumnRepository.createMany(
    compactColumns.map(
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
    ),
  );

  await ctx.modelNestedColumnRepository.createMany(
    compactColumns.flatMap((compactColumn) => {
      const column = columns.find(
        (item) => item.sourceColumnName === compactColumn.name,
      );
      if (!column) return [];
      return handleNestedColumns(compactColumn, {
        modelId: column.modelId,
        columnId: column.id,
        sourceColumnName: column.sourceColumnName,
      });
    }),
  );
  logger.info(`Model created: ${JSON.stringify(model)}`);
  return model;
};

const handleUpdateModel = async (
  ctx: IContext,
  input: { data: UpdateModelData; modelId: number },
  fields: [string],
  primaryKey: string,
  deps: Pick<
    ModelControllerModelDeps,
    | 'getRuntimeSelection'
    | 'getRuntimeProject'
    | 'resolveBridgeProjectIdFallback'
    | 'ensureModelScope'
    | 'validateTableExist'
    | 'validateColumnsExist'
  >,
) => {
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  const project = await deps.getRuntimeProject(
    ctx,
    deps.resolveBridgeProjectIdFallback(runtimeIdentity),
  );
  const connectionTables =
    await ctx.projectService.getProjectConnectionTables(project);
  const model = await deps.ensureModelScope(ctx, input.modelId);
  const existingColumns = await ctx.modelColumnRepository.findAllBy({
    modelId: model.id,
    isCalculated: false,
  });
  const { sourceTableName } = model;
  deps.validateTableExist(sourceTableName, connectionTables);
  deps.validateColumnsExist(sourceTableName, fields, connectionTables);

  const sourceTableColumns =
    findConnectionTableByNameSupport(sourceTableName, connectionTables)
      ?.columns ?? [];
  const { toDeleteColumnIds, toCreateColumns, toUpdateColumns } =
    findColumnsToUpdate(fields, existingColumns, sourceTableColumns);
  await updateModelPrimaryKey(ctx.modelColumnRepository, model.id, primaryKey);

  if (toDeleteColumnIds.length) {
    await ctx.modelColumnRepository.deleteMany(toDeleteColumnIds);
  }

  if (toCreateColumns.length) {
    const compactColumns = sourceTableColumns.filter((sourceColumn) =>
      toCreateColumns.includes(sourceColumn.name),
    );
    const columns = await ctx.modelColumnRepository.createMany(
      compactColumns.map(
        (column) =>
          ({
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
          }) as Partial<ModelColumn>,
      ),
    );

    await ctx.modelNestedColumnRepository.createMany(
      compactColumns.flatMap((compactColumn) => {
        const column = columns.find(
          (item) => item.sourceColumnName === compactColumn.name,
        );
        if (!column) {
          return [];
        }

        return handleNestedColumns(compactColumn, {
          modelId: column.modelId,
          columnId: column.id,
          sourceColumnName: column.sourceColumnName,
        });
      }),
    );
  }

  if (toUpdateColumns.length) {
    for (const { id, sourceColumnName, type } of toUpdateColumns) {
      const column = await ctx.modelColumnRepository.updateOne(id, { type });
      if (type.includes('STRUCT')) {
        const sourceColumn = sourceTableColumns.find(
          (item) => item.name === sourceColumnName,
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
            sourceColumnName,
          }),
        );
      }
    }
  }

  logger.info(`Model updated: ${JSON.stringify(model)}`);
  return model;
};

export const listModelsAction = async ({
  ctx,
  deps,
}: {
  ctx: IContext;
  deps: Pick<
    ModelControllerModelDeps,
    | 'assertKnowledgeBaseReadAccess'
    | 'getRuntimeSelection'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  const models =
    await ctx.modelService.listModelsByRuntimeIdentity(runtimeIdentity);
  const modelIds = models.map((model) => model.id);
  const modelColumnList =
    await ctx.modelColumnRepository.findColumnsByModelIds(modelIds);
  const modelNestedColumnList =
    await ctx.modelNestedColumnRepository.findNestedColumnsByModelIds(modelIds);
  const result = models.map((model) => {
    const modelFields = modelColumnList
      .filter((column) => column.modelId === model.id)
      .map((column) => ({
        ...column,
        properties: parseJsonObject(column.properties),
        nestedColumns: column.type.includes('STRUCT')
          ? modelNestedColumnList.filter(
              (nested) => nested.columnId === column.id,
            )
          : undefined,
      }));
    return {
      ...model,
      fields: modelFields.filter((column) => !column.isCalculated),
      calculatedFields: modelFields.filter((column) => column.isCalculated),
      properties: { ...parseJsonObject(model.properties) },
    };
  });
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    payloadJson: { operation: 'list_models' },
  });
  return result;
};

export const getModelAction = async ({
  modelId,
  ctx,
  deps,
}: {
  modelId: number;
  ctx: IContext;
  deps: Pick<
    ModelControllerModelDeps,
    | 'assertKnowledgeBaseReadAccess'
    | 'ensureModelScope'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const model = await deps.ensureModelScope(ctx, modelId);
  const modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds([
    model.id,
  ]);
  const modelNestedColumns = await ctx.modelNestedColumnRepository.findAllBy({
    modelId: model.id,
  });
  const columns = modelColumns.map((column) => ({
    ...column,
    properties: parseJsonObject(column.properties),
    nestedColumns: column.type.includes('STRUCT')
      ? modelNestedColumns.filter((nested) => nested.columnId === column.id)
      : undefined,
  }));
  const relations = (
    await ctx.relationRepository.findRelationsBy({
      columnIds: modelColumns.map((column) => column.id),
    })
  ).map((relation) => ({
    ...relation,
    type: relation.joinType,
    properties: relation.properties ? JSON.parse(relation.properties) : {},
  }));

  const result = {
    ...model,
    fields: columns.filter((column) => !column.isCalculated),
    calculatedFields: columns.filter((column) => column.isCalculated),
    relations,
    properties: { ...parseJsonObject(model.properties) },
  };
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'model',
    resourceId: model.id,
    payloadJson: { operation: 'get_model' },
  });
  return result;
};

export const createModelAction = async ({
  data,
  ctx,
  deps,
}: {
  data: CreateModelData;
  ctx: IContext;
  deps: Pick<
    ModelControllerModelDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'recordKnowledgeBaseWriteAudit'
    | 'getRuntimeSelection'
    | 'getRuntimeProject'
    | 'resolveBridgeProjectIdFallback'
    | 'validateTableExist'
    | 'validateColumnsExist'
    | 'buildPersistedRuntimeIdentityPayload'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const { sourceTableName, fields, primaryKey } = data;
  try {
    const model = await handleCreateModel(
      ctx,
      sourceTableName,
      fields,
      primaryKey,
      deps,
    );
    ctx.telemetry.sendEvent(TelemetryEvent.MODELING_CREATE_MODEL, { data });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'model',
      resourceId: model?.id ?? null,
      afterJson: model as any,
      payloadJson: { operation: 'create_model' },
    });
    return model;
  } catch (error: any) {
    ctx.telemetry.sendEvent(
      TelemetryEvent.MODELING_CREATE_MODEL,
      { data, error },
      error.extensions?.service,
      false,
    );
    throw error;
  }
};

export const updateModelAction = async ({
  modelId,
  data,
  ctx,
  deps,
}: {
  modelId: number;
  data: UpdateModelData;
  ctx: IContext;
  deps: Pick<
    ModelControllerModelDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'recordKnowledgeBaseWriteAudit'
    | 'getRuntimeSelection'
    | 'getRuntimeProject'
    | 'resolveBridgeProjectIdFallback'
    | 'ensureModelScope'
    | 'validateTableExist'
    | 'validateColumnsExist'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const { fields, primaryKey } = data;
  try {
    const model = await handleUpdateModel(
      ctx,
      { modelId, data },
      fields,
      primaryKey,
      deps,
    );
    ctx.telemetry.sendEvent(TelemetryEvent.MODELING_UPDATE_MODEL, { data });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'model',
      resourceId: modelId,
      afterJson: model as any,
      payloadJson: { operation: 'update_model' },
    });
    return model;
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      TelemetryEvent.MODELING_UPDATE_MODEL,
      { data, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const deleteModelAction = async ({
  modelId,
  ctx,
  deps,
}: {
  modelId: number;
  ctx: IContext;
  deps: Pick<
    ModelControllerModelDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'ensureModelScope'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  await deps.ensureModelScope(ctx, modelId);
  await ctx.modelRepository.deleteOne(modelId);
  await deps.recordKnowledgeBaseWriteAudit(ctx, {
    resourceType: 'model',
    resourceId: modelId,
    payloadJson: { operation: 'delete_model' },
  });
  return true;
};
