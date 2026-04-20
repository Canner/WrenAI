import { IContext, RelationData, UpdateRelationData } from '../types';
import { TelemetryEvent } from '../telemetry/telemetry';
import { isNil } from 'lodash';
import {
  CreateCalculatedFieldData,
  UpdateCalculatedFieldData,
} from '../models';

interface ModelControllerRelationDeps {
  assertExecutableRuntimeScope: (
    ctx: IContext,
    runtimeScope?: IContext['runtimeScope'],
  ) => Promise<void>;
  assertKnowledgeBaseWriteAccess: (ctx: IContext) => Promise<void>;
  assertKnowledgeBaseReadAccess: (
    ctx: IContext,
    runtimeScope?: IContext['runtimeScope'],
  ) => Promise<void>;
  getRuntimeSelection: (ctx: IContext) => { runtimeIdentity: any };
  ensureModelsScope: (
    ctx: IContext,
    modelIds: number[],
    errorMessage?: string,
  ) => Promise<any[]>;
  ensureRelationScope: (
    ctx: IContext,
    relationId: number,
    errorMessage?: string,
  ) => Promise<any>;
  ensureModelScope: (
    ctx: IContext,
    modelId: number,
    errorMessage?: string,
  ) => Promise<any>;
  ensureColumnScope: (
    ctx: IContext,
    columnId: number,
    errorMessage?: string,
  ) => Promise<any>;
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
  getCurrentRuntimeIdentity: (ctx: IContext) => any;
  getRuntimeProject: (
    ctx: IContext,
    fallbackBridgeProjectId?: number | null,
  ) => Promise<any>;
  resolveBridgeProjectIdFallback: (
    runtimeIdentity: any,
    fallbackBridgeProjectId?: number | null,
  ) => number | null;
  getCurrentRuntimeScopeId: (ctx: IContext) => string | null;
}

export const createRelationAction = async ({
  data,
  ctx,
  deps,
}: {
  data: RelationData;
  ctx: IContext;
  deps: Pick<
    ModelControllerRelationDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'getRuntimeSelection'
    | 'ensureModelsScope'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  await deps.ensureModelsScope(ctx, [data.fromModelId, data.toModelId]);

  const eventName = TelemetryEvent.MODELING_CREATE_RELATION;
  try {
    const relation = await ctx.modelService.createRelationByRuntimeIdentity(
      runtimeIdentity,
      data,
    );
    ctx.telemetry.sendEvent(eventName, { data });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'relation',
      resourceId: relation?.id ?? null,
      afterJson: relation as any,
      payloadJson: { operation: 'create_relation' },
    });
    return relation;
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { data, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const updateRelationAction = async ({
  relationId,
  data,
  ctx,
  deps,
}: {
  relationId: number;
  data: UpdateRelationData;
  ctx: IContext;
  deps: Pick<
    ModelControllerRelationDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'getRuntimeSelection'
    | 'ensureRelationScope'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  await deps.ensureRelationScope(ctx, relationId);
  const eventName = TelemetryEvent.MODELING_UPDATE_RELATION;
  try {
    const relation = await ctx.modelService.updateRelationByRuntimeIdentity(
      runtimeIdentity,
      data,
      relationId,
    );
    ctx.telemetry.sendEvent(eventName, { data });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'relation',
      resourceId: relationId,
      afterJson: relation as any,
      payloadJson: { operation: 'update_relation' },
    });
    return relation;
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { data, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const deleteRelationAction = async ({
  relationId,
  ctx,
  deps,
}: {
  relationId: number;
  ctx: IContext;
  deps: Pick<
    ModelControllerRelationDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'getRuntimeSelection'
    | 'ensureRelationScope'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  await deps.ensureRelationScope(ctx, relationId);
  await ctx.modelService.deleteRelationByRuntimeIdentity(
    runtimeIdentity,
    relationId,
  );
  await deps.recordKnowledgeBaseWriteAudit(ctx, {
    resourceType: 'relation',
    resourceId: relationId,
    payloadJson: { operation: 'delete_relation' },
  });
  return true;
};

export const createCalculatedFieldAction = async ({
  data,
  ctx,
  deps,
}: {
  data: CreateCalculatedFieldData;
  ctx: IContext;
  deps: Pick<
    ModelControllerRelationDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'getRuntimeSelection'
    | 'ensureModelScope'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  await deps.ensureModelScope(ctx, data.modelId);
  const eventName = TelemetryEvent.MODELING_CREATE_CF;
  try {
    const column =
      await ctx.modelService.createCalculatedFieldByRuntimeIdentity(
        runtimeIdentity,
        data,
      );
    ctx.telemetry.sendEvent(eventName, { data });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'calculated_field',
      resourceId: column?.id ?? null,
      afterJson: column as any,
      payloadJson: { operation: 'create_calculated_field' },
    });
    return column;
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { data, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const validateCalculatedFieldAction = async ({
  name,
  modelId,
  columnId,
  ctx,
  deps,
}: {
  name: string;
  modelId: number;
  columnId?: number;
  ctx: IContext;
  deps: Pick<
    ModelControllerRelationDeps,
    'assertKnowledgeBaseWriteAccess' | 'ensureModelScope' | 'ensureColumnScope'
  >;
}) => {
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  await deps.ensureModelScope(ctx, modelId);
  if (!isNil(columnId)) {
    await deps.ensureColumnScope(ctx, columnId);
  }
  return ctx.modelService.validateCalculatedFieldNaming(
    name,
    modelId,
    columnId,
  );
};

export const updateCalculatedFieldAction = async ({
  columnId,
  data,
  ctx,
  deps,
}: {
  columnId: number;
  data: UpdateCalculatedFieldData;
  ctx: IContext;
  deps: Pick<
    ModelControllerRelationDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'getRuntimeSelection'
    | 'ensureColumnScope'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  const column = await deps.ensureColumnScope(
    ctx,
    columnId,
    'Calculated field not found',
  );
  if (!column.isCalculated) {
    throw new Error('Calculated field not found');
  }

  const eventName = TelemetryEvent.MODELING_UPDATE_CF;
  try {
    const updatedColumn =
      await ctx.modelService.updateCalculatedFieldByRuntimeIdentity(
        runtimeIdentity,
        data,
        columnId,
      );
    ctx.telemetry.sendEvent(eventName, { data });
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'calculated_field',
      resourceId: columnId,
      afterJson: updatedColumn as any,
      payloadJson: { operation: 'update_calculated_field' },
    });
    return updatedColumn;
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { data, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const deleteCalculatedFieldAction = async ({
  columnId,
  ctx,
  deps,
}: {
  columnId: number;
  ctx: IContext;
  deps: Pick<
    ModelControllerRelationDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'ensureColumnScope'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const column = await deps.ensureColumnScope(
    ctx,
    columnId,
    'Calculated field not found',
  );
  if (!column.isCalculated) {
    throw new Error('Calculated field not found');
  }
  await ctx.modelColumnRepository.deleteOne(columnId);
  await deps.recordKnowledgeBaseWriteAudit(ctx, {
    resourceType: 'calculated_field',
    resourceId: columnId,
    payloadJson: { operation: 'delete_calculated_field' },
  });
  return true;
};
