const ABORT_ERROR_NAME = 'AbortError';
const KNOWN_ABORT_MESSAGES = new Set([
  'signal is aborted without reason',
  'the operation was aborted',
  'the operation was aborted.',
  'this operation was aborted',
  'this operation was aborted.',
  'the user aborted a request',
  'the user aborted a request.',
]);

const readErrorName = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return '';
  }

  return 'name' in error &&
    typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name.trim()
    : '';
};

const readErrorMessage = (error: unknown) => {
  if (typeof error === 'string') {
    return error.trim();
  }

  if (!error || typeof error !== 'object') {
    return '';
  }

  return 'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message.trim()
    : '';
};

const isAbortMessage = (message: string) => {
  const normalizedMessage = message.trim().toLowerCase();
  if (!normalizedMessage) {
    return false;
  }

  if (KNOWN_ABORT_MESSAGES.has(normalizedMessage)) {
    return true;
  }

  return (
    /\babort(?:ed)?\b/.test(normalizedMessage) &&
    /\b(signal|request|operation)\b/.test(normalizedMessage)
  );
};

export const createAbortError = (message: string) => {
  try {
    return new DOMException(message, ABORT_ERROR_NAME);
  } catch {
    const fallbackError = new Error(message);
    fallbackError.name = ABORT_ERROR_NAME;
    return fallbackError;
  }
};

export const abortWithReason = (
  controller: AbortController,
  message: string,
) => {
  controller.abort(createAbortError(message));
};

export const isAbortRequestError = (error: unknown) => {
  if (!error) {
    return false;
  }

  if (error instanceof DOMException) {
    return error.name === ABORT_ERROR_NAME;
  }

  if (error instanceof Error) {
    return error.name === ABORT_ERROR_NAME;
  }

  const errorName = readErrorName(error);
  if (errorName === ABORT_ERROR_NAME) {
    return true;
  }

  return isAbortMessage(readErrorMessage(error));
};

export const resolveAbortSafeErrorMessage = (
  error: unknown,
  fallbackMessage?: string,
) => {
  if (isAbortRequestError(error)) {
    return null;
  }

  const explicitMessage = readErrorMessage(error);

  if (explicitMessage) {
    return explicitMessage;
  }

  return fallbackMessage || null;
};
