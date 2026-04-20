import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  requirePersistedWorkspaceId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@/server/authz';

const logger = getLogger('API_CONNECTOR_TABLES');
logger.level = 'debug';

const { runtimeScopeResolver, connectorService } = components;

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
    if (req.method !== 'GET') {
      throw new ApiError('Method not allowed', 405);
    }

    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
    const connectorId = validateConnectorId(req.query.id);
    const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);

    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'connector.read',
      resource: {
        resourceType: 'connector',
        resourceId: connectorId,
        workspaceId,
      },
      context: buildAuthorizationContextFromRequest({
        req,
        sessionId: actor?.sessionId,
        runtimeScope,
      }),
    });

    const tables = await connectorService.listConnectorTables(
      workspaceId,
      connectorId,
    );

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: tables,
      runtimeScope,
      apiType: ApiType.GET_CONNECTORS,
      startTime,
      requestPayload: { id: connectorId, operation: 'list_connector_tables' },
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.GET_CONNECTORS,
      requestPayload: { id: req.query.id, operation: 'list_connector_tables' },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
