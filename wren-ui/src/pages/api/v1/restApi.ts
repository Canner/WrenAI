import type { NextApiResponse } from 'next';
import { ApiError } from '@/server/utils/apiUtils';
import { AuthorizationError } from '@server/authz/authorize';
import { OUTDATED_RUNTIME_SNAPSHOT_MESSAGE } from '@server/utils/runtimeExecutionContext';

const isBadRequestMessage = (message: string) =>
  [
    /\b(required|invalid|unsupported)\b/i,
    /read[- ]?only/i,
    /\bcannot be\b/i,
    /\bmust (?:be|provide)\b/i,
  ].some((pattern) => pattern.test(message));

export const inferRestApiStatusCode = (error: unknown) => {
  if (error instanceof ApiError) {
    return error.statusCode;
  }

  if (error instanceof AuthorizationError) {
    return error.statusCode;
  }

  if (
    typeof (error as { statusCode?: unknown } | null | undefined)
      ?.statusCode === 'number'
  ) {
    return (error as { statusCode: number }).statusCode;
  }

  const message = error instanceof Error ? error.message : String(error || '');

  if (message === OUTDATED_RUNTIME_SNAPSHOT_MESSAGE) {
    return 409;
  }

  if (/method not allowed/i.test(message)) {
    return 405;
  }

  if (/not found/i.test(message)) {
    return 404;
  }

  if (isBadRequestMessage(message)) {
    return 400;
  }

  return 500;
};

export const sendRestApiError = (
  res: NextApiResponse,
  error: unknown,
  fallbackMessage: string,
) => {
  const statusCode = inferRestApiStatusCode(error);
  const message =
    error instanceof Error && error.message ? error.message : fallbackMessage;

  if (statusCode >= 500 && process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.error(error);
  }

  return res.status(statusCode).json({ error: message });
};
