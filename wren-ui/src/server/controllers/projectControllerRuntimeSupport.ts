import { DataSource, DataSourceName, IContext } from '../types';
import { Connector, KnowledgeBase, Project } from '../repositories';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';
import { AskRuntimeIdentity } from '@server/models/adaptor';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { resolveRuntimeProject as resolveScopedRuntimeProject } from '../utils/runtimeExecutionContext';
import {
  toCanonicalPersistedRuntimeIdentityFromScope,
  toProjectBridgeRuntimeIdentity,
} from '@server/utils/persistedRuntimeIdentity';
import {
  buildConnectionSettingsFromConnector,
  buildConnectorBridgeFromConnection,
} from '@server/utils/connectionConnectorBridge';

export const MANAGED_FEDERATED_RUNTIME_READONLY_MESSAGE =
  '当前为系统自动维护的联邦运行时，请前往知识库 → 连接器维护连接。';

export const getCurrentRuntimeScopeId = (ctx: IContext) =>
  ctx.runtimeScope?.selector?.runtimeScopeId || null;

export const resolveActiveRuntimeProject = async (
  ctx: IContext,
): Promise<Project | null> => {
  if (!ctx.runtimeScope) {
    return null;
  }

  return resolveScopedRuntimeProject(ctx.runtimeScope, ctx.projectService);
};

export const getActiveRuntimeProjectOrThrow = async (
  ctx: IContext,
): Promise<Project> => {
  const project = await resolveActiveRuntimeProject(ctx);
  if (!project) {
    throw new Error('Active runtime project is required for this operation');
  }

  return project;
};

export const resolveActiveRuntimeKnowledgeBase = async (
  ctx: IContext,
): Promise<KnowledgeBase | null> => {
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

  return ctx.knowledgeBaseRepository.findOneBy({ id: knowledgeBaseId });
};

export const getCurrentPersistedRuntimeIdentity = (
  ctx: IContext,
): PersistedRuntimeIdentity | null =>
  ctx.runtimeScope
    ? toCanonicalPersistedRuntimeIdentityFromScope(ctx.runtimeScope)
    : null;

export const toAskRuntimeIdentity = (
  runtimeIdentity: PersistedRuntimeIdentity | null,
): AskRuntimeIdentity | null => {
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
};

const getKnowledgeBaseAuthorizationTarget = async (ctx: IContext) => {
  const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);
  const workspaceId =
    ctx.runtimeScope?.workspace?.id || runtimeIdentity?.workspaceId || null;
  const knowledgeBase = await resolveActiveRuntimeKnowledgeBase(ctx);

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
  const { actor, resource } = await getKnowledgeBaseAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
  });
};

export const assertKnowledgeBaseReadAccess = async (ctx: IContext) => {
  const { actor, resource } = await getKnowledgeBaseAuthorizationTarget(ctx);
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
  const { actor, resource } = await getKnowledgeBaseAuthorizationTarget(ctx);
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
    resourceType,
    resourceId,
    payloadJson,
  }: {
    resourceType?: string | null;
    resourceId?: string | number | null;
    payloadJson?: Record<string, any> | null;
  },
) => {
  const { actor, resource } = await getKnowledgeBaseAuthorizationTarget(ctx);
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

export const buildBridgeRuntimeIdentity = (
  ctx: IContext,
  bridgeProjectId: number,
) => {
  const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);

  if (!runtimeIdentity) {
    return toProjectBridgeRuntimeIdentity(bridgeProjectId);
  }

  return {
    ...runtimeIdentity,
    projectId: bridgeProjectId,
    deployHash: null,
  };
};

export const isManagedFederatedRuntimeProject = (
  project?: Project | null,
  knowledgeBase?: KnowledgeBase | null,
) =>
  Boolean(
    project &&
      knowledgeBase?.runtimeProjectId &&
      project.id === knowledgeBase.runtimeProjectId &&
      project.type === DataSourceName.TRINO,
  );

export const buildConnectionSettingsProperties = ({
  project,
  knowledgeBase,
  generalConnectionInfo,
}: {
  project: Project;
  knowledgeBase: KnowledgeBase | null;
  generalConnectionInfo: Record<string, any>;
}) => {
  const managedFederatedRuntime = isManagedFederatedRuntimeProject(
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
};

export const resolveKnowledgeBaseConnectionConnector = async (
  ctx: IContext,
  knowledgeBase?: KnowledgeBase | null,
): Promise<Connector | null> => {
  if (!knowledgeBase) {
    return null;
  }

  if (knowledgeBase.primaryConnectorId) {
    const primaryConnector = await ctx.connectorRepository.findOneBy({
      id: knowledgeBase.primaryConnectorId,
    });

    if (
      primaryConnector &&
      primaryConnector.workspaceId === knowledgeBase.workspaceId &&
      primaryConnector.knowledgeBaseId === knowledgeBase.id
    ) {
      return primaryConnector;
    }
  }

  const connectors = await ctx.connectorRepository.findAllBy({
    workspaceId: knowledgeBase.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
  });

  return connectors[0] || null;
};

export const upsertKnowledgeBaseConnectorForConnection = async ({
  ctx,
  knowledgeBase,
  connection,
  mode,
}: {
  ctx: IContext;
  knowledgeBase: KnowledgeBase;
  connection: DataSource;
  mode: 'save' | 'update';
}): Promise<Connector | null> => {
  const bridgePayload = buildConnectorBridgeFromConnection(connection);
  if (!bridgePayload) {
    return null;
  }

  await ctx.connectorService.testConnectorConnection({
    workspaceId: knowledgeBase.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
    type: bridgePayload.type,
    databaseProvider: bridgePayload.databaseProvider,
    config: bridgePayload.config,
    ...(Object.prototype.hasOwnProperty.call(bridgePayload, 'secret')
      ? { secret: bridgePayload.secret ?? null }
      : {}),
  });

  const existingConnector = await resolveKnowledgeBaseConnectionConnector(
    ctx,
    knowledgeBase,
  );

  if (existingConnector) {
    return ctx.connectorService.updateConnector(existingConnector.id, {
      knowledgeBaseId: knowledgeBase.id,
      type: bridgePayload.type,
      databaseProvider: bridgePayload.databaseProvider,
      displayName: bridgePayload.displayName,
      config: bridgePayload.config,
      ...(Object.prototype.hasOwnProperty.call(bridgePayload, 'secret')
        ? { secret: bridgePayload.secret ?? null }
        : {}),
    });
  }

  if (mode === 'update') {
    return null;
  }

  return ctx.connectorService.createConnector({
    workspaceId: knowledgeBase.workspaceId,
    knowledgeBaseId: knowledgeBase.id,
    type: bridgePayload.type,
    databaseProvider: bridgePayload.databaseProvider,
    displayName: bridgePayload.displayName,
    config: bridgePayload.config,
    ...(Object.prototype.hasOwnProperty.call(bridgePayload, 'secret')
      ? { secret: bridgePayload.secret ?? null }
      : {}),
    createdBy: ctx.runtimeScope?.userId || null,
  });
};

export const buildConnectorBackedConnection = (
  connector: Connector | null,
  knowledgeBase: KnowledgeBase | null,
) =>
  connector
    ? {
        ...buildConnectionSettingsFromConnector({
          displayName: connector.displayName,
          databaseProvider: connector.databaseProvider,
          config: connector.configJson,
        }),
        sampleDataset: knowledgeBase?.sampleDataset ?? null,
      }
    : null;
