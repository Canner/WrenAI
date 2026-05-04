import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  MAX_WAIT_TIME,
  isAskResultFinished,
  transformHistoryInput,
  validateAskResult,
} from '@/apollo/server/utils/apiUtils';
import {
  AskResult,
  AskResultStatus,
  WrenAILanguage,
} from '@/apollo/server/models/adaptor';
import { getLogger } from '@server/utils';
import {
  StateType,
  AsyncAskRequest,
  sendMessageStart,
  sendStateUpdate,
  sendError,
  getSqlGenerationState,
  endStream,
} from '@/apollo/server/utils';

const logger = getLogger('API_STREAM_GENERATE_SQL');
logger.level = 'debug';

const { apiHistoryRepository, projectService, deployService, wrenAIAdaptor } =
  components;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { question, language, threadId } = req.body as AsyncAskRequest;
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

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();

    // Send message start event
    sendMessageStart(res);

    // Get current project's last deployment
    const lastDeploy = await deployService.getLastDeployment(project.id);
    if (!lastDeploy) {
      throw new ApiError(
        'No deployment found, please deploy your project first',
        400,
        Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      );
    }

    // Get conversation history if threadId is provided
    const histories = threadId
      ? await apiHistoryRepository.findAllBy({ threadId })
      : undefined;

    // Step 1: Generate SQL
    sendStateUpdate(res, StateType.SQL_GENERATION_START, {
      question,
      threadId: newThreadId,
      language:
        language || WrenAILanguage[project.language] || WrenAILanguage.EN,
    });

    const askTask = await wrenAIAdaptor.ask({
      query: question,
      deployId: lastDeploy.hash,
      histories: transformHistoryInput(histories) as any,
      configurations: {
        language:
          language || WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    });

    // Poll for the SQL generation result
    const deadline = Date.now() + MAX_WAIT_TIME;
    let askResult: AskResult;
    let pollCount = 0;
    let previousStatus: AskResultStatus | null = null;

    while (true) {
      askResult = await wrenAIAdaptor.getAskResult(askTask.queryId);

      // Send status change updates when AskResultStatus changes
      if (askResult.status !== previousStatus) {
        const sqlGenerationState = getSqlGenerationState(askResult.status);
        sendStateUpdate(res, sqlGenerationState, {
          pollCount: pollCount + 1,
          rephrasedQuestion: askResult.rephrasedQuestion,
          intentReasoning: askResult.intentReasoning,
          sqlGenerationReasoning: askResult.sqlGenerationReasoning,
          retrievedTables: askResult.retrievedTables,
          invalidSql: askResult.invalidSql,
          traceId: askResult.traceId,
        });
        previousStatus = askResult.status;
      }

      pollCount++;

      // Check if the result is finished
      if (isAskResultFinished(askResult)) {
        break;
      }

      // Check if we've exceeded the maximum wait time
      if (Date.now() > deadline) {
        throw new ApiError(
          'Request timeout',
          400,
          Errors.GeneralErrorCodes.POLLING_TIMEOUT,
        );
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Validate the result
    validateAskResult(askResult, askTask.queryId);

    // Get the generated SQL
    const sql = askResult.response?.[0]?.sql;
    if (!sql) {
      throw new ApiError(
        'No SQL generated',
        400,
        Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR,
      );
    }

    // Send SQL generation success with the SQL content
    sendStateUpdate(res, StateType.SQL_GENERATION_SUCCESS, { sql });

    // Log the API call
    await apiHistoryRepository.createOne({
      id: uuidv4(),
      projectId: project.id,
      apiType: ApiType.STREAM_GENERATE_SQL,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
      requestPayload: { question, language },
      responsePayload: { sql },
      statusCode: 200,
      durationMs: Date.now() - startTime,
    });

    endStream(res, newThreadId, startTime);
  } catch (error) {
    logger.error('Error in stream generate SQL API:', error);

    // Log the error
    await apiHistoryRepository.createOne({
      id: uuidv4(),
      projectId: project?.id || 0,
      apiType: ApiType.STREAM_GENERATE_SQL,
      threadId: threadId || uuidv4(),
      headers: req.headers as Record<string, string>,
      requestPayload: { question, language },
      responsePayload: {
        error: error instanceof Error ? error.message : String(error),
      },
      statusCode: 500,
      durationMs: Date.now() - startTime,
    });

    sendError(
      res,
      error instanceof Error ? error.message : 'Internal server error',
      error.code || Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR,
      error.additionalData,
    );
    endStream(res, threadId || uuidv4(), startTime);
  }
}
