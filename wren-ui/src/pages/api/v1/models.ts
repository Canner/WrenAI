import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

const logger = getLogger('API_MODELS');
logger.level = 'debug';

const { projectService, deployService } = components;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let project;

  try {
    project = await projectService.getCurrentProject();

    // Only allow GET method
    if (req.method !== 'GET') {
      throw new ApiError('Method not allowed', 405);
    }

    // Get current project's last deployment
    const lastDeploy = await deployService.getLastDeployment(project.id);
    if (!lastDeploy) {
      throw new ApiError(
        'No deployment found, please deploy your project first',
        400,
        Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      );
    }

    // Get the MDL from the deployment manifest
    const mdl = lastDeploy.manifest as any;

    // Extract models, views, and relationships from the MDL with defaults
    const models = mdl?.models || [];
    const views = mdl?.views || [];
    const relationships = mdl?.relationships || [];

    // Return the restructured response
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: {
        hash: lastDeploy.hash,
        models,
        relationships,
        views,
      },
      projectId: project.id,
      apiType: ApiType.GET_MODELS,
      startTime,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType: ApiType.GET_MODELS,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
