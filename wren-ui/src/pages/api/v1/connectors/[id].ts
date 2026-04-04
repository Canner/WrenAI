import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

const logger = getLogger('API_CONNECTOR_BY_ID');
logger.level = 'debug';

const { runtimeScopeResolver, connectorService } = components;

interface UpdateConnectorRequest {
  knowledgeBaseId?: string | null;
  type?: string;
  displayName?: string;
  config?: Record<string, any> | null;
  secret?: Record<string, any> | null;
}

const validateConnectorId = (id: any): string => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('Connector ID is required', 400);
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

const validateConnectorPayload = (payload: UpdateConnectorRequest) => {
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

const getScopedConnector = async (
  id: string,
  workspaceId: string,
  knowledgeBaseId: string,
) => {
  const connector = await connectorService.getConnectorById(id);
  if (
    !connector ||
    connector.workspaceId !== workspaceId ||
    connector.knowledgeBaseId !== knowledgeBaseId
  ) {
    throw new ApiError('Connector not found', 404);
  }

  return connector;
};

const handleGetConnector = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const workspaceId = requireWorkspaceId(runtimeScope);
  const knowledgeBaseId = resolveKnowledgeBaseId(runtimeScope);
  const connector = await getScopedConnector(
    validateConnectorId(req.query.id),
    workspaceId,
    knowledgeBaseId,
  );

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: toConnectorResponse(connector),
    projectId: project.id,
    runtimeScope,
    apiType: ApiType.GET_CONNECTORS,
    startTime,
    requestPayload: { id: req.query.id },
    headers: req.headers as Record<string, string>,
  });
};

const handleUpdateConnector = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const workspaceId = requireWorkspaceId(runtimeScope);
  const payload = req.body as UpdateConnectorRequest;
  validateConnectorPayload(payload);
  const knowledgeBaseId = resolveKnowledgeBaseId(runtimeScope, payload);
  const connectorId = validateConnectorId(req.query.id);
  await getScopedConnector(connectorId, workspaceId, knowledgeBaseId);

  const updatedConnector = await connectorService.updateConnector(connectorId, {
    knowledgeBaseId,
    type: payload.type?.trim(),
    displayName: payload.displayName?.trim(),
    config: payload.config,
    secret: payload.secret,
  });

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: toConnectorResponse(updatedConnector),
    projectId: project.id,
    runtimeScope,
    apiType: ApiType.UPDATE_CONNECTOR,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

const handleDeleteConnector = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  project: any,
  startTime: number,
) => {
  const workspaceId = requireWorkspaceId(runtimeScope);
  const knowledgeBaseId = resolveKnowledgeBaseId(runtimeScope);
  const connectorId = validateConnectorId(req.query.id);
  await getScopedConnector(connectorId, workspaceId, knowledgeBaseId);

  await connectorService.deleteConnector(connectorId);

  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    projectId: project.id,
    runtimeScope,
    apiType: ApiType.DELETE_CONNECTOR,
    startTime,
    requestPayload: { id: connectorId },
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
      await handleGetConnector(req, res, runtimeScope, project, startTime);
      return;
    }

    if (req.method === 'PUT') {
      await handleUpdateConnector(req, res, runtimeScope, project, startTime);
      return;
    }

    if (req.method === 'DELETE') {
      await handleDeleteConnector(req, res, runtimeScope, project, startTime);
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
          : req.method === 'PUT'
            ? ApiType.UPDATE_CONNECTOR
            : ApiType.DELETE_CONNECTOR,
      requestPayload:
        req.method === 'DELETE' ? { id: req.query.id } : (req.body ?? {}),
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
