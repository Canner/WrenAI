import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
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

const logger = getLogger('API_MODEL_LIST');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  modelService,
  modelColumnRepository,
  modelNestedColumnRepository,
  auditEventRepository,
} = components;

const parseJsonObject = (value?: string | null): Record<string, any> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
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

    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const models =
      await modelService.listModelsByRuntimeIdentity(runtimeIdentity);
    const modelIds = models.map((model) => model.id);
    const modelColumns =
      await modelColumnRepository.findColumnsByModelIds(modelIds);
    const modelNestedColumns =
      await modelNestedColumnRepository.findNestedColumnsByModelIds(modelIds);

    const responsePayload = models.map((model) => {
      const modelFields = modelColumns
        .filter((column) => column.modelId === model.id)
        .map((column) => ({
          ...column,
          properties: parseJsonObject(column.properties),
          nestedColumns: String(column.type || '').includes('STRUCT')
            ? modelNestedColumns.filter(
                (nestedColumn) => nestedColumn.columnId === column.id,
              )
            : undefined,
        }));

      return {
        ...model,
        fields: modelFields.filter((column) => !column.isCalculated),
        calculatedFields: modelFields.filter((column) => column.isCalculated),
        properties: {
          ...parseJsonObject(model.properties),
        },
      };
    });

    await recordAuditEvent({
      auditEventRepository,
      actor,
      action: 'knowledge_base.read',
      resource: authorizationResource,
      result: 'succeeded',
      context: auditContext,
      payloadJson: {
        operation: 'list_models',
      },
    });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload,
      runtimeScope,
      apiType: ApiType.GET_MODELS,
      headers: req.headers as Record<string, string>,
      startTime,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.GET_MODELS,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
