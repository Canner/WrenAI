import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  handleApiError,
  respondWithSimple,
  ApiError,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  requirePersistedWorkspaceId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import { toSkillResponse } from './shared';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';

const logger = getLogger('API_AVAILABLE_SKILLS');
logger.level = 'debug';

const { runtimeScopeResolver, skillService } = components;

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
    const workspaceId = requirePersistedWorkspaceId(
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope),
    );
    const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'skill.read',
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
    const skills = await skillService.listAvailableSkills(workspaceId);

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: skills.map(toSkillResponse),
      runtimeScope,
      apiType: ApiType.GET_SKILLS,
      startTime,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.GET_SKILLS,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
