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
import {
  toSkillMarketplaceCatalogResponse,
  toSkillResponse,
} from '@server/api/skills/shared';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_SKILL_MARKETPLACE');
logger.level = 'debug';

const { runtimeScopeResolver, skillService } = components;

interface InstallSkillRequest {
  catalogId: string;
}

const validateInstallPayload = (payload: Partial<InstallSkillRequest>) => {
  if (!payload.catalogId || typeof payload.catalogId !== 'string') {
    throw new ApiError('Skill catalogId is required', 400);
  }

  if (payload.catalogId.trim().length === 0) {
    throw new ApiError('Skill catalogId cannot be empty', 400);
  }
};

const handleListMarketplaceSkills = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
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

  const catalogSkills = await skillService.listMarketplaceCatalogSkills();

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: catalogSkills.map(toSkillMarketplaceCatalogResponse),
    runtimeScope,
    apiType: ApiType.GET_SKILLS,
    startTime,
    requestPayload: {},
    headers: req.headers as Record<string, string>,
  });
};

const handleInstallMarketplaceSkill = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  const payload = req.body as InstallSkillRequest;
  validateInstallPayload(payload);

  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'skill.create',
    resource: {
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
    },
    context: auditContext,
  });

  const skillDefinition = await skillService.installSkillFromMarketplace({
    workspaceId,
    catalogId: payload.catalogId.trim(),
    userId: runtimeIdentity.actorUserId || undefined,
  });

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'skill.create',
    resource: {
      resourceType: 'skill_definition',
      resourceId: skillDefinition.id,
      workspaceId,
    },
    result: 'succeeded',
    context: auditContext,
    afterJson: skillDefinition as any,
  });

  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: toSkillResponse(skillDefinition),
    runtimeScope,
    apiType: ApiType.CREATE_SKILL,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);

    if (req.method === 'GET') {
      await handleListMarketplaceSkills(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'POST') {
      await handleInstallMarketplaceSkill(req, res, runtimeScope, startTime);
      return;
    }

    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: req.method === 'GET' ? ApiType.GET_SKILLS : ApiType.CREATE_SKILL,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
