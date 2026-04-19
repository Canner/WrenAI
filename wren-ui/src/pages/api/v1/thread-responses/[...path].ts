import type { NextApiRequest, NextApiResponse } from 'next';
import type { ChartAdjustmentOption } from '@server/models/adaptor';
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
} from '@server/authz';
import {
  resolveProjectLanguage,
  resolveRuntimeProject,
} from '@server/utils/runtimeExecutionContext';
import { serializeThreadResponsePayload } from '@/server/api/threadPayloadSerializers';

const logger = getLogger('API_THREAD_RESPONSE_ACTION');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  askingService,
  auditEventRepository,
  modelService,
  sqlPairService,
  projectService,
} = components;

const getKnowledgeBaseReadAuthorizationTarget = (runtimeScope: any) => ({
  actor: buildAuthorizationActorFromRuntimeScope(runtimeScope),
  resource: {
    resourceType: runtimeScope?.knowledgeBase ? 'knowledge_base' : 'workspace',
    resourceId: runtimeScope?.knowledgeBase?.id || runtimeScope?.workspace?.id,
    workspaceId: runtimeScope?.workspace?.id || null,
    attributes: {
      workspaceKind: runtimeScope?.workspace?.kind || null,
      knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
    },
  },
});

const assertKnowledgeBaseReadAccess = async ({
  req,
  runtimeScope,
}: {
  req: NextApiRequest;
  runtimeScope: any;
}) => {
  const { actor, resource } =
    getKnowledgeBaseReadAuthorizationTarget(runtimeScope);

  await assertAuthorizedWithAudit({
    auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
    context: buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    }),
  });
};

const parseThreadResponseActionPath = (
  value: string | string[] | undefined,
): {
  responseId: number;
  action: 'generate-answer' | 'generate-chart' | 'adjust-chart';
} => {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ApiError('Route not found', 404);
  }

  const responseId = Number.parseInt(String(value[0] || ''), 10);
  if (!Number.isFinite(responseId) || responseId <= 0) {
    throw new ApiError('Response ID is invalid', 400);
  }

  const action = value[1];
  if (
    action !== 'generate-answer' &&
    action !== 'generate-chart' &&
    action !== 'adjust-chart'
  ) {
    throw new ApiError('Route not found', 404);
  }

  return { responseId, action };
};

const resolveChartAdjustmentPayload = (
  payload: unknown,
): ChartAdjustmentOption => {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError('Chart adjustment payload is required', 400);
  }

  return payload as ChartAdjustmentOption;
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
    await assertKnowledgeBaseReadAccess({
      req,
      runtimeScope,
    });
    const { responseId, action } = parseThreadResponseActionPath(
      req.query.path,
    );
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const project = projectService
      ? await resolveRuntimeProject(runtimeScope, projectService)
      : runtimeScope?.project || null;
    const language = resolveProjectLanguage(
      project,
      runtimeScope?.knowledgeBase,
    );

    const response =
      action === 'generate-answer'
        ? await askingService.generateThreadResponseAnswerScoped(
            responseId,
            runtimeIdentity,
            { language },
          )
        : action === 'generate-chart'
          ? await askingService.generateThreadResponseChartScoped(
              responseId,
              runtimeIdentity,
              { language },
              runtimeScope?.selector?.runtimeScopeId || null,
            )
          : await askingService.adjustThreadResponseChartScoped(
              responseId,
              runtimeIdentity,
              resolveChartAdjustmentPayload(req.body),
              { language },
              runtimeScope?.selector?.runtimeScopeId || null,
            );

    const responsePayload = await serializeThreadResponsePayload({
      response,
      runtimeIdentity,
      services: {
        askingService,
        modelService,
        sqlPairService,
      },
    });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload,
      runtimeScope,
      apiType: ApiType.ASK,
      requestPayload: {
        id: responseId,
        action,
        data:
          action === 'adjust-chart' && req.body && typeof req.body === 'object'
            ? req.body
            : null,
      },
      headers: req.headers as Record<string, string>,
      startTime,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.ASK,
      requestPayload: {
        path: req.query.path || null,
        data: req.body && typeof req.body === 'object' ? req.body : null,
      },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
