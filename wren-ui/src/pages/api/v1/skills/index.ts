import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

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
}

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
};

const handleListSkills = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const workspaceId = requireWorkspaceId(runtimeScope);
  const skills = await skillService.listSkillDefinitionsByWorkspace(workspaceId);

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: skills.map(toSkillResponse),
    projectId: project.id,
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
  project: any,
  startTime: number,
) => {
  const workspaceId = requireWorkspaceId(runtimeScope);
  const payload = req.body as CreateSkillRequest;
  validateSkillPayload(payload, true);

  const skillDefinition = await skillService.createSkillDefinition({
    workspaceId,
    name: payload.name.trim(),
    runtimeKind: payload.runtimeKind,
    sourceType: payload.sourceType,
    sourceRef: payload.sourceRef,
    entrypoint: payload.entrypoint,
    manifest: payload.manifest,
    createdBy: runtimeScope.userId || undefined,
  });

  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: toSkillResponse(skillDefinition),
    projectId: project.id,
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
  let project;
  let runtimeScope;

  try {
    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    project = runtimeScope.project;

    if (req.method === 'GET') {
      await handleListSkills(req, res, runtimeScope, project, startTime);
      return;
    }

    if (req.method === 'POST') {
      await handleCreateSkill(req, res, runtimeScope, project, startTime);
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
        req.method === 'GET' ? ApiType.GET_SKILLS : ApiType.CREATE_SKILL,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
