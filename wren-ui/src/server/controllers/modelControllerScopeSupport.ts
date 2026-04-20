import { IContext } from '../types';
import { Model, ModelColumn, Relation, View } from '../repositories';
import { PersistedRuntimeIdentity } from '../context/runtimeScope';
import {
  assertLatestExecutableRuntimeScope,
  resolveRuntimeProject,
} from '../utils/runtimeExecutionContext';
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
import {
  determineMetadataValueSupport,
  validateColumnsExistSupport,
  validateTableExistSupport,
} from './modelControllerShared';

export const determineMetadataValue = determineMetadataValueSupport;
export const validateTableExist = validateTableExistSupport;
export const validateColumnsExist = validateColumnsExistSupport;

export const getCurrentRuntimeIdentity = (ctx: IContext) =>
  toCanonicalPersistedRuntimeIdentityFromScope(ctx.runtimeScope!);

export const getRuntimeSelection = (ctx: IContext) => ({
  runtimeIdentity: getCurrentRuntimeIdentity(ctx),
});

export const getKnowledgeBaseReadAuthorizationTarget = (
  ctx: IContext,
  runtimeScope: IContext['runtimeScope'] = ctx.runtimeScope!,
) => {
  const resolvedRuntimeScope = runtimeScope || ctx.runtimeScope!;
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const workspaceId =
    runtimeScope?.workspace?.id || runtimeIdentity.workspaceId || null;
  const knowledgeBase = runtimeScope?.knowledgeBase;

  return {
    actor:
      ctx.authorizationActor ||
      buildAuthorizationActorFromRuntimeScope(resolvedRuntimeScope),
    resource: {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || workspaceId,
      workspaceId,
      attributes: {
        workspaceKind: resolvedRuntimeScope?.workspace?.kind || null,
        knowledgeBaseKind: knowledgeBase?.kind || null,
      },
    },
  };
};

export const getKnowledgeBaseWriteAuthorizationTarget = (ctx: IContext) => {
  const { runtimeIdentity } = getRuntimeSelection(ctx);
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
};

export const assertKnowledgeBaseWriteAccess = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseWriteAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
  });
};

export const assertKnowledgeBaseReadAccess = async (
  ctx: IContext,
  runtimeScope: IContext['runtimeScope'] = ctx.runtimeScope!,
) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(
    ctx,
    runtimeScope,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
  });
};

export const recordKnowledgeBaseWriteAudit = async (
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
) => {
  const { actor, resource } = getKnowledgeBaseWriteAuthorizationTarget(ctx);
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
};

export const recordKnowledgeBaseReadAudit = async (
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
) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(
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
};

export const assertExecutableRuntimeScope = async (
  ctx: IContext,
  runtimeScope: IContext['runtimeScope'] = ctx.runtimeScope!,
) => {
  const resolvedRuntimeScope = runtimeScope || ctx.runtimeScope!;
  try {
    await assertLatestExecutableRuntimeScope({
      runtimeScope: resolvedRuntimeScope,
      knowledgeBaseRepository: ctx.knowledgeBaseRepository,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
    });
  } catch (error) {
    throw Errors.create(Errors.GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT, {
      customMessage:
        error instanceof Error ? error.message : 'Snapshot outdated',
    });
  }
};

export const getCurrentRuntimeScopeId = (ctx: IContext) =>
  ctx.runtimeScope?.selector?.runtimeScopeId || null;

export const getRuntimeProject = async (
  ctx: IContext,
  fallbackBridgeProjectId?: number | null,
) => {
  const project = await resolveRuntimeProject(
    ctx.runtimeScope!,
    ctx.projectService,
    fallbackBridgeProjectId,
  );
  if (!project) {
    throw new Error('No project found for the active runtime scope');
  }

  return project;
};

export const toExecutionRuntimeIdentitySource = (
  source?: {
    bridgeProjectId?: number | null;
    workspaceId?: string | null;
    knowledgeBaseId?: string | null;
    kbSnapshotId?: string | null;
    deployHash?: string | null;
    actorUserId?: string | null;
  } | null,
): Partial<PersistedRuntimeIdentity> | null => {
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
};

export const buildExecutionRuntimeIdentity = (
  ctx: IContext,
  source?: Partial<PersistedRuntimeIdentity> | null,
) => {
  const { runtimeIdentity } = getRuntimeSelection(ctx);
  const hasField = <K extends keyof PersistedRuntimeIdentity>(field: K) =>
    source != null && Object.prototype.hasOwnProperty.call(source, field);

  return normalizeCanonicalPersistedRuntimeIdentity({
    projectId: hasField('projectId')
      ? (source?.projectId ?? null)
      : (runtimeIdentity.projectId ?? null),
    workspaceId: hasField('workspaceId')
      ? (source?.workspaceId ?? null)
      : (runtimeIdentity.workspaceId ?? null),
    knowledgeBaseId: hasField('knowledgeBaseId')
      ? (source?.knowledgeBaseId ?? null)
      : (runtimeIdentity.knowledgeBaseId ?? null),
    kbSnapshotId: hasField('kbSnapshotId')
      ? (source?.kbSnapshotId ?? null)
      : (runtimeIdentity.kbSnapshotId ?? null),
    deployHash: hasField('deployHash')
      ? (source?.deployHash ?? null)
      : (runtimeIdentity.deployHash ?? null),
    actorUserId: hasField('actorUserId')
      ? (source?.actorUserId ?? null)
      : (runtimeIdentity.actorUserId ?? null),
  });
};

export const resolveBridgeProjectIdFallback = (
  runtimeIdentity: PersistedRuntimeIdentity,
  fallbackBridgeProjectId?: number | null,
) => {
  if (hasCanonicalRuntimeIdentity(runtimeIdentity)) {
    return null;
  }

  return resolvePersistedProjectBridgeId(
    runtimeIdentity,
    fallbackBridgeProjectId,
  );
};

export const buildPersistedRuntimeIdentityPayload = (
  runtimeIdentity: PersistedRuntimeIdentity,
  overrides?: Partial<PersistedRuntimeIdentity>,
) =>
  toPersistedRuntimeIdentityPatch({
    ...runtimeIdentity,
    ...overrides,
    projectId: resolveBridgeProjectIdFallback(
      runtimeIdentity,
      overrides?.projectId ?? null,
    ),
  });

export const getResponseExecutionContext = async (
  ctx: IContext,
  source?: Partial<PersistedRuntimeIdentity> | null,
) => {
  const runtimeIdentity = buildExecutionRuntimeIdentity(ctx, source);
  const deployment =
    await ctx.deployService.getDeploymentByRuntimeIdentity(runtimeIdentity);
  if (!deployment) {
    throw new Error('No deployment found, please deploy your project first');
  }

  const project = await ctx.projectService.getProjectById(deployment.projectId);

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
};

export const ensureModelsScope = async (
  ctx: IContext,
  modelIds: number[],
  errorMessage = 'Model not found',
): Promise<Model[]> => {
  const { runtimeIdentity } = getRuntimeSelection(ctx);
  const models = await ctx.modelService.getModelsByRuntimeIdentity(
    runtimeIdentity,
    modelIds,
  );
  if (models.length !== [...new Set(modelIds)].length) {
    throw new Error(errorMessage);
  }

  return models;
};

export const ensureModelScope = async (
  ctx: IContext,
  modelId: number,
  errorMessage = 'Model not found',
): Promise<Model> => {
  const { runtimeIdentity } = getRuntimeSelection(ctx);
  const model = await ctx.modelService.getModelByRuntimeIdentity(
    runtimeIdentity,
    modelId,
  );
  if (!model) {
    throw new Error(errorMessage);
  }
  return model;
};

export const ensureViewScope = async (
  ctx: IContext,
  viewId: number,
  errorMessage = 'View not found',
): Promise<View> => {
  const { runtimeIdentity } = getRuntimeSelection(ctx);
  const view = await ctx.modelService.getViewByRuntimeIdentity(
    runtimeIdentity,
    viewId,
  );
  if (!view) {
    throw new Error(errorMessage);
  }

  return view;
};

export const ensureRelationScope = async (
  ctx: IContext,
  relationId: number,
  errorMessage = 'Relation not found',
): Promise<Relation> => {
  const { runtimeIdentity } = getRuntimeSelection(ctx);
  const relation = await ctx.modelService.getRelationByRuntimeIdentity(
    runtimeIdentity,
    relationId,
  );
  if (!relation) {
    throw new Error(errorMessage);
  }

  return relation;
};

export const ensureColumnScope = async (
  ctx: IContext,
  columnId: number,
  errorMessage = 'Column not found',
): Promise<ModelColumn> => {
  const { runtimeIdentity } = getRuntimeSelection(ctx);
  const column = await ctx.modelService.getColumnByRuntimeIdentity(
    runtimeIdentity,
    columnId,
  );
  if (!column) {
    throw new Error(errorMessage);
  }
  return column;
};

export const validateViewName = async (
  viewDisplayName: string,
  ctx: IContext,
  selfView?: number,
): Promise<{ valid: boolean; message?: string }> => {
  const { runtimeIdentity } = getRuntimeSelection(ctx);
  return ctx.modelService.validateViewNameByRuntimeIdentity(
    runtimeIdentity,
    viewDisplayName,
    selfView,
  );
};

export const isInternalAiServiceRequest = (ctx: IContext): boolean => {
  const internalHeader = (ctx as any)?.req?.headers?.[
    'x-wren-ai-service-internal'
  ] as string | string[] | undefined;

  return Array.isArray(internalHeader)
    ? internalHeader.includes('1')
    : internalHeader === '1';
};

export const isInternalAiServicePreviewRequest = (
  ctx: IContext,
  runtimeScopeId?: string | null,
): boolean => {
  if (!runtimeScopeId) {
    return false;
  }

  return isInternalAiServiceRequest(ctx);
};
