import { NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import { components } from '@/common';
import {
  ApiType,
  ApiHistory,
  IApiHistoryRepository,
} from '@server/repositories/apiHistoryRepository';
import {
  RuntimeScope,
  toPersistedRuntimeIdentity,
} from '@server/context/runtimeScope';
import { toPersistedRuntimeIdentityPatch } from '@server/utils/persistedRuntimeIdentity';
import * as Errors from '@server/utils/error';

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

  const runtimeIdentity = toPersistedRuntimeIdentityPatch(
    toPersistedRuntimeIdentity(runtimeScope),
  );
  return await apiHistoryRepository.createOne({
    ...record,
    ...runtimeIdentity,
  });
};

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
