export type RestErrorPayload = {
  error?: string;
};

import { createAbortError, isAbortRequestError } from '@/utils/abort';

export const parseRestJsonResponse = async <TPayload>(
  response: Response,
  fallbackMessage: string,
): Promise<TPayload> => {
  const payload = (await response.json().catch(() => null)) as
    | TPayload
    | RestErrorPayload
    | null;

  if (!response.ok) {
    throw new Error(
      (payload as RestErrorPayload | null)?.error || fallbackMessage,
    );
  }

  return payload as TPayload;
};

const TRANSIENT_RUNTIME_SCOPE_ERROR_PATTERNS = [
  'workspace scope could not be resolved',
  'session workspace does not match requested workspace',
  'no deployment found for the requested runtime scope',
  'knowledge base does not belong to the requested workspace',
  'kb_snapshot does not belong to the requested knowledge base',
  'runtime scope selector is required for this request',
  'failed to fetch',
  'network request failed',
  'load failed',
  'fetch failed',
  'networkerror',
  'ecconnrefused',
  'econnrefused',
  'service temporarily unavailable',
  '加载运行时范围失败',
  '加载部署状态失败',
  '加载历史对话失败',
];

const readRestErrorMessage = (error: unknown) => {
  if (typeof error === 'string') {
    return error.trim();
  }

  if (error instanceof Error) {
    return error.message.trim();
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message.trim();
  }

  return '';
};

export const shouldRetryTransientRuntimeScopeError = (error: unknown) => {
  if (isAbortRequestError(error)) {
    return false;
  }

  const normalizedMessage = readRestErrorMessage(error).toLowerCase();
  if (!normalizedMessage) {
    return false;
  }

  return TRANSIENT_RUNTIME_SCOPE_ERROR_PATTERNS.some((pattern) =>
    normalizedMessage.includes(pattern),
  );
};

const waitForRetryDelay = ({
  ms,
  signal,
}: {
  ms: number;
  signal?: AbortSignal;
}) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError('request-retry-aborted'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
      reject(createAbortError('request-retry-aborted'));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
  });

export const withTransientRuntimeScopeRetry = async <TPayload>({
  loader,
  signal,
  maxRetries = 2,
  retryDelayMs = 180,
}: {
  loader: () => Promise<TPayload>;
  signal?: AbortSignal;
  maxRetries?: number;
  retryDelayMs?: number;
}): Promise<TPayload> => {
  let attempt = 0;

  while (true) {
    try {
      return await loader();
    } catch (error) {
      if (
        attempt >= maxRetries ||
        !shouldRetryTransientRuntimeScopeError(error)
      ) {
        throw error;
      }

      attempt += 1;
      await waitForRetryDelay({
        ms: retryDelayMs * attempt,
        signal,
      });
    }
  }
};
