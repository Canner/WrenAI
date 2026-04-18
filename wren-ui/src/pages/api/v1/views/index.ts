import type { NextApiRequest, NextApiResponse } from 'next';
import { isEmpty } from 'lodash';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  deriveRuntimeExecutionContextFromRequest,
  handleApiError,
  respondWithSimple,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { replaceAllowableSyntax } from '@server/utils/regex';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_VIEWS');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  askingService,
  modelService,
  queryService,
  viewRepository,
  auditEventRepository,
} = components;

type CreateViewRequest = {
  name?: string;
  responseId?: number;
  rephrasedQuestion?: string;
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

const resolveCreateViewPayload = (
  payload: unknown,
): Required<CreateViewRequest> => {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError('创建视图参数无效', 400);
  }

  const source = payload as CreateViewRequest;
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const rephrasedQuestion =
    typeof source.rephrasedQuestion === 'string'
      ? source.rephrasedQuestion
      : '';
  const responseId =
    typeof source.responseId === 'number'
      ? source.responseId
      : Number.parseInt(String(source.responseId || ''), 10);

  if (!name) {
    throw new ApiError('View name is required', 400);
  }
  if (!Number.isFinite(responseId) || responseId <= 0) {
    throw new ApiError('Response ID is invalid', 400);
  }

  return {
    name,
    responseId,
    rephrasedQuestion,
  };
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
    const resource = buildKnowledgeBaseWriteResource(runtimeScope);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    });
    await assertAuthorizedWithAudit({
      auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource,
      context: auditContext,
    });

    const {
      name: displayName,
      responseId,
      rephrasedQuestion,
    } = resolveCreateViewPayload(req.body);
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);

    await askingService.assertResponseScope(responseId, runtimeIdentity);

    const validateResult = await modelService.validateViewNameByRuntimeIdentity(
      runtimeIdentity,
      displayName,
    );
    if (!validateResult.valid) {
      throw new ApiError(validateResult.message || 'View name is invalid', 400);
    }

    const response = await askingService.getResponseScoped(
      responseId,
      runtimeIdentity,
    );
    if (!response) {
      throw new ApiError(`Thread response ${responseId} not found`, 404);
    }
    if (!response.sql) {
      throw new ApiError(`Thread response ${responseId} has no SQL`, 400);
    }

    const statement = safeFormatSQL(response.sql);
    const { columns } = await queryService.describeStatement(statement, {
      project: executionContext.project,
      limit: 1,
      modelingOnly: false,
      manifest: executionContext.manifest,
    });

    if (isEmpty(columns)) {
      throw new Error('Failed to describe statement');
    }

    const createdView = await viewRepository.createOne({
      ...runtimeIdentity,
      name: replaceAllowableSyntax(displayName),
      statement,
      properties: JSON.stringify({
        displayName,
        columns,
        responseId,
        question: rephrasedQuestion,
      }),
    });

    const responsePayload = {
      ...createdView,
      displayName,
    };

    await recordAuditEvent({
      auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource,
      result: 'succeeded',
      context: auditContext,
      afterJson: responsePayload as any,
      payloadJson: {
        operation: 'create_view',
      },
    });

    await respondWithSimple({
      res,
      statusCode: 201,
      responsePayload,
      runtimeScope,
      apiType: ApiType.CREATE_VIEW,
      requestPayload: {
        responseId,
        displayName,
      },
      headers: req.headers as Record<string, string>,
      startTime,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.CREATE_VIEW,
      requestPayload: req.body && typeof req.body === 'object' ? req.body : {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
