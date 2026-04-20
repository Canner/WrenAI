import { IContext } from '../types';
import { isEmpty } from 'lodash';
import { replaceAllowableSyntax } from '../utils/regex';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import { TelemetryEvent } from '../telemetry/telemetry';
import { parseJsonObject } from './modelControllerShared';

interface ModelControllerViewDeps {
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
  ensureViewScope: (
    ctx: IContext,
    viewId: number,
    errorMessage?: string,
  ) => Promise<any>;
  ensureModelScope: (
    ctx: IContext,
    modelId: number,
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
  validateViewName: (
    viewDisplayName: string,
    ctx: IContext,
    selfView?: number,
  ) => Promise<{ valid: boolean; message?: string }>;
  determineMetadataValue: (value: string) => string | null;
  getResponseExecutionContext: (
    ctx: IContext,
    source?: Record<string, any> | null,
  ) => Promise<any>;
  toExecutionRuntimeIdentitySource: (
    source?: Record<string, any> | null,
  ) => any;
  buildPersistedRuntimeIdentityPayload: (
    runtimeIdentity: any,
    overrides?: Record<string, any>,
  ) => Record<string, any>;
  isInternalAiServicePreviewRequest: (
    ctx: IContext,
    runtimeScopeId?: string | null,
  ) => boolean;
}

export const listViewsAction = async ({
  ctx,
  deps,
}: {
  ctx: IContext;
  deps: Pick<
    ModelControllerViewDeps,
    | 'assertKnowledgeBaseReadAccess'
    | 'getRuntimeSelection'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  const views =
    await ctx.modelService.getViewsByRuntimeIdentity(runtimeIdentity);
  const result = views.map((view) => ({
    ...view,
    displayName: parseJsonObject(view.properties)?.displayName ?? view.name,
  }));
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    payloadJson: { operation: 'list_views' },
  });
  return result;
};

export const getViewAction = async ({
  viewId,
  ctx,
  deps,
}: {
  viewId: number;
  ctx: IContext;
  deps: Pick<
    ModelControllerViewDeps,
    | 'assertKnowledgeBaseReadAccess'
    | 'ensureViewScope'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const view = await deps.ensureViewScope(ctx, viewId);
  const result = {
    ...view,
    displayName: parseJsonObject(view.properties)?.displayName ?? view.name,
  };
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'view',
    resourceId: view.id,
    payloadJson: { operation: 'get_view' },
  });
  return result;
};

export const validateViewAction = async ({
  name,
  ctx,
  deps,
}: {
  name: string;
  ctx: IContext;
  deps: Pick<
    ModelControllerViewDeps,
    'assertKnowledgeBaseWriteAccess' | 'validateViewName'
  >;
}) => {
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  return deps.validateViewName(name, ctx);
};

export const createViewAction = async ({
  name: displayName,
  responseId,
  rephrasedQuestion,
  ctx,
  deps,
}: {
  name: string;
  responseId: number;
  rephrasedQuestion?: string | null;
  ctx: IContext;
  deps: Pick<
    ModelControllerViewDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'getRuntimeSelection'
    | 'validateViewName'
    | 'getResponseExecutionContext'
    | 'toExecutionRuntimeIdentitySource'
    | 'buildPersistedRuntimeIdentityPayload'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  await ctx.askingService.assertResponseScope(responseId, runtimeIdentity);

  const validateResult = await deps.validateViewName(
    displayName,
    ctx,
    undefined,
  );
  if (!validateResult.valid) {
    throw new Error(validateResult.message);
  }

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
  const { project, manifest } = await deps.getResponseExecutionContext(
    ctx,
    deps.toExecutionRuntimeIdentitySource({
      bridgeProjectId: response.projectId ?? null,
      deployHash: response.deployHash ?? null,
    }),
  );

  const statement = safeFormatSQL(response.sql);
  const { columns } = await ctx.queryService.describeStatement(statement, {
    project,
    limit: 1,
    modelingOnly: false,
    manifest,
  });
  if (isEmpty(columns)) {
    throw new Error('Failed to describe statement');
  }

  const properties = {
    displayName,
    columns,
    responseId,
    question: rephrasedQuestion,
  };

  const eventName = TelemetryEvent.HOME_CREATE_VIEW;
  const eventProperties = { statement, displayName };
  try {
    const view = await ctx.viewRepository.createOne({
      ...deps.buildPersistedRuntimeIdentityPayload(runtimeIdentity),
      name: replaceAllowableSyntax(displayName),
      statement,
      properties: JSON.stringify(properties),
    });

    ctx.telemetry.sendEvent(eventName, eventProperties);
    await deps.recordKnowledgeBaseWriteAudit(ctx, {
      resourceType: 'view',
      resourceId: view?.id ?? null,
      afterJson: { ...view, displayName } as any,
      payloadJson: { operation: 'create_view' },
    });
    return { ...view, displayName };
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { ...eventProperties, error: err },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const deleteViewAction = async ({
  viewId,
  ctx,
  deps,
}: {
  viewId: number;
  ctx: IContext;
  deps: Pick<
    ModelControllerViewDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'ensureViewScope'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  await deps.ensureViewScope(ctx, viewId);
  await ctx.viewRepository.deleteOne(viewId);
  await deps.recordKnowledgeBaseWriteAudit(ctx, {
    resourceType: 'view',
    resourceId: viewId,
    payloadJson: { operation: 'delete_view' },
  });
  return true;
};

export const updateViewMetadataAction = async ({
  viewId,
  data,
  ctx,
  deps,
}: {
  viewId: number;
  data: any;
  ctx: IContext;
  deps: Pick<
    ModelControllerViewDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseWriteAccess'
    | 'ensureViewScope'
    | 'validateViewName'
    | 'determineMetadataValue'
    | 'recordKnowledgeBaseWriteAudit'
  >;
}): Promise<boolean> => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseWriteAccess(ctx);
  const view = await deps.ensureViewScope(ctx, viewId);

  const properties = parseJsonObject(view.properties) as Record<string, any>;
  let newName = view.name;
  if (data.displayName !== undefined && data.displayName !== null) {
    await deps.validateViewName(data.displayName, ctx, viewId);
    newName = replaceAllowableSyntax(data.displayName);
    properties.displayName = deps.determineMetadataValue(data.displayName);
  }
  if (data.description !== undefined && data.description !== null) {
    properties.description = deps.determineMetadataValue(data.description);
  }
  if (Array.isArray(data.columns) && data.columns.length) {
    const viewColumns = Array.isArray(properties.columns)
      ? properties.columns
      : [];
    for (const column of viewColumns) {
      const requestedMetadata = data.columns.find(
        (item: any) => item.referenceName === column.name,
      );
      if (!requestedMetadata || requestedMetadata.description == null) continue;
      column.properties = column.properties || {};
      column.properties.description = deps.determineMetadataValue(
        requestedMetadata.description,
      );
    }
    properties.columns = viewColumns;
  }

  await ctx.viewRepository.updateOne(viewId, {
    name: newName,
    properties: JSON.stringify(properties),
  });
  await deps.recordKnowledgeBaseWriteAudit(ctx, {
    resourceType: 'view',
    resourceId: viewId,
    payloadJson: { operation: 'update_view_metadata' },
    afterJson: { name: newName },
  });
  return true;
};
