import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

const logger = getLogger('API_SKILL_BINDING_BY_ID');
logger.level = 'debug';

const { runtimeScopeResolver, skillService } = components;

interface UpdateSkillBindingRequest {
  kbSnapshotId?: string | null;
  connectorId?: string | null;
  bindingConfig?: Record<string, any> | null;
  enabled?: boolean;
}

const validateSkillBindingId = (id: any): string => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('Skill binding ID is required', 400);
  }

  return id;
};

const requireKnowledgeBaseId = (runtimeScope: any) => {
  const knowledgeBaseId = runtimeScope.knowledgeBase?.id;
  if (!knowledgeBaseId) {
    throw new ApiError('Knowledge base scope is required', 400);
  }

  return knowledgeBaseId as string;
};

const toSkillBindingResponse = (skillBinding: any) => ({
  id: skillBinding.id,
  knowledgeBaseId: skillBinding.knowledgeBaseId,
  kbSnapshotId: skillBinding.kbSnapshotId ?? null,
  skillDefinitionId: skillBinding.skillDefinitionId,
  connectorId: skillBinding.connectorId ?? null,
  bindingConfig: skillBinding.bindingConfig ?? null,
  enabled: Boolean(skillBinding.enabled),
  createdBy: skillBinding.createdBy ?? null,
});

const validateBindingUpdatePayload = (payload: UpdateSkillBindingRequest) => {
  if (
    payload.bindingConfig !== undefined &&
    payload.bindingConfig !== null &&
    (typeof payload.bindingConfig !== 'object' ||
      Array.isArray(payload.bindingConfig))
  ) {
    throw new ApiError('Binding config must be an object', 400);
  }
};

const getScopedSkillBinding = async (id: string, knowledgeBaseId: string) => {
  const skillBinding = await skillService.getSkillBindingById(id);
  if (!skillBinding || skillBinding.knowledgeBaseId !== knowledgeBaseId) {
    throw new ApiError('Skill binding not found', 404);
  }

  return skillBinding;
};

const handleGetSkillBinding = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const knowledgeBaseId = requireKnowledgeBaseId(runtimeScope);
  const skillBinding = await getScopedSkillBinding(
    validateSkillBindingId(req.query.id),
    knowledgeBaseId,
  );

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: toSkillBindingResponse(skillBinding),
    projectId: project.id,
    runtimeScope,
    apiType: ApiType.GET_SKILL_BINDINGS,
    startTime,
    requestPayload: { id: req.query.id },
    headers: req.headers as Record<string, string>,
  });
};

const handleUpdateSkillBinding = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const knowledgeBaseId = requireKnowledgeBaseId(runtimeScope);
  const skillBindingId = validateSkillBindingId(req.query.id);
  await getScopedSkillBinding(skillBindingId, knowledgeBaseId);

  const payload = req.body as UpdateSkillBindingRequest;
  validateBindingUpdatePayload(payload);

  const updatedSkillBinding = await skillService.updateSkillBinding(
    skillBindingId,
    {
      kbSnapshotId: payload.kbSnapshotId,
      connectorId: payload.connectorId,
      bindingConfig: payload.bindingConfig,
      enabled: payload.enabled,
    },
  );

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: toSkillBindingResponse(updatedSkillBinding),
    projectId: project.id,
    runtimeScope,
    apiType: ApiType.UPDATE_SKILL_BINDING,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

const handleDeleteSkillBinding = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const knowledgeBaseId = requireKnowledgeBaseId(runtimeScope);
  const skillBindingId = validateSkillBindingId(req.query.id);
  await getScopedSkillBinding(skillBindingId, knowledgeBaseId);

  await skillService.deleteSkillBinding(skillBindingId);

  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    projectId: project.id,
    runtimeScope,
    apiType: ApiType.DELETE_SKILL_BINDING,
    startTime,
    requestPayload: { id: skillBindingId },
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
      await handleGetSkillBinding(req, res, runtimeScope, project, startTime);
      return;
    }

    if (req.method === 'PUT') {
      await handleUpdateSkillBinding(
        req,
        res,
        runtimeScope,
        project,
        startTime,
      );
      return;
    }

    if (req.method === 'DELETE') {
      await handleDeleteSkillBinding(
        req,
        res,
        runtimeScope,
        project,
        startTime,
      );
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
          ? ApiType.GET_SKILL_BINDINGS
          : req.method === 'PUT'
            ? ApiType.UPDATE_SKILL_BINDING
            : ApiType.DELETE_SKILL_BINDING,
      requestPayload:
        req.method === 'DELETE' ? { id: req.query.id } : (req.body ?? {}),
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
