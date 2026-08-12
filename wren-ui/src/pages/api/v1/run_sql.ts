import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { getLogger } from '@server/utils';
import { v4 as uuidv4 } from 'uuid';
import { PreviewDataResponse } from '@server/services/queryService';
import {
  ApiError,
  respondWith,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';
import { transformToObjects } from '@server/utils/dataUtils';

const logger = getLogger('API_RUN_SQL');
logger.level = 'debug';

const { projectService, queryService, deployService } = components;

/**
 * Validates the SQL result and ensures it has the expected format
 * @param result The result to validate
 * @returns The validated result as PreviewDataResponse
 * @throws ApiError if the result is in an unexpected format
 */
const validateSqlResult = (result: any): PreviewDataResponse => {
  // Ensure we have a valid result with expected properties
  if (typeof result === 'boolean') {
    throw new ApiError('Unexpected query result format', 500);
  }

  return result as PreviewDataResponse;
};

interface RunSqlRequest {
  sql: string;
  threadId?: string;
  limit?: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { sql, threadId, limit = 1000 } = req.body as RunSqlRequest;
  const startTime = Date.now();
  let project;

  try {
    // Only allow POST method
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    // input validation
    if (!sql) {
      throw new ApiError('SQL is required', 400);
    }

    project = await projectService.getCurrentProject();

    const deployment = await deployService.getLastDeployment(project.id);

    if (!deployment) {
      throw new ApiError(
        'No deployment found, please deploy your project first',
        400,
        Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      );
    }

    const manifest = deployment.manifest;

    // Execute the SQL query
    try {
      const result = await queryService.preview(sql, {
        project,
        limit,
        manifest,
        modelingOnly: false,
      });

      // Validate the SQL result
      const queryResult = validateSqlResult(result);

      // Transform data into array of objects
      const transformedData = transformToObjects(
        queryResult.columns,
        queryResult.data,
      );

      // create a new thread if it's a new query
      const newThreadId = threadId || uuidv4();

      await respondWith({
        res,
        statusCode: 200,
        responsePayload: {
          records: transformedData,
          columns: queryResult.columns,
          threadId: newThreadId,
          totalRows: queryResult.data?.length || 0,
        },
        projectId: project.id,
        apiType: ApiType.RUN_SQL,
        startTime,
        requestPayload: req.body,
        threadId: newThreadId,
        headers: req.headers as Record<string, string>,
      });
    } catch (queryError) {
      logger.error('Error executing SQL:', queryError);
      throw new ApiError(
        queryError.message || 'Error executing SQL query',
        400,
        Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
      );
    }
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType: ApiType.RUN_SQL,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
