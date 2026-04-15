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

const logger = getLogger('API_CONNECTORS');
logger.level = 'debug';

const { runtimeScopeResolver, connectorService } = components;

interface CreateConnectorRequest {
  knowledgeBaseId?: string | null;
  type: string;
  databaseProvider?: string | null;
  displayName: string;
  config?: Record<string, any> | null;
  secret?: Record<string, any> | null;
}

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

const validateConnectorPayload = (
  payload: Partial<CreateConnectorRequest>,
  requireFields: boolean,
) => {
  if (requireFields) {
    if (!payload.type || payload.type.trim().length === 0) {
      throw new ApiError('Connector type is required', 400);
    }
    if (!payload.displayName || payload.displayName.trim().length === 0) {
      throw new ApiError('Connector display name is required', 400);
    }
  }

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

const handleListConnectors = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'connector.read',
    resource: {
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
    },
    context: buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    }),
  });
  const knowledgeBaseId = resolvePersistedKnowledgeBaseId(
    runtimeIdentity,
    undefined,
    'Knowledge base scope is required',
  );
  const connectors = await connectorService.listConnectorsByKnowledgeBase(
    workspaceId,
    knowledgeBaseId,
  );

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: connectors.map(toConnectorResponse),
    runtimeScope,
    apiType: ApiType.GET_CONNECTORS,
    startTime,
    requestPayload: {},
    headers: req.headers as Record<string, string>,
  });
};

const handleCreateConnector = async (
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
  const payload = req.body as CreateConnectorRequest;
  validateConnectorPayload(payload, true);
  const knowledgeBaseId = resolvePersistedKnowledgeBaseId(
    runtimeIdentity,
    payload,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'connector.create',
    resource: {
      resourceType: 'connector',
      resourceId: 'new',
      workspaceId,
      attributes: {
        workspaceKind: runtimeScope?.workspace?.kind || null,
        knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
      },
    },
    context: auditContext,
  });

  const connector = await connectorService.createConnector({
    workspaceId,
    knowledgeBaseId,
    type: payload.type.trim(),
    databaseProvider: payload.databaseProvider?.trim() || null,
    displayName: payload.displayName.trim(),
    config: payload.config,
    secret: payload.secret,
    createdBy: runtimeIdentity.actorUserId || undefined,
  });

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'connector.create',
    resource: {
      resourceType: 'connector',
      resourceId: connector.id,
      workspaceId,
    },
    result: 'succeeded',
    context: auditContext,
    afterJson: connector as any,
  });

  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: toConnectorResponse(connector),
    runtimeScope,
    apiType: ApiType.CREATE_CONNECTOR,
    startTime,
    requestPayload: req.body,
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
      await handleListConnectors(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'POST') {
      await handleCreateConnector(req, res, runtimeScope, startTime);
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
          : ApiType.CREATE_CONNECTOR,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
