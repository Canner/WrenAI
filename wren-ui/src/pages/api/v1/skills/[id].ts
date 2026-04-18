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
  hasSkillRuntimePayload,
  toSkillResponse,
  toSkillRuntimeInput,
  validateSkillId,
  validateSkillRuntimePayload,
  type SkillRuntimeMutationRequest,
} from './shared';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_SKILL_BY_ID');
logger.level = 'debug';

const { runtimeScopeResolver, skillService } = components;

interface UpdateSkillRequest {
  name?: string;
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifest?: Record<string, any> | null;
  secret?: Record<string, any> | null;
}

type UpdateSkillMutationRequest = UpdateSkillRequest &
  SkillRuntimeMutationRequest;

const validateUpdatePayload = (payload: UpdateSkillRequest) => {
  if (payload.name !== undefined && payload.name.trim().length === 0) {
    throw new ApiError('Skill name cannot be empty', 400);
  }

  if (
    payload.manifest !== undefined &&
    payload.manifest !== null &&
    (typeof payload.manifest !== 'object' || Array.isArray(payload.manifest))
  ) {
    throw new ApiError('Skill manifest must be an object', 400);
  }

  if (
    payload.secret !== undefined &&
    payload.secret !== null &&
    (typeof payload.secret !== 'object' || Array.isArray(payload.secret))
  ) {
    throw new ApiError('Skill secret must be an object', 400);
  }
};

const getScopedSkillDefinition = async (id: string, workspaceId: string) => {
  const skillDefinition = await skillService.getSkillDefinitionById(id);
  if (!skillDefinition || skillDefinition.workspaceId !== workspaceId) {
    throw new ApiError('Skill not found', 404);
  }

  return skillDefinition;
};

const handleGetSkill = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const workspaceId = requirePersistedWorkspaceId(
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope),
  );
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const skillDefinition = await getScopedSkillDefinition(
    validateSkillId(req.query.id),
    workspaceId,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'skill.read',
    resource: {
      resourceType: 'skill_definition',
      resourceId: skillDefinition.id,
      workspaceId,
    },
    context: buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    }),
  });

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: toSkillResponse(skillDefinition),
    runtimeScope,
    apiType: ApiType.GET_SKILLS,
    startTime,
    requestPayload: { id: req.query.id },
    headers: req.headers as Record<string, string>,
  });
};

const handleUpdateSkill = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const workspaceId = requirePersistedWorkspaceId(
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope),
  );
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  const skillId = validateSkillId(req.query.id);
  const existingSkillDefinition = await getScopedSkillDefinition(
    skillId,
    workspaceId,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'skill.update',
    resource: {
      resourceType: 'skill_definition',
      resourceId: existingSkillDefinition.id,
      workspaceId,
    },
    context: auditContext,
  });

  const payload = req.body as UpdateSkillMutationRequest;
  validateUpdatePayload(payload);
  validateSkillRuntimePayload(payload);

  let updatedSkillDefinition = existingSkillDefinition;
  const hasBasePayload =
    payload.name !== undefined ||
    payload.runtimeKind !== undefined ||
    payload.sourceType !== undefined ||
    Object.prototype.hasOwnProperty.call(payload, 'sourceRef') ||
    Object.prototype.hasOwnProperty.call(payload, 'entrypoint') ||
    Object.prototype.hasOwnProperty.call(payload, 'manifest') ||
    Object.prototype.hasOwnProperty.call(payload, 'secret');

  if (hasBasePayload) {
    updatedSkillDefinition = await skillService.updateSkillDefinition(skillId, {
      name: payload.name?.trim(),
      runtimeKind: payload.runtimeKind,
      sourceType: payload.sourceType,
      sourceRef: payload.sourceRef,
      entrypoint: payload.entrypoint,
      manifest: payload.manifest,
      secret: payload.secret,
    });
  }

  if (hasSkillRuntimePayload(payload)) {
    updatedSkillDefinition = await skillService.updateSkillDefinitionRuntime(
      skillId,
      toSkillRuntimeInput(payload),
    );
  }

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'skill.update',
    resource: {
      resourceType: 'skill_definition',
      resourceId: existingSkillDefinition.id,
      workspaceId,
    },
    result: 'succeeded',
    context: auditContext,
    beforeJson: existingSkillDefinition as any,
    afterJson: updatedSkillDefinition as any,
  });

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: toSkillResponse(updatedSkillDefinition),
    runtimeScope,
    apiType: ApiType.UPDATE_SKILL,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

const handleDeleteSkill = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const workspaceId = requirePersistedWorkspaceId(
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope),
  );
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  const skillId = validateSkillId(req.query.id);
  const existingSkillDefinition = await getScopedSkillDefinition(
    skillId,
    workspaceId,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'skill.delete',
    resource: {
      resourceType: 'skill_definition',
      resourceId: existingSkillDefinition.id,
      workspaceId,
    },
    context: auditContext,
  });

  await skillService.deleteSkillDefinition(skillId);

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'skill.delete',
    resource: {
      resourceType: 'skill_definition',
      resourceId: existingSkillDefinition.id,
      workspaceId,
    },
    result: 'succeeded',
    context: auditContext,
    beforeJson: existingSkillDefinition as any,
  });

  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    runtimeScope,
    apiType: ApiType.DELETE_SKILL,
    startTime,
    requestPayload: { id: skillId },
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
      await handleGetSkill(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'PUT') {
      await handleUpdateSkill(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDeleteSkill(req, res, runtimeScope, startTime);
      return;
    }

    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType:
        req.method === 'GET'
          ? ApiType.GET_SKILLS
          : req.method === 'PUT'
            ? ApiType.UPDATE_SKILL
            : ApiType.DELETE_SKILL,
      requestPayload:
        req.method === 'DELETE' ? { id: req.query.id } : req.body ?? {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
