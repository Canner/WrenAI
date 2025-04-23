import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  respondWith,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';
import { ChartResult, ChartStatus } from '@/apollo/server/models/adaptor';
import { PreviewDataResponse } from '@server/services/queryService';
import { transformToObjects } from '@server/utils/dataUtils';

const { projectService, wrenAIAdaptor, deployService, queryService } =
  components;

interface GenerateVegaSpecRequest {
  question: string;
  sql: string;
  threadId?: string;
  sampleSize?: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const {
    question,
    sql,
    threadId,
    sampleSize = 10000,
  } = req.body as GenerateVegaSpecRequest;
  const startTime = Date.now();
  let project;

  try {
    project = await projectService.getCurrentProject();

    // Only allow POST method
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    // Input validation
    if (!question) {
      throw new ApiError('Question is required', 400);
    }

    if (!sql) {
      throw new ApiError('SQL is required', 400);
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

    // Execute the SQL query to get the data
    let queryResult: PreviewDataResponse;
    try {
      queryResult = (await queryService.preview(sql, {
        project,
        limit: sampleSize,
        manifest: lastDeploy.manifest,
        modelingOnly: false,
      })) as PreviewDataResponse;
    } catch (queryError) {
      throw new ApiError(
        queryError.message || 'Error executing SQL query',
        400,
        Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
      );
    }

    // Transform query results to array of objects
    const dataObjects = transformToObjects(
      queryResult.columns,
      queryResult.data,
    );

    // Ask AI service to generate a Vega spec chart
    const task = await wrenAIAdaptor.generateChart({
      query: question,
      sql,
      projectId: project.id.toString(),
    });

    if (!task || !task.queryId) {
      throw new ApiError('Failed to start Vega spec generation task', 500);
    }

    // Poll for the result
    let result: ChartResult;
    while (true) {
      result = await wrenAIAdaptor.getChartResult(task.queryId);
      if (
        result.status === ChartStatus.FINISHED ||
        result.status === ChartStatus.FAILED
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
    }

    // Check for errors
    if (result.status === ChartStatus.FAILED || result.error) {
      throw new ApiError(
        result.error?.message || 'Failed to generate Vega spec',
        400,
        Errors.GeneralErrorCodes.FAILED_TO_GENERATE_VEGA_SCHEMA,
      );
    }

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();

    // Get the generated Vega spec
    const vegaSpec = result?.response?.chartSchema;
    vegaSpec.data = {
      values: dataObjects,
    };

    // Return the Vega spec with data included
    await respondWith({
      res,
      statusCode: 200,
      responsePayload: {
        vegaSpec,
        threadId: newThreadId,
      },
      projectId: project.id,
      apiType: ApiType.GENERATE_VEGA_SPEC,
      startTime,
      requestPayload: req.body,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType: ApiType.GENERATE_VEGA_SPEC,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
    });
  }
}
