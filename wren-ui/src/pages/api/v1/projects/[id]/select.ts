import { NextApiRequest, NextApiResponse } from 'next';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

const logger = getLogger('API_SELECT_PROJECT');
logger.level = 'debug';

const getProjectService = () => {
  const { components } = require('@/common');
  const componentGraph = components ?? globalThis.__wrenComponents;
  if (!componentGraph) {
    throw new Error('Components are not initialized');
  }
  return componentGraph.projectService;
};

const parseProjectId = (value: string | string[] | undefined) => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (!rawValue || !/^\d+$/.test(rawValue)) {
    throw new ApiError('Invalid project id', 400);
  }
  return rawValue;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();

  try {
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    const projectId = parseProjectId(req.query.id);
    const projectService = getProjectService();
    logger.debug(`API select project request for ${projectId}`);
    const project = await projectService.selectProject(projectId);
    logger.debug(
      `API selected project ${String(project.id)} (${project.type || 'unknown'})`,
    );

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: {
        project: {
          id: project.id,
          displayName: project.displayName,
          projectType: project.projectType || 'CLASSIC',
        },
      },
      projectId: Number.isSafeInteger(Number(projectId)) ? Number(projectId) : 0,
      apiType: ApiType.SELECT_PROJECT,
      startTime,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: 0,
      apiType: ApiType.SELECT_PROJECT,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
