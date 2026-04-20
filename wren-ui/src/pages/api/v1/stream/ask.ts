import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  createApiHistoryRecord,
  isAskResultFinished,
  validateSummaryResult,
  transformHistoryInput,
  getScopedThreadHistories,
  buildAskDiagnostics,
  deriveRuntimeExecutionContextFromRequest,
  pollUntil,
} from '@/server/utils/apiUtils';
import { buildAskRuntimeContext } from '@server/utils/askContext';
import {
  AskResult,
  AskResultStatus,
  TextBasedAnswerInput,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
  WrenAIError,
  AskResultType,
} from '@/server/models/adaptor';
import { getLogger } from '@server/utils';
import {
  StateType,
  ContentBlockContentType,
  AsyncAskRequest,
  sendMessageStart,
  sendStateUpdate,
  sendError,
  getSqlGenerationState,
  endStream,
} from '@/server/utils';
import {
  assertKnowledgeBaseReadAccess,
  getApiErrorAdditionalData,
  getApiErrorCode,
  getErrorMessage,
  sendContentBlockDelta,
  sendContentBlockStart,
  sendContentBlockStop,
  toAskRuntimeIdentity,
} from './streamAskHelpers';
const logger = getLogger('API_STREAM_ASK');
logger.level = 'debug';

const {
  apiHistoryRepository,
  runtimeScopeResolver,
  wrenAIAdaptor,
  queryService,
  auditEventRepository,
} = components;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { question, sampleSize, language, threadId } =
    req.body as AsyncAskRequest;
  const startTime = Date.now();
  let runtimeScope;

  try {
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

    const derivedContext = await deriveRuntimeExecutionContextFromRequest({
      req,
      runtimeScopeResolver,
      requireLatestExecutableSnapshot: true,
    });
    runtimeScope = derivedContext.runtimeScope;
    await assertKnowledgeBaseReadAccess({
      req,
      runtimeScope,
      auditEventRepository,
    });
    const {
      project,
      manifest,
      language: runtimeLanguage,
      runtimeIdentity,
    } = derivedContext.executionContext;
    const askRuntimeIdentity = toAskRuntimeIdentity(runtimeIdentity);
    const deployHash = runtimeScope.deployHash || askRuntimeIdentity.deployHash;
    if (!deployHash) {
      throw new ApiError(
        'No deployment found, please deploy your project first',
        400,
        Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      );
    }

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();

    // Get conversation history if threadId is provided
    const histories = await getScopedThreadHistories({
      apiHistoryRepository,
      threadId,
      runtimeScope,
    });
    const askRuntimeContext = await buildAskRuntimeContext({
      runtimeIdentity: askRuntimeIdentity,
    });

    // Step 1: Generate SQL
    sendStateUpdate(res, StateType.SQL_GENERATION_START, {
      question,
      threadId: newThreadId,
      language: language || runtimeLanguage,
    });
    const askTask = await wrenAIAdaptor.ask({
      query: question,
      deployId: deployHash,
      histories: transformHistoryInput(histories) as any,
      configurations: {
        language: language || runtimeLanguage,
      },
      ...askRuntimeContext,
    });

    let pollCount = 0;
    let previousStatus: AskResultStatus | null = null;

    const askResult = await pollUntil<AskResult>({
      fetcher: () => wrenAIAdaptor.getAskResult(askTask.queryId),
      isFinished: isAskResultFinished,
      onTick: (nextResult) => {
        pollCount += 1;
        if (nextResult.status !== previousStatus) {
          const sqlGenerationState = getSqlGenerationState(nextResult.status);
          sendStateUpdate(res, sqlGenerationState, {
            pollCount,
            rephrasedQuestion: nextResult.rephrasedQuestion,
            intentReasoning: nextResult.intentReasoning,
            sqlGenerationReasoning: nextResult.sqlGenerationReasoning,
            retrievedTables: nextResult.retrievedTables,
            invalidSql: nextResult.invalidSql,
            traceId: nextResult.traceId,
          });
          previousStatus = nextResult.status;
        }
      },
      timeoutError: new ApiError(
        'Request timeout',
        400,
        Errors.GeneralErrorCodes.POLLING_TIMEOUT,
      ),
    });

    // Validate the ask result
    // Check for error in result
    if (askResult.error) {
      const errorMessage =
        (askResult.error as WrenAIError).message || 'Unknown error';
      const additionalData: Record<string, any> = {};
      const askDiagnostics = buildAskDiagnostics(askResult);

      // Include invalid SQL if available
      if (askResult.invalidSql) {
        additionalData.invalidSql = askResult.invalidSql;
      }
      if (askDiagnostics) {
        additionalData.askDiagnostics = askDiagnostics;
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
      await createApiHistoryRecord({
        apiHistoryRepository,
        id: uuidv4(),
        runtimeScope,
        apiType: ApiType.STREAM_ASK,
        threadId: newThreadId,
        headers: req.headers as Record<string, string>,
        requestPayload: {
          question,
          sampleSize,
          language,
          workspaceId: runtimeScope.selector.workspaceId,
          knowledgeBaseId: runtimeScope.selector.knowledgeBaseId,
          kbSnapshotId: runtimeScope.selector.kbSnapshotId,
          deployHash: runtimeScope.deployHash,
        },
        responsePayload: {
          explanation,
          askDiagnostics: buildAskDiagnostics(askResult),
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
        manifest,
        modelingOnly: false,
      });
      sqlData = queryResult;
      sendStateUpdate(res, StateType.SQL_EXECUTION_END);
    } catch (queryError) {
      throw new ApiError(
        `SQL execution failed: ${getErrorMessage(queryError) || 'Unknown error'}`,
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
      userId: askRuntimeIdentity.actorUserId || undefined,
      runtimeScopeId: runtimeScope.selector.runtimeScopeId || undefined,
      runtimeIdentity: askRuntimeIdentity,
      configurations: {
        language: language || runtimeLanguage,
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

    const summaryResult = await pollUntil<TextBasedAnswerResult>({
      fetcher: () =>
        wrenAIAdaptor.getTextBasedAnswerResult(summaryTask.queryId),
      isFinished: (nextResult) =>
        nextResult.status === TextBasedAnswerStatus.SUCCEEDED ||
        nextResult.status === TextBasedAnswerStatus.FAILED,
      timeoutError: new ApiError(
        'Summary generation timeout',
        400,
        Errors.GeneralErrorCodes.POLLING_TIMEOUT,
      ),
    });

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
    await createApiHistoryRecord({
      apiHistoryRepository,
      id: uuidv4(),
      runtimeScope,
      apiType: ApiType.STREAM_ASK,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
      requestPayload: {
        question,
        sampleSize,
        language,
        workspaceId: runtimeScope.selector.workspaceId,
        knowledgeBaseId: runtimeScope.selector.knowledgeBaseId,
        kbSnapshotId: runtimeScope.selector.kbSnapshotId,
        deployHash: runtimeScope.deployHash,
      },
      responsePayload: {
        sql,
        summary,
        askDiagnostics: buildAskDiagnostics(askResult),
      },
      statusCode: 200,
      durationMs: Date.now() - startTime,
    });

    endStream(res, newThreadId, startTime);
  } catch (error) {
    logger.error('Error in stream ask API:', error);

    // Log the error
    await createApiHistoryRecord({
      apiHistoryRepository,
      id: uuidv4(),
      runtimeScope,
      apiType: ApiType.STREAM_ASK,
      threadId: threadId || uuidv4(),
      headers: req.headers as Record<string, string>,
      requestPayload: req.body,
      responsePayload: {
        error: error instanceof Error ? error.message : String(error),
        ...(getApiErrorAdditionalData(error) || {}),
      },
      statusCode: 500,
      durationMs: Date.now() - startTime,
    });

    sendError(
      res,
      error instanceof Error ? error.message : 'Internal server error',
      getApiErrorCode(error),
      getApiErrorAdditionalData(error),
    );
    endStream(res, threadId || uuidv4(), startTime);
  }
}
