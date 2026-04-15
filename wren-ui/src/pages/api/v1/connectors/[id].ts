import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  handleApiError,
  respondWithSimple,
  ApiError,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  requirePersistedWorkspaceId,
  resolvePersistedKnowledgeBaseId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_CONNECTOR_BY_ID');
logger.level = 'debug';

const { runtimeScopeResolver, connectorService } = components;

interface UpdateConnectorRequest {
  knowledgeBaseId?: string | null;
  type?: string;
  databaseProvider?: string | null;
  displayName?: string;
  config?: Record<string, any> | null;
  secret?: Record<string, any> | null;
}

const validateConnectorId = (id: any): string => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('Connector ID is required', 400);
  }

  return id;
};

const toConnectorResponse = (connector: any) => ({
  id: connector.id,
  workspaceId: connector.workspaceId,
  knowledgeBaseId: connector.knowledgeBaseId ?? null,
  type: connector.type,
  databaseProvider: connector.databaseProvider ?? null,
  trinoCatalogName: connector.trinoCatalogName ?? null,
  displayName: connector.displayName,
  config: connector.configJson ?? null,
  hasSecret: Boolean(connector.secretRecordId),
  createdBy: connector.createdBy ?? null,
});

const validateConnectorPayload = (payload: UpdateConnectorRequest) => {
  if (payload.type !== undefined && payload.type.trim().length === 0) {
    throw new ApiError('Connector type cannot be empty', 400);
  }
  if (
    payload.displayName !== undefined &&
    payload.displayName.trim().length === 0
  ) {
    throw new ApiError('Connector display name cannot be empty', 400);
  }
  if (
    payload.databaseProvider !== undefined &&
    payload.databaseProvider !== null &&
    (typeof payload.databaseProvider !== 'string' ||
      payload.databaseProvider.trim().length === 0)
  ) {
    throw new ApiError('Connector databaseProvider cannot be empty', 400);
  }
  if (
    payload.config !== undefined &&
    payload.config !== null &&
    (typeof payload.config !== 'object' || Array.isArray(payload.config))
  ) {
    throw new ApiError('Connector config must be an object', 400);
  }
  if (
    payload.secret !== undefined &&
    payload.secret !== null &&
    (typeof payload.secret !== 'object' || Array.isArray(payload.secret))
  ) {
    throw new ApiError('Connector secret must be an object', 400);
  }
};

const getScopedConnector = async (
  id: string,
  workspaceId: string,
  knowledgeBaseId: string,
) => {
  const connector = await connectorService.getConnectorById(id);
  if (
    !connector ||
    connector.workspaceId !== workspaceId ||
    connector.knowledgeBaseId !== knowledgeBaseId
  ) {
    throw new ApiError('Connector not found', 404);
  }

  return connector;
};

const handleGetConnector = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
  const knowledgeBaseId = resolvePersistedKnowledgeBaseId(runtimeIdentity);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const connector = await getScopedConnector(
    validateConnectorId(req.query.id),
    workspaceId,
    knowledgeBaseId,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'connector.read',
    resource: {
      resourceType: 'connector',
      resourceId: connector.id,
      workspaceId,
    },
    context: buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    }),
  });

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: toConnectorResponse(connector),
    runtimeScope,
    apiType: ApiType.GET_CONNECTORS,
    startTime,
    requestPayload: { id: req.query.id },
    headers: req.headers as Record<string, string>,
  });
};

const handleUpdateConnector = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  const payload = req.body as UpdateConnectorRequest;
  validateConnectorPayload(payload);
  const knowledgeBaseId = resolvePersistedKnowledgeBaseId(
    runtimeIdentity,
    payload,
  );
  const connectorId = validateConnectorId(req.query.id);
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'connector.update',
    resource: {
      resourceType: 'connector',
      resourceId: connectorId,
      workspaceId,
      attributes: {
        workspaceKind: runtimeScope?.workspace?.kind || null,
        knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
      },
    },
    context: auditContext,
  });
  const existingConnector = await getScopedConnector(
    connectorId,
    workspaceId,
    knowledgeBaseId,
  );

  const updatedConnector = await connectorService.updateConnector(connectorId, {
    knowledgeBaseId,
    type: payload.type?.trim(),
    databaseProvider:
      payload.databaseProvider === undefined
        ? undefined
        : payload.databaseProvider?.trim() || null,
    displayName: payload.displayName?.trim(),
    config: payload.config,
    secret: payload.secret,
  });

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'connector.update',
    resource: {
      resourceType: 'connector',
      resourceId: existingConnector.id,
      workspaceId,
    },
    result: 'succeeded',
    context: auditContext,
    beforeJson: existingConnector as any,
    afterJson: updatedConnector as any,
  });

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: toConnectorResponse(updatedConnector),
    runtimeScope,
    apiType: ApiType.UPDATE_CONNECTOR,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

const handleDeleteConnector = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  const knowledgeBaseId = resolvePersistedKnowledgeBaseId(runtimeIdentity);
  const connectorId = validateConnectorId(req.query.id);
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'connector.delete',
    resource: {
      resourceType: 'connector',
      resourceId: connectorId,
      workspaceId,
      attributes: {
        workspaceKind: runtimeScope?.workspace?.kind || null,
        knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
      },
    },
    context: auditContext,
  });
  const existingConnector = await getScopedConnector(
    connectorId,
    workspaceId,
    knowledgeBaseId,
  );

  await connectorService.deleteConnector(connectorId);

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'connector.delete',
    resource: {
      resourceType: 'connector',
      resourceId: existingConnector.id,
      workspaceId,
    },
    result: 'succeeded',
    context: auditContext,
    beforeJson: existingConnector as any,
  });

  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    runtimeScope,
    apiType: ApiType.DELETE_CONNECTOR,
    startTime,
    requestPayload: { id: connectorId },
    headers: req.headers as Record<string, string>,
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);

    if (req.method === 'GET') {
      await handleGetConnector(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'PUT') {
      await handleUpdateConnector(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDeleteConnector(req, res, runtimeScope, startTime);
      return;
    }

    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType:
        req.method === 'GET'
          ? ApiType.GET_CONNECTORS
          : req.method === 'PUT'
            ? ApiType.UPDATE_CONNECTOR
            : ApiType.DELETE_CONNECTOR,
      requestPayload:
        req.method === 'DELETE' ? { id: req.query.id } : req.body ?? {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
