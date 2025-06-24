import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  MAX_WAIT_TIME,
  isAskResultFinished,
  validateAskResult,
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
} from '@/apollo/server/models/adaptor';
import { getLogger } from '@server/utils';

const logger = getLogger('API_ASYNC_ASK');
logger.level = 'debug';

const {
  apiHistoryRepository,
  projectService,
  deployService,
  wrenAIAdaptor,
  queryService,
} = components;

interface AsyncAskRequest {
  question: string;
  sampleSize?: number;
  language?: string;
  threadId?: string;
}

interface StreamEvent {
  type: 'state' | 'content' | 'error' | 'complete';
  data: any;
  timestamp: number;
}

/**
 * Send SSE event to client
 */
const sendSSEEvent = (res: NextApiResponse, event: StreamEvent) => {
  const eventData = `data: ${JSON.stringify(event)}\n\n`;
  res.write(eventData);
};

/**
 * Send state update to client
 */
const sendStateUpdate = (
  res: NextApiResponse,
  state: string,
  message?: string,
  data?: any,
) => {
  sendSSEEvent(res, {
    type: 'state',
    data: {
      state,
      message,
      data,
    },
    timestamp: Date.now(),
  });
};

/**
 * Send content update to client
 */
const sendContentUpdate = (res: NextApiResponse, content: any) => {
  sendSSEEvent(res, {
    type: 'content',
    data: content,
    timestamp: Date.now(),
  });
};

/**
 * Send error to client
 */
const sendError = (res: NextApiResponse, error: string, code?: string) => {
  sendSSEEvent(res, {
    type: 'error',
    data: {
      error,
      code,
    },
    timestamp: Date.now(),
  });
};

/**
 * Send completion event to client
 */
const sendComplete = (res: NextApiResponse, result: any) => {
  sendSSEEvent(res, {
    type: 'complete',
    data: result,
    timestamp: Date.now(),
  });
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

    // Send initial connection event
    sendStateUpdate(res, 'connected', 'Stream connected successfully');

    // Get current project's last deployment
    sendStateUpdate(res, 'validating', 'Validating project deployment');
    const lastDeploy = await deployService.getLastDeployment(project.id);
    if (!lastDeploy) {
      sendError(
        res,
        'No deployment found, please deploy your project first',
        Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      );
      res.end();
      return;
    }

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();
    sendStateUpdate(res, 'preparing', 'Preparing conversation context', {
      threadId: newThreadId,
    });

    // Get conversation history if threadId is provided
    const histories = threadId
      ? await apiHistoryRepository.findAllBy({ threadId })
      : undefined;

    // Step 1: Generate SQL
    sendStateUpdate(res, 'generating_sql', 'Generating SQL query');
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
        const statusMessage = getStatusMessage(askResult.status);
        sendStateUpdate(res, 'ask_status_change', statusMessage, {
          status: askResult.status,
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

      if (isAskResultFinished(askResult)) {
        break;
      }

      if (Date.now() > deadline) {
        sendError(
          res,
          'Timeout waiting for SQL generation',
          Errors.GeneralErrorCodes.POLLING_TIMEOUT,
        );
        res.end();
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
      pollCount++;
    }

    // Validate the AI result
    try {
      validateAskResult(askResult, askTask.queryId);
    } catch (error) {
      sendError(res, error.message, error.code);
      res.end();
      return;
    }

    // Get the generated SQL
    const sql = askResult.response?.[0]?.sql;
    if (!sql) {
      sendError(res, 'No SQL generated');
      res.end();
      return;
    }

    // Send SQL generation complete
    sendStateUpdate(res, 'sql_generated', 'SQL query generated successfully');
    sendContentUpdate(res, { sql });

    // Step 2: Execute SQL to get data
    sendStateUpdate(res, 'executing_sql', 'Executing SQL query to fetch data');
    let sqlData;
    try {
      const queryResult = await queryService.preview(sql, {
        project,
        limit: sampleSize || 500,
        manifest: lastDeploy.manifest,
        modelingOnly: false,
      });
      sqlData = queryResult;
      sendStateUpdate(res, 'sql_executed', 'SQL query executed successfully');
    } catch (queryError) {
      sendError(
        res,
        queryError.message || 'Error executing SQL query',
        Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
      );
      res.end();
      return;
    }

    // Step 3: Generate summary using text-based answer
    sendStateUpdate(res, 'generating_summary', 'Generating summary from data');
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
      sendError(res, 'Failed to start summary generation task');
      res.end();
      return;
    }

    // Poll for the summary result
    let summaryResult: TextBasedAnswerResult;
    pollCount = 0;

    while (true) {
      summaryResult = await wrenAIAdaptor.getTextBasedAnswerResult(
        summaryTask.queryId,
      );

      // Send polling status updates
      if (pollCount % 3 === 0) {
        // Send update every 3 polls
        sendStateUpdate(
          res,
          'polling_summary',
          'Waiting for summary generation',
          {
            pollCount: Math.floor(pollCount / 3) + 1,
          },
        );
      }

      if (
        summaryResult.status === TextBasedAnswerStatus.SUCCEEDED ||
        summaryResult.status === TextBasedAnswerStatus.FAILED
      ) {
        break;
      }

      if (Date.now() > deadline) {
        sendError(
          res,
          'Timeout waiting for summary generation',
          Errors.GeneralErrorCodes.POLLING_TIMEOUT,
        );
        res.end();
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
      pollCount++;
    }

    // Validate the summary result
    try {
      validateSummaryResult(summaryResult);
    } catch (error) {
      sendError(res, error.message, error.code);
      res.end();
      return;
    }

    // Step 4: Stream the content to get the summary
    let summary = '';
    if (summaryResult.status === TextBasedAnswerStatus.SUCCEEDED) {
      sendStateUpdate(res, 'streaming_summary', 'Streaming summary content');

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
            sendContentUpdate(res, {
              summary: match[1],
              summaryComplete: false,
            });
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
        sendStateUpdate(
          res,
          'summary_complete',
          'Summary generation completed',
        );
      } catch (_streamError) {
        sendError(res, 'Error streaming summary content');
        res.end();
        return;
      }
    }

    // Send final completion event
    const finalResult = {
      sql,
      summary,
      threadId: newThreadId,
    };

    sendComplete(res, finalResult);

    // Log the API call
    await apiHistoryRepository.createOne({
      projectId: project.id,
      apiType: ApiType.ASK,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
      requestPayload: req.body,
      responsePayload: finalResult,
      statusCode: 200,
      durationMs: Date.now() - startTime,
    });

    res.end();
  } catch (error) {
    logger.error('Error in async ask API:', error);

    // Send error event to client
    const errorMessage =
      error instanceof ApiError ? error.message : 'Internal server error';
    const errorCode = error instanceof ApiError ? error.code : undefined;

    sendError(res, errorMessage, errorCode);

    // Log the error
    await apiHistoryRepository.createOne({
      projectId: project?.id || 0,
      apiType: ApiType.ASK,
      threadId,
      headers: req.headers as Record<string, string>,
      requestPayload: req.body,
      responsePayload: { error: errorMessage },
      statusCode: error instanceof ApiError ? error.statusCode : 500,
      durationMs: Date.now() - startTime,
    });

    res.end();
  }
}

/**
 * Get human-readable message for AskResultStatus
 */
const getStatusMessage = (status: AskResultStatus): string => {
  switch (status) {
    case AskResultStatus.UNDERSTANDING:
      return 'Understanding your question';
    case AskResultStatus.SEARCHING:
      return 'Searching for relevant data';
    case AskResultStatus.PLANNING:
      return 'Planning the SQL generation approach';
    case AskResultStatus.GENERATING:
      return 'Generating SQL query';
    case AskResultStatus.CORRECTING:
      return 'Correcting and improving SQL';
    case AskResultStatus.FINISHED:
      return 'SQL generation completed';
    case AskResultStatus.FAILED:
      return 'SQL generation failed';
    case AskResultStatus.STOPPED:
      return 'SQL generation stopped';
    default:
      return 'Processing your request';
  }
};
