import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  createApiHistoryRecord,
  isAskResultFinished,
  transformHistoryInput,
  getScopedThreadHistories,
  validateAskResult,
  deriveRuntimeExecutionContextFromRequest,
  pollUntil,
} from '@/apollo/server/utils/apiUtils';
import {
  buildAskRuntimeContext,
  toAskRuntimeIdentity,
} from '@server/utils/askContext';
import { AskResult, AskResultStatus } from '@/apollo/server/models/adaptor';
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

const {
  apiHistoryRepository,
  runtimeScopeResolver,
  wrenAIAdaptor,
  skillService,
} = components;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { question, language, threadId } = req.body as AsyncAskRequest;
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

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();

    // Send message start event
    sendMessageStart(res);

    const derivedContext = await deriveRuntimeExecutionContextFromRequest({
      req,
      runtimeScopeResolver,
      requireLatestExecutableSnapshot: true,
    });
    runtimeScope = derivedContext.runtimeScope;
    const { language: runtimeLanguage, runtimeIdentity } =
      derivedContext.executionContext;
    const askRuntimeIdentity = toAskRuntimeIdentity(runtimeIdentity);

    // Get conversation history if threadId is provided
    const histories = await getScopedThreadHistories({
      apiHistoryRepository,
      threadId,
      runtimeScope,
    });
    const askRuntimeContext = await buildAskRuntimeContext({
      runtimeIdentity: askRuntimeIdentity,
      skillService,
    });
    const deployId = runtimeScope.deployHash;
    if (!deployId) {
      throw new ApiError(
        'No deployment found, please deploy your project first',
        400,
        Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      );
    }

    // Step 1: Generate SQL
    sendStateUpdate(res, StateType.SQL_GENERATION_START, {
      question,
      threadId: newThreadId,
      language: language || runtimeLanguage,
    });

    const askTask = await wrenAIAdaptor.ask({
      query: question,
      deployId,
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
    await createApiHistoryRecord({
      apiHistoryRepository,
      id: uuidv4(),
      runtimeScope,
      apiType: ApiType.STREAM_GENERATE_SQL,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
      requestPayload: {
        question,
        language,
        workspaceId: runtimeScope.selector.workspaceId,
        knowledgeBaseId: runtimeScope.selector.knowledgeBaseId,
        kbSnapshotId: runtimeScope.selector.kbSnapshotId,
        deployHash: runtimeScope.deployHash,
      },
      responsePayload: { sql },
      statusCode: 200,
      durationMs: Date.now() - startTime,
    });

    endStream(res, newThreadId, startTime);
  } catch (error: unknown) {
    logger.error('Error in stream generate SQL API:', error);

    // Log the error
    await createApiHistoryRecord({
      apiHistoryRepository,
      id: uuidv4(),
      runtimeScope,
      apiType: ApiType.STREAM_GENERATE_SQL,
      threadId: threadId || uuidv4(),
      headers: req.headers as Record<string, string>,
      requestPayload: req.body,
      responsePayload: {
        error: error instanceof Error ? error.message : String(error),
      },
      statusCode: 500,
      durationMs: Date.now() - startTime,
    });

    sendError(
      res,
      error instanceof Error ? error.message : 'Internal server error',
      error instanceof ApiError && error.code
        ? error.code
        : Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR,
      error instanceof ApiError ? error.additionalData : undefined,
    );
    endStream(res, threadId || uuidv4(), startTime);
  }
}
