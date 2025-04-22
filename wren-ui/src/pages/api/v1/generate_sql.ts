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

const logger = getLogger('API_GENERATE_SQL');
logger.level = 'debug';

const { apiHistoryRepository, projectService, deployService, wrenAIAdaptor } =
  components;

interface GenerateSqlRequest {
  question: string;
  threadId?: string;
}

class ApiError extends Error {
  statusCode: number;
  code?: Errors.GeneralErrorCodes;

  constructor(
    message: string,
    statusCode: number,
    code?: Errors.GeneralErrorCodes,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
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

const respondWith = async ({
  res,
  statusCode,
  responsePayload,
  projectId,
  apiType = ApiType.GENERATE_SQL,
  threadId,
  headers,
  requestPayload,
  startTime,
}: {
  res: NextApiResponse;
  statusCode: number;
  responsePayload: any;
  projectId: number;
  apiType?: ApiType;
  startTime: number;
  requestPayload?: Record<string, any>;
  threadId?: string;
  headers?: Record<string, string>;
}) => {
  const durationMs = startTime ? Date.now() - startTime : undefined;
  await apiHistoryRepository.createOne({
    id: uuidv4(),
    projectId,
    apiType,
    threadId,
    headers,
    requestPayload,
    responsePayload,
    statusCode,
    durationMs,
  });

  return res.status(statusCode).json(responsePayload);
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

    // if it's failed, throw the error
    if (result.error) {
      const errorMessage =
        (result.error as WrenAIError).message || 'Unknown error';
      throw new ApiError(errorMessage, 400);
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
      startTime,
      requestPayload: req.body,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    logger.error('Error generating SQL:', error);

    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    let responsePayload;

    if (error instanceof ApiError && error.code) {
      responsePayload = {
        code: error.code,
        error: error.message,
      };
    } else {
      responsePayload = { error: error.message };
    }

    await respondWith({
      res,
      statusCode,
      responsePayload,
      projectId: project?.id,
      startTime,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
    });
  }
}
