import { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiType,
  ApiHistory,
  IApiHistoryRepository,
} from '@server/repositories/apiHistoryRepository';
import {
  IRuntimeScopeResolver,
  RuntimeScope,
  toPersistedRuntimeIdentity,
} from '@server/context/runtimeScope';
import {
  OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
  assertLatestExecutableRuntimeScope,
  resolveRuntimeExecutionContext,
} from '@server/utils/runtimeExecutionContext';
import { isPersistedRuntimeIdentityMatch } from '@server/utils/persistedRuntimeIdentity';
import * as Errors from '@server/utils/error';
import { components } from '@/common';
import {
  AskResult,
  AskDiagnostics,
  AskResultStatus,
  AskResultType,
  WrenAIError,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
} from '@/apollo/server/models/adaptor';

const getComponents = () => {
  if (components) {
    return components;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@/common')
      .components as typeof import('@/common').components;
  } catch (_error) {
    return components;
  }
};

export const MAX_WAIT_TIME = 1000 * 60 * 3; // 3 minutes
export const DEFAULT_POLL_INTERVAL_MS = 1200;
export const MAX_POLL_INTERVAL_MS = 3000;

export const isAskResultFinished = (result: AskResult) => {
  return (
    result.status === AskResultStatus.FINISHED ||
    result.status === AskResultStatus.FAILED ||
    result.status === AskResultStatus.STOPPED ||
    Boolean(result.error)
  );
};

/**
 * Validates the AI result and throws appropriate errors for different failure cases
 * @param result The AI result to validate
 * @param taskQueryId The query ID of the task (used for explanation queries)
 * @throws ApiError if result contains errors or is of an invalid type
 */
export const validateAskResult = (
  result: AskResult,
  taskQueryId: string,
): void => {
  const nonSqlQueryMessage =
    Errors.errorMessages[Errors.GeneralErrorCodes.NON_SQL_QUERY] ||
    'Query is not supported';

  // Check for error in result
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

  // Check for misleading query type
  if (result.type === AskResultType.MISLEADING_QUERY) {
    throw new ApiError(
      result.intentReasoning || nonSqlQueryMessage,
      400,
      Errors.GeneralErrorCodes.NON_SQL_QUERY,
    );
  }

  // Check for general type response
  if (result.type === AskResultType.GENERAL) {
    throw new ApiError(
      result.intentReasoning || nonSqlQueryMessage,
      400,
      Errors.GeneralErrorCodes.NON_SQL_QUERY,
      { explanationQueryId: taskQueryId },
    );
  }
};

/**
 * Validates the summary generation result and checks for errors
 * @param result The summary result to validate
 * @throws ApiError if the result has errors or is in a failed state
 */
export const validateSummaryResult = (result: TextBasedAnswerResult): void => {
  // Check for errors or failed status
  if (result.status === TextBasedAnswerStatus.FAILED || result.error) {
    throw new ApiError(
      result.error?.message || 'Failed to generate summary',
      400,
      Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR,
    );
  }

  // Verify that the status is succeeded
  if (result.status !== TextBasedAnswerStatus.SUCCEEDED) {
    throw new ApiError('Summary generation is still in progress', 500);
  }
};

export const buildAskDiagnostics = (
  result?: Pick<AskResult, 'traceId' | 'askPath' | 'shadowCompare'> | null,
): AskDiagnostics | undefined => {
  if (!result) {
    return undefined;
  }

  const diagnostics: AskDiagnostics = {};
  if (result.traceId) {
    diagnostics.traceId = result.traceId;
  }
  if (result.askPath) {
    diagnostics.askPath = result.askPath;
  }
  if (result.shadowCompare) {
    diagnostics.shadowCompare = result.shadowCompare;
  }

  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
};

export const transformHistoryInput = (histories: ApiHistory[]) => {
  if (!histories) {
    return [];
  }

  const validApiTypes = [
    ApiType.GENERATE_SQL,
    ApiType.ASK,
    ApiType.STREAM_GENERATE_SQL,
    ApiType.STREAM_ASK,
  ];

  return histories
    .filter(
      (history) =>
        validApiTypes.includes(history.apiType) &&
        history.responsePayload?.sql &&
        history.requestPayload?.question,
    )
    .map((history) => ({
      question: history.requestPayload?.question,
      sql: history.responsePayload?.sql,
    }));
};

export const getScopedThreadHistories = async ({
  apiHistoryRepository,
  threadId,
  runtimeScope,
}: {
  apiHistoryRepository: Pick<IApiHistoryRepository, 'findAllBy'>;
  threadId?: string;
  runtimeScope?: RuntimeScope | null;
}): Promise<ApiHistory[]> => {
  if (!threadId) {
    return [];
  }

  const histories = await apiHistoryRepository.findAllBy({
    threadId,
  });

  if (!runtimeScope) {
    return histories;
  }

  const runtimeIdentity = toPersistedRuntimeIdentity(runtimeScope);
  return histories.filter((history) =>
    isPersistedRuntimeIdentityMatch(history, runtimeIdentity),
  );
};

export const createApiHistoryRecord = async ({
  apiHistoryRepository = getComponents().apiHistoryRepository,
  runtimeScope,
  ...record
}: {
  apiHistoryRepository?: Pick<IApiHistoryRepository, 'createOne'>;
  runtimeScope?: RuntimeScope | null;
} & Omit<ApiHistory, 'projectId'>) => {
  if (!runtimeScope) {
    return null;
  }

  const runtimeIdentity = toPersistedRuntimeIdentity(runtimeScope);
  return await apiHistoryRepository.createOne({
    ...record,
    ...runtimeIdentity,
  });
};

export const deriveRuntimeExecutionContextFromRequest = async ({
  req,
  runtimeScopeResolver = getComponents().runtimeScopeResolver,
  projectService = getComponents().projectService,
  knowledgeBaseRepository = getComponents().knowledgeBaseRepository,
  kbSnapshotRepository = getComponents().kbSnapshotRepository,
  noDeploymentMessage,
  requireLatestExecutableSnapshot = false,
}: {
  req: NextApiRequest;
  runtimeScopeResolver?: Pick<IRuntimeScopeResolver, 'resolveRequestScope'>;
  projectService?: Pick<typeof components.projectService, 'getProjectById'>;
  knowledgeBaseRepository?: Pick<
    typeof components.knowledgeBaseRepository,
    'findOneBy'
  >;
  kbSnapshotRepository?: Pick<
    typeof components.kbSnapshotRepository,
    'findOneBy'
  >;
  noDeploymentMessage?: string;
  requireLatestExecutableSnapshot?: boolean;
}) => {
  const runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
  if (requireLatestExecutableSnapshot) {
    try {
      await assertLatestExecutableRuntimeScope({
        runtimeScope,
        knowledgeBaseRepository,
        kbSnapshotRepository,
      });
    } catch (error) {
      throw new ApiError(
        error instanceof Error
          ? error.message
          : OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
        409,
        Errors.GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT,
      );
    }
  }
  const executionContext = await resolveRuntimeExecutionContext({
    runtimeScope,
    projectService,
  });
  if (!executionContext) {
    throw new ApiError(
      noDeploymentMessage ||
        'No deployment found, please deploy your project first',
      400,
      Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND,
    );
  }

  return {
    runtimeScope,
    executionContext,
  };
};

/**
 * Validates SQL syntax and compatibility with the project's manifest.
 * Throws an ApiError if the SQL is invalid or cannot be previewed.
 * @param sql The SQL string to validate
 * @param project The project object (must have id)
 * @param deployService The deployment service instance
 * @param queryService The query service instance
 */
export const validateSql = async (
  sql: string,
  executionContext: {
    project: any;
    manifest: any;
  },
  queryService: any,
) => {
  try {
    await queryService.preview(sql, {
      manifest: executionContext.manifest,
      project: executionContext.project,
      dryRun: true,
    });
  } catch (err: any) {
    throw new ApiError(
      err.message || 'Invalid SQL',
      400,
      Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
    );
  }
};

/**
 * Common error class for API endpoints
 */
export class ApiError extends Error {
  statusCode: number;
  code?: Errors.GeneralErrorCodes;
  additionalData?: Record<string, any>;

  constructor(
    message: string,
    statusCode: number,
    code?: Errors.GeneralErrorCodes,
    additionalData?: Record<string, any>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.additionalData = additionalData;
  }
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const pollUntil = async <T>({
  fetcher,
  isFinished,
  timeoutMs = MAX_WAIT_TIME,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxIntervalMs = MAX_POLL_INTERVAL_MS,
  onTick,
  timeoutError,
}: {
  fetcher: () => Promise<T>;
  isFinished: (result: T) => boolean;
  timeoutMs?: number;
  intervalMs?: number;
  maxIntervalMs?: number;
  onTick?: (result: T, attempt: number) => void;
  timeoutError?: ApiError;
}): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let interval = intervalMs;
  let attempt = 0;

  while (true) {
    const result = await fetcher();
    attempt += 1;
    onTick?.(result, attempt);

    if (isFinished(result)) {
      return result;
    }

    if (Date.now() > deadline) {
      throw (
        timeoutError ||
        new ApiError(
          'Request timeout',
          500,
          Errors.GeneralErrorCodes.POLLING_TIMEOUT,
        )
      );
    }

    await sleep(interval);
    interval = Math.min(
      maxIntervalMs,
      Math.max(intervalMs, Math.floor(interval * 1.2)),
    );
  }
};

/**
 * Common response handler for API endpoints that also logs to API history
 */
export const respondWith = async ({
  res,
  statusCode,
  responsePayload,
  runtimeScope,
  apiType,
  threadId,
  headers,
  requestPayload,
  startTime,
}: {
  res: NextApiResponse;
  statusCode: number;
  responsePayload: any;
  runtimeScope?: RuntimeScope | null;
  apiType: ApiType;
  startTime: number;
  requestPayload?: Record<string, any>;
  threadId?: string;
  headers?: Record<string, string>;
}) => {
  const durationMs = startTime ? Date.now() - startTime : undefined;
  const responseId = uuidv4();
  await createApiHistoryRecord({
    id: responseId,
    runtimeScope,
    apiType,
    threadId,
    headers,
    requestPayload,
    responsePayload,
    statusCode,
    durationMs,
  });

  return res.status(statusCode).json({
    id: responseId,
    ...responsePayload,
  });
};

/**
 * Simple response handler for API endpoints that don't need responseId or threadId
 * Used for simple CRUD operations like instructions
 */
export const respondWithSimple = async ({
  res,
  statusCode,
  responsePayload,
  runtimeScope,
  apiType,
  headers,
  requestPayload,
  startTime,
}: {
  res: NextApiResponse;
  statusCode: number;
  responsePayload: any;
  runtimeScope?: RuntimeScope | null;
  apiType: ApiType;
  startTime: number;
  requestPayload?: Record<string, any>;
  headers?: Record<string, string>;
}) => {
  const durationMs = startTime ? Date.now() - startTime : undefined;
  const responseId = uuidv4();
  await createApiHistoryRecord({
    id: responseId,
    runtimeScope,
    apiType,
    headers,
    requestPayload,
    responsePayload,
    statusCode,
    durationMs,
  });

  return res.status(statusCode).json(responsePayload);
};

/**
 * Common error handler for API endpoints
 */
export const handleApiError = async ({
  error,
  res,
  runtimeScope,
  apiType,
  requestPayload,
  threadId,
  headers,
  startTime,
  logger,
}: {
  error: any;
  res: NextApiResponse;
  runtimeScope?: RuntimeScope | null;
  apiType: ApiType;
  requestPayload?: Record<string, any>;
  threadId?: string;
  headers?: Record<string, string>;
  startTime: number;
  logger?: any;
}) => {
  if (logger) {
    logger.error(`Error in ${apiType} API:`, error);
  }

  const statusCode =
    error instanceof ApiError
      ? error.statusCode
      : typeof error?.statusCode === 'number'
        ? error.statusCode
        : 500;
  let responsePayload: Record<string, any>;

  if (error instanceof ApiError && error.code) {
    responsePayload = {
      code: error.code,
      error: error.message,
    };

    // Include any additional data associated with the error
    if (error.additionalData) {
      Object.assign(responsePayload, error.additionalData);
    }
  } else {
    responsePayload = { error: error.message };
  }

  await respondWith({
    res,
    statusCode,
    responsePayload,
    runtimeScope,
    apiType,
    startTime,
    requestPayload,
    threadId,
    headers,
  });
};
