import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { getLogger } from '@server/utils';
import {
  requirePersistedKnowledgeBaseId,
  requirePersistedWorkspaceId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import { activateConnectorForKnowledgeBaseRuntime } from '@server/utils/knowledgeConnectorRuntime';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@/server/authz';

const logger = getLogger('API_ACTIVATE_CONNECTOR_RUNTIME');
logger.level = 'debug';

const { runtimeScopeResolver } = components;

const validateConnectorId = (value: unknown) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError('Connector ID is required', 400);
  }

  return value.trim();
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
    const knowledgeBaseId = requirePersistedKnowledgeBaseId(runtimeIdentity);
    const connectorId = validateConnectorId(req.query.id);
    const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    });

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: {
        resourceType: 'knowledge_base',
        resourceId: knowledgeBaseId,
        workspaceId,
      },
      context: auditContext,
    });

    const ctx = await buildApiContextFromRequest({ req, runtimeScope });
    const activation = await activateConnectorForKnowledgeBaseRuntime({
      connectorId,
      ctx,
      knowledgeBaseId,
    });

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: {
        resourceType: 'knowledge_base',
        resourceId: knowledgeBaseId,
        workspaceId,
      },
      result: 'succeeded',
      context: auditContext,
      payloadJson: {
        operation: 'activate_connector_runtime',
        connectorId,
        runtimeConnectorId: activation.connectorId,
        projectId: activation.projectId,
      },
      afterJson: activation.selector,
    });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: activation,
      runtimeScope,
      apiType: ApiType.UPDATE_CONNECTOR,
      startTime,
      requestPayload: {
        id: connectorId,
        operation: 'activate_connector_runtime',
      },
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.UPDATE_CONNECTOR,
      requestPayload: {
        id: req.query.id,
        operation: 'activate_connector_runtime',
      },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
