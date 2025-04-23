import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType, ApiHistory } from '@server/repositories/apiHistoryRepository';
import {
  AskResult,
  AskResultStatus,
  AskResultType,
  WrenAILanguage,
  WrenAIError,
} from '@/apollo/server/models/adaptor';
import * as Errors from '@/apollo/server/utils/error';
import { getLogger } from '@server/utils';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  respondWith,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';

const logger = getLogger('API_GENERATE_SQL');
logger.level = 'debug';

const { apiHistoryRepository, projectService, deployService, wrenAIAdaptor } =
  components;

interface GenerateSqlRequest {
  question: string;
  threadId?: string;
}

const isAskResultFinished = (result: AskResult) => {
  return (
    result.status === AskResultStatus.FINISHED ||
    result.status === AskResultStatus.FAILED ||
    result.status === AskResultStatus.STOPPED ||
    result.error
  );
};

const transformHistoryInput = (histories: ApiHistory[]) => {
  if (!histories) {
    return [];
  }
  return histories
    .filter(
      (history) =>
        history.responsePayload?.sql && history.requestPayload?.question,
    )
    .map((history) => ({
      question: history.requestPayload?.question,
      sql: history.responsePayload?.sql,
    }));
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { question, threadId } = req.body as GenerateSqlRequest;
  const startTime = Date.now();
  let project;

  try {
    project = await projectService.getCurrentProject();

    // Only allow POST method
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    // input validation
    if (!question) {
      throw new ApiError('Question is required', 400);
    }

    // get current project's last deployment
    const lastDeploy = await deployService.getLastDeployment(project.id);

    // ask AI service to generate SQL
    const histories = threadId
      ? await apiHistoryRepository.findAllBy({ threadId })
      : undefined;
    const task = await wrenAIAdaptor.ask({
      query: question,
      deployId: lastDeploy.hash,
      histories: transformHistoryInput(histories) as any,
      configurations: {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    });

    // polling for the result
    let result: AskResult;
    while (true) {
      result = await wrenAIAdaptor.getAskResult(task.queryId);
      if (isAskResultFinished(result)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000)); // poll every second
    }

    // if it's failed, throw the error with any additional data
    if (result.error) {
      const errorMessage =
        (result.error as WrenAIError).message || 'Unknown error';
      const additionalData: Record<string, any> = {};

      // Include invalid SQL if available
      if (result.invalidSql) {
        additionalData.invalidSql = result.invalidSql;
      }

      throw new ApiError(errorMessage, 400, result.error.code, additionalData);
    }

    // if it's a misleading type response, throw error
    if (result.type === AskResultType.MISLEADING_QUERY) {
      throw new ApiError(
        result.intentReasoning ||
          Errors.errorMessages[Errors.GeneralErrorCodes.NON_SQL_QUERY],
        400,
        Errors.GeneralErrorCodes.NON_SQL_QUERY,
      );
    }

    // if it's a general type response, throw error
    if (result.type === AskResultType.GENERAL) {
      throw new ApiError(
        result.intentReasoning ||
          Errors.errorMessages[Errors.GeneralErrorCodes.NON_SQL_QUERY],
        400,
        Errors.GeneralErrorCodes.NON_SQL_QUERY,
      );
    }

    // return the SQL
    // create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();
    await respondWith({
      res,
      statusCode: 200,
      responsePayload: {
        sql: result.response?.[0]?.sql,
        threadId: newThreadId,
      },
      projectId: project.id,
      apiType: ApiType.GENERATE_SQL,
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
      apiType: ApiType.GENERATE_SQL,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
