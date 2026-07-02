import { NextApiRequest, NextApiResponse } from 'next';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import { coerceBoolean } from '@server/repositories/baseRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

const logger = getLogger('API_CURRENT_PROJECT');
logger.level = 'debug';

const getProjectService = () => {
  const { components } = require('@/common');
  const componentGraph = components ?? globalThis.__wrenComponents;
  if (!componentGraph) {
    throw new Error('Components are not initialized');
  }
  return componentGraph.projectService;
};

const serializeProject = (project) =>
  project
    ? {
        id: String(project.id),
        displayName: project.displayName,
        projectType: project.projectType || 'CLASSIC',
        isCurrent: coerceBoolean(project.isCurrent),
        hasDataSource: Boolean(project.type),
        type: project.type || null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      }
    : null;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();

  try {
    if (req.method !== 'GET') {
      throw new ApiError('Method not allowed', 405);
    }

    const projectService = getProjectService();
    let currentProject = null;
    try {
      currentProject = await projectService.getCurrentProject();
      logger.debug(
        `Resolved current project ${String(currentProject?.id)} (${currentProject?.type || 'unknown'})`,
      );
    } catch (error) {
      logger.warn(
        `Failed to resolve current project through project service: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      currentProject = null;
    }
    const projects = await projectService.listProjects();
    logger.debug(
      `Loaded ${projects.length} project(s) for current project API: ${projects
        .map((project) => `${String(project.id)}:${project.type || 'unknown'}:${coerceBoolean(project.isCurrent)}`)
        .join(', ') || 'none'}`,
    );
    const serializedCurrentProject =
      currentProject &&
      projects.some(
        (project) => String(project.id) === String(currentProject.id),
      )
        ? currentProject
        : projects.find((project) => coerceBoolean(project.isCurrent)) || null;
    logger.debug(
      `Current project API returning ${
        serializedCurrentProject
          ? `${String(serializedCurrentProject.id)} (${serializedCurrentProject.type || 'unknown'})`
          : 'no current project'
      }`,
    );

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: {
        currentProject: serializeProject(serializedCurrentProject),
        projects: projects.map(serializeProject),
      },
      projectId: Number.isSafeInteger(Number(serializedCurrentProject?.id))
        ? Number(serializedCurrentProject?.id)
        : 0,
      apiType: ApiType.GET_CURRENT_PROJECT,
      startTime,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: 0,
      apiType: ApiType.GET_CURRENT_PROJECT,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
