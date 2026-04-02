import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

const logger = getLogger('API_SKILL_BINDINGS');
logger.level = 'debug';

const { runtimeScopeResolver, skillService } = components;

interface CreateSkillBindingRequest {
  kbSnapshotId?: string | null;
  skillDefinitionId: string;
  connectorId?: string | null;
  bindingConfig?: Record<string, any> | null;
  enabled?: boolean;
}

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

const validateSkillBindingPayload = (
  payload: Partial<CreateSkillBindingRequest>,
  requireSkillDefinitionId: boolean,
) => {
  if (
    requireSkillDefinitionId &&
    (!payload.skillDefinitionId ||
      payload.skillDefinitionId.trim().length === 0)
  ) {
    throw new ApiError('Skill definition ID is required', 400);
  }

  if (
    payload.bindingConfig !== undefined &&
    payload.bindingConfig !== null &&
    (typeof payload.bindingConfig !== 'object' ||
      Array.isArray(payload.bindingConfig))
  ) {
    throw new ApiError('Binding config must be an object', 400);
  }
};

const handleListSkillBindings = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const knowledgeBaseId = requireKnowledgeBaseId(runtimeScope);
  const bindings =
    await skillService.listSkillBindingsByKnowledgeBase(knowledgeBaseId);

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: bindings.map(toSkillBindingResponse),
    projectId: project.id,
    runtimeScope,
    apiType: ApiType.GET_SKILL_BINDINGS,
    startTime,
    requestPayload: {},
    headers: req.headers as Record<string, string>,
  });
};

const handleCreateSkillBinding = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const knowledgeBaseId = requireKnowledgeBaseId(runtimeScope);
  const payload = req.body as CreateSkillBindingRequest;
  validateSkillBindingPayload(payload, true);

  const skillBinding = await skillService.createSkillBinding({
    knowledgeBaseId,
    kbSnapshotId: payload.kbSnapshotId,
    skillDefinitionId: payload.skillDefinitionId.trim(),
    connectorId: payload.connectorId,
    bindingConfig: payload.bindingConfig,
    enabled: payload.enabled,
    createdBy: runtimeScope.userId || undefined,
  });

  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: toSkillBindingResponse(skillBinding),
    projectId: project.id,
    runtimeScope,
    apiType: ApiType.CREATE_SKILL_BINDING,
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
      await handleListSkillBindings(req, res, runtimeScope, project, startTime);
      return;
    }

    if (req.method === 'POST') {
      await handleCreateSkillBinding(
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
          : ApiType.CREATE_SKILL_BINDING,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
