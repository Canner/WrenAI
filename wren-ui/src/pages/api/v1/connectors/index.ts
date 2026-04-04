import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

const logger = getLogger('API_CONNECTORS');
logger.level = 'debug';

const { runtimeScopeResolver, connectorService } = components;

interface CreateConnectorRequest {
  knowledgeBaseId?: string | null;
  type: string;
  displayName: string;
  config?: Record<string, any> | null;
  secret?: Record<string, any> | null;
}

const requireWorkspaceId = (runtimeScope: any) => {
  const workspaceId = runtimeScope.workspace?.id;
  if (!workspaceId) {
    throw new ApiError('Workspace scope is required', 400);
  }

  return workspaceId as string;
};

const resolveKnowledgeBaseId = (
  runtimeScope: any,
  payload?: { knowledgeBaseId?: string | null },
) => {
  const runtimeKnowledgeBaseId = runtimeScope.knowledgeBase?.id;
  if (runtimeKnowledgeBaseId) {
    return runtimeKnowledgeBaseId as string;
  }

  if (payload?.knowledgeBaseId) {
    return payload.knowledgeBaseId;
  }

  throw new ApiError('Knowledge base scope is required', 400);
};

const toConnectorResponse = (connector: any) => ({
  id: connector.id,
  workspaceId: connector.workspaceId,
  knowledgeBaseId: connector.knowledgeBaseId ?? null,
  type: connector.type,
  displayName: connector.displayName,
  config: connector.configJson ?? null,
  hasSecret: Boolean(connector.secretRecordId),
  createdBy: connector.createdBy ?? null,
});

const validateConnectorPayload = (
  payload: Partial<CreateConnectorRequest>,
  requireFields: boolean,
) => {
  if (requireFields) {
    if (!payload.type || payload.type.trim().length === 0) {
      throw new ApiError('Connector type is required', 400);
    }
    if (!payload.displayName || payload.displayName.trim().length === 0) {
      throw new ApiError('Connector display name is required', 400);
    }
  }

  if (payload.type !== undefined && payload.type.trim().length === 0) {
    throw new ApiError('Connector type cannot be empty', 400);
  }
  if (
    payload.displayName !== undefined &&
    payload.displayName.trim().length === 0
  ) {
    throw new ApiError('Connector display name cannot be empty', 400);
  }
  if (
    payload.config !== undefined &&
    payload.config !== null &&
    (typeof payload.config !== 'object' || Array.isArray(payload.config))
  ) {
    throw new ApiError('Connector config must be an object', 400);
  }
  if (
    payload.secret !== undefined &&
    payload.secret !== null &&
    (typeof payload.secret !== 'object' || Array.isArray(payload.secret))
  ) {
    throw new ApiError('Connector secret must be an object', 400);
  }
};

const handleListConnectors = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const knowledgeBaseId = resolveKnowledgeBaseId(runtimeScope);
  const connectors =
    await connectorService.listConnectorsByKnowledgeBase(knowledgeBaseId);

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: connectors.map(toConnectorResponse),
    projectId: project.id,
    runtimeScope,
    apiType: ApiType.GET_CONNECTORS,
    startTime,
    requestPayload: {},
    headers: req.headers as Record<string, string>,
  });
};

const handleCreateConnector = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const workspaceId = requireWorkspaceId(runtimeScope);
  const payload = req.body as CreateConnectorRequest;
  validateConnectorPayload(payload, true);
  const knowledgeBaseId = resolveKnowledgeBaseId(runtimeScope, payload);

  const connector = await connectorService.createConnector({
    workspaceId,
    knowledgeBaseId,
    type: payload.type.trim(),
    displayName: payload.displayName.trim(),
    config: payload.config,
    secret: payload.secret,
    createdBy: runtimeScope.userId || undefined,
  });

  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: toConnectorResponse(connector),
    projectId: project.id,
    runtimeScope,
    apiType: ApiType.CREATE_CONNECTOR,
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
      await handleListConnectors(req, res, runtimeScope, project, startTime);
      return;
    }

    if (req.method === 'POST') {
      await handleCreateConnector(req, res, runtimeScope, project, startTime);
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
          ? ApiType.GET_CONNECTORS
          : ApiType.CREATE_CONNECTOR,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
