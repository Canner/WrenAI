import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  deriveRuntimeExecutionContextFromRequest,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import { getPreviewColumnsStr } from '@server/utils/model';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_MODEL_PREVIEW');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  modelService,
  modelColumnRepository,
  queryService,
  auditEventRepository,
} = components;

const parseModelId = (id: string | string[] | undefined) => {
  const value = Array.isArray(id) ? id[0] : id;
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError('Model ID is invalid', 400);
  }

  return parsed;
};

const parseLimit = (limit: string | string[] | undefined) => {
  const value = Array.isArray(limit) ? limit[0] : limit;
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError('Preview limit is invalid', 400);
  }

  return parsed;
};

const buildKnowledgeBaseReadResource = (runtimeScope: any) => ({
  resourceType: runtimeScope?.knowledgeBase ? 'knowledge_base' : 'workspace',
  resourceId: runtimeScope?.knowledgeBase?.id || runtimeScope?.workspace?.id,
  workspaceId: runtimeScope?.workspace?.id || null,
  attributes: {
    workspaceKind: runtimeScope?.workspace?.kind || null,
    knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
  },
});

const buildModelAuditResource = (runtimeScope: any, modelId: number) => ({
  resourceType: 'model',
  resourceId: String(modelId),
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
    if (req.method !== 'GET') {
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
    const executionContext = derivedContext.executionContext;
    if (!executionContext) {
      throw new ApiError(
        'No deployment found, please deploy your project first',
        400,
      );
    }

    const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
    const authorizationResource = buildKnowledgeBaseReadResource(runtimeScope);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    });
    await assertAuthorizedWithAudit({
      auditEventRepository,
      actor,
      action: 'knowledge_base.read',
      resource: authorizationResource,
      context: auditContext,
    });

    const modelId = parseModelId(req.query.id);
    const limit = parseLimit(req.query.limit);
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const model = await modelService.getModelByRuntimeIdentity(
      runtimeIdentity,
      modelId,
    );
    if (!model) {
      throw new ApiError(`Model ${modelId} not found`, 404);
    }

    const modelColumns = await modelColumnRepository.findColumnsByModelIds([
      model.id,
    ]);
    const sql = `select ${getPreviewColumnsStr(modelColumns)} from "${model.referenceName}"`;
    const responsePayload = await queryService.preview(sql, {
      project: executionContext.project,
      limit,
      manifest: executionContext.manifest,
      modelingOnly: false,
    });

    await recordAuditEvent({
      auditEventRepository,
      actor,
      action: 'knowledge_base.read',
      resource: buildModelAuditResource(runtimeScope, modelId),
      result: 'succeeded',
      context: auditContext,
      payloadJson: {
        operation: 'preview_model_data',
        limit: limit ?? null,
      },
    });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload,
      runtimeScope,
      apiType: ApiType.PREVIEW_MODEL_DATA,
      requestPayload: {
        id: modelId,
        limit: limit ?? null,
      },
      headers: req.headers as Record<string, string>,
      startTime,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.PREVIEW_MODEL_DATA,
      requestPayload: {
        id: Array.isArray(req.query.id)
          ? req.query.id[0]
          : req.query.id || null,
        limit: Array.isArray(req.query.limit)
          ? req.query.limit[0]
          : req.query.limit || null,
      },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
