import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

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
}

const validateSkillId = (id: any): string => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('Skill ID is required', 400);
  }

  return id;
};

const requireWorkspaceId = (runtimeScope: any) => {
  const workspaceId = runtimeScope.workspace?.id;
  if (!workspaceId) {
    throw new ApiError('Workspace scope is required', 400);
  }

  return workspaceId as string;
};

const toSkillResponse = (skillDefinition: any) => ({
  id: skillDefinition.id,
  workspaceId: skillDefinition.workspaceId,
  name: skillDefinition.name,
  runtimeKind: skillDefinition.runtimeKind,
  sourceType: skillDefinition.sourceType,
  sourceRef: skillDefinition.sourceRef ?? null,
  entrypoint: skillDefinition.entrypoint ?? null,
  manifest: skillDefinition.manifestJson ?? null,
  createdBy: skillDefinition.createdBy ?? null,
});

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
  project: any,
  startTime: number,
) => {
  const workspaceId = requireWorkspaceId(runtimeScope);
  const skillDefinition = await getScopedSkillDefinition(
    validateSkillId(req.query.id),
    workspaceId,
  );

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: toSkillResponse(skillDefinition),
    projectId: project.id,
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
  project: any,
  startTime: number,
) => {
  const workspaceId = requireWorkspaceId(runtimeScope);
  const skillId = validateSkillId(req.query.id);
  await getScopedSkillDefinition(skillId, workspaceId);

  const payload = req.body as UpdateSkillRequest;
  validateUpdatePayload(payload);

  const updatedSkillDefinition = await skillService.updateSkillDefinition(
    skillId,
    {
      name: payload.name?.trim(),
      runtimeKind: payload.runtimeKind,
      sourceType: payload.sourceType,
      sourceRef: payload.sourceRef,
      entrypoint: payload.entrypoint,
      manifest: payload.manifest,
    },
  );

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: toSkillResponse(updatedSkillDefinition),
    projectId: project.id,
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
  project: any,
  startTime: number,
) => {
  const workspaceId = requireWorkspaceId(runtimeScope);
  const skillId = validateSkillId(req.query.id);
  await getScopedSkillDefinition(skillId, workspaceId);

  await skillService.deleteSkillDefinition(skillId);

  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    projectId: project.id,
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
  let project;
  let runtimeScope;

  try {
    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    project = runtimeScope.project;

    if (req.method === 'GET') {
      await handleGetSkill(req, res, runtimeScope, project, startTime);
      return;
    }

    if (req.method === 'PUT') {
      await handleUpdateSkill(req, res, runtimeScope, project, startTime);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDeleteSkill(req, res, runtimeScope, project, startTime);
      return;
    }

    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      runtimeScope,
      apiType:
        req.method === 'GET'
          ? ApiType.GET_SKILLS
          : req.method === 'PUT'
            ? ApiType.UPDATE_SKILL
            : ApiType.DELETE_SKILL,
      requestPayload:
        req.method === 'DELETE' ? { id: req.query.id } : (req.body ?? {}),
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
