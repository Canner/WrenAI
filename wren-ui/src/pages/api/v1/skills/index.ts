import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  handleApiError,
  respondWithSimple,
  ApiError,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  requirePersistedWorkspaceId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import {
  toSkillResponse,
  toSkillRuntimeInput,
  validateSkillRuntimePayload,
  type SkillRuntimeMutationRequest,
} from './shared';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_SKILLS');
logger.level = 'debug';

const { runtimeScopeResolver, skillService } = components;

interface CreateSkillRequest {
  name: string;
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifest?: Record<string, any> | null;
  secret?: Record<string, any> | null;
}

type CreateSkillMutationRequest = CreateSkillRequest &
  SkillRuntimeMutationRequest;

const validateSkillPayload = (
  payload: Partial<CreateSkillRequest>,
  requireName: boolean,
) => {
  if (requireName && (!payload.name || payload.name.trim().length === 0)) {
    throw new ApiError('Skill name is required', 400);
  }

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

const handleListSkills = async (
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
  const skills =
    await skillService.listSkillDefinitionsByWorkspace(workspaceId);

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
};

const handleCreateSkill = async (
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
  const payload = req.body as CreateSkillMutationRequest;
  validateSkillPayload(payload, true);
  validateSkillRuntimePayload(payload);
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

  const skillDefinition = await skillService.createSkillDefinition({
    workspaceId,
    name: payload.name.trim(),
    runtimeKind: payload.runtimeKind,
    sourceType: payload.sourceType,
    sourceRef: payload.sourceRef,
    entrypoint: payload.entrypoint,
    manifest: payload.manifest,
    secret: payload.secret,
    ...toSkillRuntimeInput(payload),
    createdBy: runtimeIdentity.actorUserId || undefined,
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
      await handleListSkills(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'POST') {
      await handleCreateSkill(req, res, runtimeScope, startTime);
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
