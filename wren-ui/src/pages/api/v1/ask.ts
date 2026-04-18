import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  respondWith,
  handleApiError,
  isAskResultFinished,
  validateSummaryResult,
  transformHistoryInput,
  getScopedThreadHistories,
  buildAskDiagnostics,
  deriveRuntimeExecutionContextFromRequest,
  pollUntil,
} from '@/server/utils/apiUtils';
import {
  buildAskRuntimeContext,
  toAskRuntimeIdentity,
} from '@server/utils/askContext';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';
import {
  AskResult,
  TextBasedAnswerInput,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
  AskResultType,
  WrenAIError,
} from '@/server/models/adaptor';
import { getLogger } from '@server/utils';

const logger = getLogger('API_ASK');
logger.level = 'debug';

const {
  apiHistoryRepository,
  runtimeScopeResolver,
  wrenAIAdaptor,
  queryService,
  auditEventRepository,
} = components;

const assertKnowledgeBaseReadAccess = async ({
  req,
  runtimeScope,
}: {
  req: NextApiRequest;
  runtimeScope: any;
}) => {
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  await assertAuthorizedWithAudit({
    auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource: {
      resourceType: runtimeScope?.knowledgeBase
        ? 'knowledge_base'
        : 'workspace',
      resourceId:
        runtimeScope?.knowledgeBase?.id || runtimeScope?.workspace?.id,
      workspaceId: runtimeScope?.workspace?.id || null,
      attributes: {
        workspaceKind: runtimeScope?.workspace?.kind || null,
        knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
      },
    },
    context: buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    }),
  });
};

interface AskRequest {
  question: string;
  sampleSize?: number;
  language?: string;
  threadId?: string;
  workspaceId?: string;
  knowledgeBaseId?: string;
  kbSnapshotId?: string;
  deployHash?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { question, sampleSize, language, threadId } = req.body as AskRequest;
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

    const derivedContext = await deriveRuntimeExecutionContextFromRequest({
      req,
      runtimeScopeResolver,
      requireLatestExecutableSnapshot: true,
    });
    runtimeScope = derivedContext.runtimeScope;
    await assertKnowledgeBaseReadAccess({ req, runtimeScope });
    const {
      project,
      manifest,
      language: runtimeLanguage,
      runtimeIdentity,
    } = derivedContext.executionContext;
    const askRuntimeIdentity = toAskRuntimeIdentity(runtimeIdentity);

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
    const deployId = runtimeScope.deployHash;
    if (!deployId) {
      throw new ApiError(
        'No deployment found, please deploy your project first',
        400,
        Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
      );
    }

    // Step 1: Generate SQL
    const askTask = await wrenAIAdaptor.ask({
      query: question,
      deployId,
      histories: transformHistoryInput(histories) as any,
      configurations: {
        language: language || runtimeLanguage,
      },
      ...askRuntimeContext,
    });

    const askResult = await pollUntil<AskResult>({
      fetcher: () => wrenAIAdaptor.getAskResult(askTask.queryId),
      isFinished: isAskResultFinished,
      timeoutError: new ApiError(
        'Timeout waiting for SQL generation',
        500,
        Errors.GeneralErrorCodes.POLLING_TIMEOUT,
      ),
    });

    // Validate the AI result
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
        askResult.error?.code || Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR,
        additionalData,
      );
    }

    // Check for general type response (explanation streaming)
    if (askResult.type === AskResultType.GENERAL) {
      // Stream the explanation content
      let explanation = '';
      const stream = await wrenAIAdaptor.getAskStreamingResult(askTask.queryId);

      // Collect the streamed content
      const streamPromise = new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => {
          const chunkString = chunk.toString('utf-8');
          const match = chunkString.match(/data: {"message":"([\s\S]*?)"}/);
          if (match && match[1]) {
            explanation += match[1];
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

      await streamPromise;

      // Return the explanation result
      await respondWith({
        res,
        statusCode: 200,
        responsePayload: {
          type: 'NON_SQL_QUERY',
          explanation,
          threadId: newThreadId,
          askDiagnostics: buildAskDiagnostics(askResult),
        },
        runtimeScope,
        apiType: ApiType.ASK,
        startTime,
        requestPayload: req.body,
        threadId: newThreadId,
        headers: req.headers as Record<string, string>,
      });
      return;
    }

    // Get the generated SQL
    const sql = askResult.response?.[0]?.sql;
    if (!sql) {
      throw new ApiError('No SQL generated', 400);
    }

    // Step 2: Execute SQL to get data
    let sqlData;
    try {
      const queryResult = await queryService.preview(sql, {
        project,
        limit: sampleSize || 500,
        manifest,
        modelingOnly: false,
      });
      sqlData = queryResult;
    } catch (queryError: unknown) {
      throw new ApiError(
        queryError instanceof Error
          ? queryError.message
          : 'Error executing SQL query',
        400,
        Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
      );
    }

    // Step 3: Generate summary using text-based answer
    const textBasedAnswerInput: TextBasedAnswerInput = {
      query: question,
      sql,
      sqlData,
      threadId: newThreadId,
      userId: runtimeIdentity.actorUserId || undefined,
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
      throw new ApiError('Failed to start summary generation task', 500);
    }

    const summaryResult = await pollUntil<TextBasedAnswerResult>({
      fetcher: () =>
        wrenAIAdaptor.getTextBasedAnswerResult(summaryTask.queryId),
      isFinished: (result) =>
        result.status === TextBasedAnswerStatus.SUCCEEDED ||
        result.status === TextBasedAnswerStatus.FAILED,
      timeoutError: new ApiError(
        'Timeout waiting for summary generation',
        500,
        Errors.GeneralErrorCodes.POLLING_TIMEOUT,
      ),
    });

    // Validate the summary result
    validateSummaryResult(summaryResult);

    // Step 4: Stream the content to get the summary
    let summary = '';
    if (summaryResult.status === TextBasedAnswerStatus.SUCCEEDED) {
      const stream = await wrenAIAdaptor.streamTextBasedAnswer(
        summaryTask.queryId,
      );

      // Collect the streamed content
      const streamPromise = new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => {
          const chunkString = chunk.toString('utf-8');
          const match = chunkString.match(/data: {"message":"([\s\S]*?)"}/);
          if (match && match[1]) {
            summary += match[1];
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

      await streamPromise;
    }

    // Return the combined result
    await respondWith({
      res,
      statusCode: 200,
      responsePayload: {
        sql,
        summary,
        threadId: newThreadId,
        askDiagnostics: buildAskDiagnostics(askResult),
      },
      runtimeScope,
      apiType: ApiType.ASK,
      startTime,
      requestPayload: req.body,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.ASK,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
