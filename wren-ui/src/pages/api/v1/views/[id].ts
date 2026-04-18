import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  deriveRuntimeExecutionContextFromRequest,
  handleApiError,
  respondWithSimple,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_VIEW_BY_ID');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  modelService,
  viewRepository,
  auditEventRepository,
} = components;

const parseViewId = (id: string | string[] | undefined) => {
  const value = Array.isArray(id) ? id[0] : id;
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError('View ID is invalid', 400);
  }

  return parsed;
};

const buildKnowledgeBaseWriteResource = (runtimeScope: any) => ({
  resourceType: runtimeScope?.knowledgeBase ? 'knowledge_base' : 'workspace',
  resourceId: runtimeScope?.knowledgeBase?.id || runtimeScope?.workspace?.id,
  workspaceId: runtimeScope?.workspace?.id || null,
  attributes: {
    workspaceKind: runtimeScope?.workspace?.kind || null,
    knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
  },
});

const buildViewAuditResource = (runtimeScope: any, viewId: number) => ({
  resourceType: 'view',
  resourceId: String(viewId),
  workspaceId: runtimeScope?.workspace?.id || null,
  attributes: {
    workspaceKind: runtimeScope?.workspace?.kind || null,
    knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
  },
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    if (req.method !== 'DELETE') {
      throw new ApiError('Method not allowed', 405);
    }

    const derivedContext = await deriveRuntimeExecutionContextFromRequest({
      req,
      runtimeScopeResolver,
      noDeploymentMessage:
        'No deployment found, please deploy your project first',
      requireLatestExecutableSnapshot: true,
    });

    runtimeScope = derivedContext.runtimeScope;
    const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
    const authorizationResource = buildKnowledgeBaseWriteResource(runtimeScope);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    });
    await assertAuthorizedWithAudit({
      auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: authorizationResource,
      context: auditContext,
    });

    const viewId = parseViewId(req.query.id);
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const view = await modelService.getViewByRuntimeIdentity(
      runtimeIdentity,
      viewId,
    );
    if (!view) {
      throw new ApiError(`View ${viewId} not found`, 404);
    }

    await viewRepository.deleteOne(viewId);

    await recordAuditEvent({
      auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: buildViewAuditResource(runtimeScope, viewId),
      result: 'succeeded',
      context: auditContext,
      beforeJson: view as any,
      payloadJson: {
        operation: 'delete_view',
      },
    });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: { success: true },
      runtimeScope,
      apiType: ApiType.DELETE_VIEW,
      requestPayload: {
        id: viewId,
      },
      headers: req.headers as Record<string, string>,
      startTime,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.DELETE_VIEW,
      requestPayload: {
        id: Array.isArray(req.query.id)
          ? req.query.id[0]
          : req.query.id || null,
      },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
