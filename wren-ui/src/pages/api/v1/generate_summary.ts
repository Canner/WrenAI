import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  respondWith,
  handleApiError,
  validateSummaryResult,
  deriveRuntimeExecutionContextFromRequest,
  pollUntil,
} from '@/apollo/server/utils/apiUtils';
import {
  TextBasedAnswerInput,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
} from '@/apollo/server/models/adaptor';
import { getLogger } from '@server/utils';
import { toAskRuntimeIdentity } from '@server/utils/askContext';

const logger = getLogger('API_GENERATE_SUMMARY');
logger.level = 'debug';

const { runtimeScopeResolver, wrenAIAdaptor, queryService } = components;

interface GenerateSummaryRequest {
  question: string;
  sql: string;
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
  const { question, sql, sampleSize, language, threadId } =
    req.body as GenerateSummaryRequest;
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

    if (!sql) {
      throw new ApiError('SQL is required', 400);
    }

    const derivedContext = await deriveRuntimeExecutionContextFromRequest({
      req,
      runtimeScopeResolver,
      requireLatestExecutableSnapshot: true,
    });
    runtimeScope = derivedContext.runtimeScope;
    const {
      project,
      manifest,
      language: runtimeLanguage,
      runtimeIdentity,
    } = derivedContext.executionContext;

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();

    // Get the data from the SQL
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
      const queryErrorMessage =
        queryError instanceof Error
          ? queryError.message
          : 'Error executing SQL query';
      throw new ApiError(
        queryErrorMessage,
        400,
        Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
      );
    }

    const askRuntimeIdentity = toAskRuntimeIdentity(runtimeIdentity);

    // Create text-based answer input for summary generation
    const textBasedAnswerInput: TextBasedAnswerInput = {
      query: question,
      sql,
      sqlData,
      threadId: newThreadId,
      userId: runtimeScope.userId || undefined,
      runtimeScopeId: runtimeScope.selector.runtimeScopeId || undefined,
      runtimeIdentity: askRuntimeIdentity,
      configurations: {
        language: language || runtimeLanguage,
      },
    };

    // Start the summary generation task
    const task =
      await wrenAIAdaptor.createTextBasedAnswer(textBasedAnswerInput);

    if (!task || !task.queryId) {
      throw new ApiError('Failed to start summary generation task', 500);
    }

    const result = await pollUntil<TextBasedAnswerResult>({
      fetcher: () => wrenAIAdaptor.getTextBasedAnswerResult(task.queryId),
      isFinished: (nextResult) =>
        nextResult.status === TextBasedAnswerStatus.SUCCEEDED ||
        nextResult.status === TextBasedAnswerStatus.FAILED,
      timeoutError: new ApiError(
        'Timeout waiting for summary generation',
        500,
        Errors.GeneralErrorCodes.POLLING_TIMEOUT,
      ),
    });

    // Validate the summary result
    validateSummaryResult(result);

    // Stream the content to get the summary
    let summary = '';
    if (result.status === TextBasedAnswerStatus.SUCCEEDED) {
      const stream = await wrenAIAdaptor.streamTextBasedAnswer(task.queryId);

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

    // Return the summary with ID and threadId
    await respondWith({
      res,
      statusCode: 200,
      responsePayload: {
        summary,
        threadId: newThreadId,
      },
      runtimeScope,
      apiType: ApiType.GENERATE_SUMMARY,
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
      apiType: ApiType.GENERATE_SUMMARY,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
