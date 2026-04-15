import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
  deriveRuntimeExecutionContextFromRequest,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';

const logger = getLogger('API_MODELS');
logger.level = 'debug';

const { runtimeScopeResolver } = components;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    // Only allow GET method
    if (req.method !== 'GET') {
      throw new ApiError('Method not allowed', 405);
    }

    const derivedContext = await deriveRuntimeExecutionContextFromRequest({
      req,
      runtimeScopeResolver,
    });
    runtimeScope = derivedContext.runtimeScope;
    const { deployment: lastDeploy } = derivedContext.executionContext;

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
      runtimeScope,
      apiType: ApiType.GET_MODELS,
      startTime,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.GET_MODELS,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
