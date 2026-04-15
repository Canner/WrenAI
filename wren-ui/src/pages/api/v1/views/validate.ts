import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';

const logger = getLogger('API_VALIDATE_VIEW');
logger.level = 'debug';

const { runtimeScopeResolver, modelService, auditEventRepository } = components;

type ValidateViewRequest = {
  name?: string;
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

const resolveValidateViewPayload = (
  payload: unknown,
): Required<ValidateViewRequest> => {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError('视图名称不能为空', 400);
  }

  const source = payload as ValidateViewRequest;
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  if (!name) {
    throw new ApiError('视图名称不能为空', 400);
  }

  return { name };
};

const respondWithValidationError = (
  res: NextApiResponse,
  error: unknown,
): void => {
  const statusCode =
    error instanceof ApiError
      ? error.statusCode
      : typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
  const message =
    error instanceof Error ? error.message : '校验视图名称失败，请稍后重试';

  res.status(statusCode).json({ error: message });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  try {
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    const runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
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

    const { name } = resolveValidateViewPayload(req.body);
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const validation = await modelService.validateViewNameByRuntimeIdentity(
      runtimeIdentity,
      name,
    );

    res.status(200).json(validation);
    return;
  } catch (error) {
    logger.error('Error in validate view API:', error);
    respondWithValidationError(res, error);
  }
}
