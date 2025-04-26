import { NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@server/utils/error';
import { components } from '@/common';

const { apiHistoryRepository } = components;

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

/**
 * Common response handler for API endpoints that also logs to API history
 */
export const respondWith = async ({
  res,
  statusCode,
  responsePayload,
  projectId,
  apiType,
  threadId,
  headers,
  requestPayload,
  startTime,
}: {
  res: NextApiResponse;
  statusCode: number;
  responsePayload: any;
  projectId: number;
  apiType: ApiType;
  startTime: number;
  requestPayload?: Record<string, any>;
  threadId?: string;
  headers?: Record<string, string>;
}) => {
  const durationMs = startTime ? Date.now() - startTime : undefined;
  const responseId = uuidv4();
  await apiHistoryRepository.createOne({
    id: responseId,
    projectId,
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
 * Common error handler for API endpoints
 */
export const handleApiError = async ({
  error,
  res,
  projectId,
  apiType,
  requestPayload,
  threadId,
  headers,
  startTime,
  logger,
}: {
  error: any;
  res: NextApiResponse;
  projectId?: number;
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

  const statusCode = error instanceof ApiError ? error.statusCode : 500;
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
    projectId: projectId || 0,
    apiType,
    startTime,
    requestPayload,
    threadId,
    headers,
  });
};
