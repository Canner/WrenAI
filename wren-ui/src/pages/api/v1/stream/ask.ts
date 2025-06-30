import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  MAX_WAIT_TIME,
  isAskResultFinished,
  validateSummaryResult,
  transformHistoryInput,
} from '@/apollo/server/utils/apiUtils';
import {
  AskResult,
  AskResultStatus,
  WrenAILanguage,
  TextBasedAnswerInput,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
  WrenAIError,
  AskResultType,
} from '@/apollo/server/models/adaptor';
import { getLogger } from '@server/utils';
import {
  EventType,
  StateType,
  ContentBlockContentType,
  AsyncAskRequest,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  sendSSEEvent,
  sendMessageStart,
  sendStateUpdate,
  sendError,
  getSqlGenerationState,
  endStream,
} from '@/apollo/server/utils';

const logger = getLogger('API_STREAM_ASK');
logger.level = 'debug';

const {
  apiHistoryRepository,
  projectService,
  deployService,
  wrenAIAdaptor,
  queryService,
} = components;

/**
 * Send content block start event to client
 */
const sendContentBlockStart = (
  res: NextApiResponse,
  name: ContentBlockContentType,
) => {
  const contentBlockStartEvent: ContentBlockStartEvent = {
    type: EventType.CONTENT_BLOCK_START,
    content_block: {
      type: 'text',
      name,
    },
    timestamp: Date.now(),
  };
  sendSSEEvent(res, contentBlockStartEvent);
};

/**
 * Send content block delta event to client
 */
const sendContentBlockDelta = (res: NextApiResponse, text: string) => {
  const contentBlockDeltaEvent: ContentBlockDeltaEvent = {
    type: EventType.CONTENT_BLOCK_DELTA,
    delta: {
      type: 'text_delta',
      text,
    },
    timestamp: Date.now(),
  };
  sendSSEEvent(res, contentBlockDeltaEvent);
};

/**
 * Send content block stop event to client
 */
const sendContentBlockStop = (res: NextApiResponse) => {
  const contentBlockStopEvent: ContentBlockStopEvent = {
    type: EventType.CONTENT_BLOCK_STOP,
    timestamp: Date.now(),
  };
  sendSSEEvent(res, contentBlockStopEvent);
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { question, sampleSize, language, threadId } =
    req.body as AsyncAskRequest;
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

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();

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

    // Validate the ask result
    // Check for error in result
    if (askResult.error) {
      const errorMessage =
        (askResult.error as WrenAIError).message || 'Unknown error';
      const additionalData: Record<string, any> = {};

      // Include invalid SQL if available
      if (askResult.invalidSql) {
        additionalData.invalidSql = askResult.invalidSql;
      }

      throw new ApiError(
        errorMessage,
        400,
        askResult.error.code,
        additionalData,
      );
    }

    // Check for general type response
    // Stream the content to client
    if (askResult.type === AskResultType.GENERAL) {
      // Send content block start for explanation
      sendContentBlockStart(res, ContentBlockContentType.EXPLANATION);

      const stream = await wrenAIAdaptor.getAskStreamingResult(askTask.queryId);

      // Stream the content in real-time
      let explanation = '';
      const streamPromise = new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => {
          const chunkString = chunk.toString('utf-8');
          const match = chunkString.match(/data: {"message":"([\s\S]*?)"}/);
          if (match && match[1]) {
            // Send incremental content updates
            explanation += match[1];
            sendContentBlockDelta(res, match[1]);
          }
        });

        stream.on('end', () => {
          resolve();
        });

        stream.on('error', (error) => {
          reject(error);
        });

        // Handle client disconnect
        req.on('close', () => {
          stream.destroy();
          reject(new Error('Client disconnected'));
        });
      });

      try {
        await streamPromise;
        // Send content block stop
        sendContentBlockStop(res);
      } catch (_streamError) {
        throw new ApiError(
          'Error streaming explanation content',
          400,
          Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR,
        );
      }

      // Log the API call and end the stream
      await apiHistoryRepository.createOne({
        id: uuidv4(),
        projectId: project.id,
        apiType: ApiType.STREAM_ASK,
        threadId: newThreadId,
        headers: req.headers as Record<string, string>,
        requestPayload: { question, sampleSize, language },
        responsePayload: {
          explanation,
        },
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });

      endStream(res, newThreadId, startTime);
      return;
    }

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

    // Step 2: Execute SQL to get data
    sendStateUpdate(res, StateType.SQL_EXECUTION_START, { sql });
    let sqlData;
    try {
      const queryResult = await queryService.preview(sql, {
        project,
        limit: sampleSize || 500,
        manifest: lastDeploy.manifest,
        modelingOnly: false,
      });
      sqlData = queryResult;
      sendStateUpdate(res, StateType.SQL_EXECUTION_END);
    } catch (queryError) {
      throw new ApiError(
        `SQL execution failed: ${queryError.message || 'Unknown error'}`,
        400,
        Errors.GeneralErrorCodes.SQL_EXECUTION_ERROR,
      );
    }

    // Step 3: Generate summary using text-based answer
    const textBasedAnswerInput: TextBasedAnswerInput = {
      query: question,
      sql,
      sqlData,
      threadId: newThreadId,
      configurations: {
        language:
          language || WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    };

    // Start the summary generation task
    const summaryTask =
      await wrenAIAdaptor.createTextBasedAnswer(textBasedAnswerInput);

    if (!summaryTask || !summaryTask.queryId) {
      throw new ApiError(
        'Failed to start summary generation task',
        400,
        Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR,
      );
    }

    // Poll for the summary generation result
    const summaryDeadline = Date.now() + MAX_WAIT_TIME;
    let summaryResult: TextBasedAnswerResult;

    while (true) {
      summaryResult = await wrenAIAdaptor.getTextBasedAnswerResult(
        summaryTask.queryId,
      );

      if (
        summaryResult.status === TextBasedAnswerStatus.SUCCEEDED ||
        summaryResult.status === TextBasedAnswerStatus.FAILED
      ) {
        break;
      }

      // Check if we've exceeded the maximum wait time
      if (Date.now() > summaryDeadline) {
        throw new ApiError(
          'Summary generation timeout',
          400,
          Errors.GeneralErrorCodes.POLLING_TIMEOUT,
        );
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Validate the summary result
    validateSummaryResult(summaryResult);

    // Step 4: Stream the content to get the summary
    let summary = '';
    if (summaryResult.status === TextBasedAnswerStatus.SUCCEEDED) {
      // Send content block start
      sendContentBlockStart(res, ContentBlockContentType.SUMMARY_GENERATION);

      const stream = await wrenAIAdaptor.streamTextBasedAnswer(
        summaryTask.queryId,
      );

      // Stream the content in real-time
      const streamPromise = new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => {
          const chunkString = chunk.toString('utf-8');
          const match = chunkString.match(/data: {"message":"([\s\S]*?)"}/);
          if (match && match[1]) {
            summary += match[1];
            // Send incremental content updates
            sendContentBlockDelta(res, match[1]);
          }
        });

        stream.on('end', () => {
          resolve();
        });

        stream.on('error', (error) => {
          reject(error);
        });

        // Handle client disconnect
        req.on('close', () => {
          stream.destroy();
          reject(new Error('Client disconnected'));
        });
      });

      try {
        await streamPromise;
        // Send content block stop
        sendContentBlockStop(res);
      } catch (_streamError) {
        throw new ApiError(
          'Error streaming summary content',
          400,
          Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR,
        );
      }
    }

    // Log the API call
    await apiHistoryRepository.createOne({
      id: uuidv4(),
      projectId: project.id,
      apiType: ApiType.STREAM_ASK,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
      requestPayload: { question, sampleSize, language },
      responsePayload: {
        sql,
        summary,
      },
      statusCode: 200,
      durationMs: Date.now() - startTime,
    });

    endStream(res, newThreadId, startTime);
  } catch (error) {
    logger.error('Error in stream ask API:', error);

    // Log the error
    await apiHistoryRepository.createOne({
      id: uuidv4(),
      projectId: project?.id || 0,
      apiType: ApiType.STREAM_ASK,
      threadId: threadId || uuidv4(),
      headers: req.headers as Record<string, string>,
      requestPayload: { question, sampleSize, language },
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
