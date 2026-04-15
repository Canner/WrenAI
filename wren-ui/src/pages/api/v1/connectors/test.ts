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

const logger = getLogger('API_TEST_CONNECTOR');
logger.level = 'debug';

const { runtimeScopeResolver, connectorService } = components;

interface TestConnectorRequest {
  connectorId?: string;
  type?: string;
  databaseProvider?: string | null;
  config?: Record<string, any> | null;
  secret?: Record<string, any> | null;
}

const validatePayload = (payload: TestConnectorRequest) => {
  if (
    payload.connectorId !== undefined &&
    (typeof payload.connectorId !== 'string' ||
      payload.connectorId.trim().length === 0)
  ) {
    throw new ApiError('Connector ID is invalid', 400);
  }

  if (
    payload.type !== undefined &&
    (typeof payload.type !== 'string' || payload.type.trim().length === 0)
  ) {
    throw new ApiError('Connector type cannot be empty', 400);
  }

  if (!payload.connectorId && !payload.type) {
    throw new ApiError('Connector type is required', 400);
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

const ensureScopedConnector = async (
  connectorId: string,
  workspaceId: string,
  knowledgeBaseId: string,
) => {
  const connector = await connectorService.getConnectorById(connectorId);
  if (
    !connector ||
    connector.workspaceId !== workspaceId ||
    connector.knowledgeBaseId !== knowledgeBaseId
  ) {
    throw new ApiError('Connector not found', 404);
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
    const knowledgeBaseId = resolvePersistedKnowledgeBaseId(runtimeIdentity);
    const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    });
    const payload = (req.body || {}) as TestConnectorRequest;

    validatePayload(payload);

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'connector.update',
      resource: {
        resourceType: 'connector',
        resourceId: payload.connectorId?.trim() || 'test-connection',
        workspaceId,
        attributes: {
          workspaceKind: runtimeScope?.workspace?.kind || null,
          knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
        },
      },
      context: auditContext,
    });

    if (payload.connectorId) {
      await ensureScopedConnector(
        payload.connectorId.trim(),
        workspaceId,
        knowledgeBaseId,
      );
    }

    const result = await connectorService.testConnectorConnection({
      workspaceId,
      knowledgeBaseId,
      ...(payload.connectorId
        ? { connectorId: payload.connectorId.trim() }
        : {}),
      ...(payload.type !== undefined ? { type: payload.type.trim() } : {}),
      ...(payload.databaseProvider !== undefined
        ? { databaseProvider: payload.databaseProvider?.trim() || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'config')
        ? { config: payload.config }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'secret')
        ? { secret: payload.secret }
        : {}),
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'connector.update',
      resource: {
        resourceType: 'connector',
        resourceId: payload.connectorId?.trim() || 'test-connection',
        workspaceId,
      },
      result: 'succeeded',
      context: auditContext,
      payloadJson: {
        operation: 'test_connection',
        usedSavedConnector: Boolean(payload.connectorId),
        result,
      },
    });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: result,
      runtimeScope,
      apiType: ApiType.TEST_CONNECTOR,
      startTime,
      requestPayload: req.body,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.TEST_CONNECTOR,
      requestPayload: req.body ?? {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
