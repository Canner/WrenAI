import type { NextApiResponse } from 'next';
import { ApiError } from '@/apollo/server/utils/apiUtils';
import { AuthorizationError } from '@server/authz/authorize';
import { OUTDATED_RUNTIME_SNAPSHOT_MESSAGE } from '@server/utils/runtimeExecutionContext';

const inferStatusCode = (error: unknown) => {
  if (error instanceof ApiError) {
    return error.statusCode;
  }

  if (error instanceof AuthorizationError) {
    return error.statusCode;
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

  if (
    /required|invalid|unsupported|readonly|read-only|cannot|failed/i.test(
      message,
    )
  ) {
    return 400;
  }

  return 500;
};

export const sendRestApiError = (
  res: NextApiResponse,
  error: unknown,
  fallbackMessage: string,
) => {
  const statusCode = inferStatusCode(error);
  const message =
    error instanceof Error && error.message ? error.message : fallbackMessage;

  if (statusCode >= 500 && process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.error(error);
  }

  return res.status(statusCode).json({ error: message });
};
