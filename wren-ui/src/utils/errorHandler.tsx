import { message } from 'antd';
import {
  shouldRecoverRuntimeScopeFromErrorCode,
  triggerRuntimeScopeRecovery,
} from '@/runtime/client/runtimeScope';
import { isAbortRequestError } from '@/utils/abort';

import {
  handleOperationError,
  type ApiOperationError,
} from './errorHandlerOperationHandlers';

type ErrorResponseLike = {
  networkError?: unknown;
  operation?: {
    operationName?: string;
  } | null;
  errors?: ApiOperationError[] | null;
};

const LEGACY_OPERATION_ERRORS_KEY = ['graph', 'QLErrors'].join('');

const readOperationErrors = (
  error:
    | {
        errors?: ApiOperationError[] | null;
      }
    | Record<string, unknown>
    | null
    | undefined,
): ApiOperationError[] => {
  if (!error || typeof error !== 'object') {
    return [];
  }

  const directErrors = (error as { errors?: unknown }).errors;
  if (Array.isArray(directErrors)) {
    return directErrors as ApiOperationError[];
  }

  const legacyErrors = (error as Record<string, unknown>)[
    LEGACY_OPERATION_ERRORS_KEY
  ];
  return Array.isArray(legacyErrors)
    ? (legacyErrors as ApiOperationError[])
    : [];
};

// Refer to backend GeneralErrorCodes for mapping
export const ERROR_CODES = {
  INVALID_CALCULATED_FIELD: 'INVALID_CALCULATED_FIELD',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  NO_CHART: 'NO_CHART',
};

const OFFLINE_NETWORK_ERROR_PATTERNS = [
  'failed to fetch',
  'network request failed',
  'load failed',
  'networkerror',
  'fetch failed',
  'econnrefused',
];

const ABORT_NETWORK_ERROR_PATTERNS = [
  'aborterror',
  'signal is aborted without reason',
  'the operation was aborted',
  'request was aborted',
];

const RUNTIME_SCOPE_NETWORK_ERROR_PATTERNS = [
  'runtime scope',
  'knowledge base',
  'kb_snapshot',
  'deploy_hash',
  'workspace scope',
  'no deployment found',
  'does not belong to the requested workspace',
];

const normalizeErrorText = (value?: string | null) =>
  (value || '').trim().toLowerCase();

type NetworkErrorLike = {
  statusCode?: number;
  response?: {
    status?: number;
  } | null;
  result?: {
    errors?: Array<{
      message?: string;
      extensions?: {
        code?: string;
      };
    }>;
  } | null;
  bodyText?: string;
};

const toNetworkErrorLike = (networkError: unknown): NetworkErrorLike | null => {
  if (!networkError || typeof networkError !== 'object') {
    return null;
  }

  return networkError as NetworkErrorLike;
};

const readNetworkStatusCode = (networkError: unknown): number | null => {
  const normalizedNetworkError = toNetworkErrorLike(networkError);
  if (!normalizedNetworkError) {
    return null;
  }

  const statusCode = normalizedNetworkError.statusCode;
  if (typeof statusCode === 'number') {
    return statusCode;
  }

  const responseStatus = normalizedNetworkError.response?.status;
  return typeof responseStatus === 'number' ? responseStatus : null;
};

const readNetworkOperationErrorMessage = (
  networkError: unknown,
): string | null => {
  const normalizedNetworkError = toNetworkErrorLike(networkError);
  if (!normalizedNetworkError) {
    return null;
  }

  const resultErrors = normalizedNetworkError.result?.errors;
  if (
    Array.isArray(resultErrors) &&
    typeof resultErrors[0]?.message === 'string'
  ) {
    return resultErrors[0].message;
  }

  const bodyText = normalizedNetworkError.bodyText;
  if (typeof bodyText !== 'string' || !bodyText.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(bodyText);
    return Array.isArray(parsed?.errors) &&
      typeof parsed.errors[0]?.message === 'string'
      ? parsed.errors[0].message
      : null;
  } catch {
    return null;
  }
};

const readNetworkOperationErrorCode = (
  networkError: unknown,
): string | null => {
  const normalizedNetworkError = toNetworkErrorLike(networkError);
  if (!normalizedNetworkError) {
    return null;
  }

  const resultErrors = normalizedNetworkError.result?.errors;
  if (
    Array.isArray(resultErrors) &&
    typeof resultErrors[0]?.extensions?.code === 'string'
  ) {
    return resultErrors[0].extensions.code;
  }

  const bodyText = normalizedNetworkError.bodyText;
  if (typeof bodyText !== 'string' || !bodyText.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(bodyText);
    return Array.isArray(parsed?.errors) &&
      typeof parsed.errors[0]?.extensions?.code === 'string'
      ? parsed.errors[0].extensions.code
      : null;
  } catch {
    return null;
  }
};

const isNavigatorOffline = () =>
  typeof navigator !== 'undefined' &&
  typeof navigator.onLine === 'boolean' &&
  navigator.onLine === false;

export const resolveNetworkErrorMessage = (
  networkError?: ErrorResponseLike['networkError'] | null,
) => {
  if (!networkError) {
    return null;
  }

  if (isAbortRequestError(networkError)) {
    return null;
  }

  const statusCode = readNetworkStatusCode(networkError);
  const operationErrorCode = readNetworkOperationErrorCode(networkError);
  const networkMessage = normalizeErrorText(
    `${(networkError as Error)?.message || ''} ${readNetworkOperationErrorMessage(networkError) || ''}`,
  );

  if (
    ABORT_NETWORK_ERROR_PATTERNS.some((pattern) =>
      networkMessage.includes(pattern),
    )
  ) {
    return null;
  }

  if (
    isNavigatorOffline() ||
    statusCode === 0 ||
    OFFLINE_NETWORK_ERROR_PATTERNS.some((pattern) =>
      networkMessage.includes(pattern),
    )
  ) {
    return '网络不可用，请检查连接后重试。';
  }

  if (statusCode === 401 || statusCode === 403) {
    return '登录已过期或无访问权限，请重新登录后重试。';
  }

  if (shouldRecoverRuntimeScopeFromErrorCode(operationErrorCode)) {
    triggerRuntimeScopeRecovery();
  }

  if (operationErrorCode === 'NO_DEPLOYMENT_FOUND') {
    return '当前知识库运行时不可用，请刷新或重新选择知识库后重试。';
  }

  if (operationErrorCode === 'OUTDATED_RUNTIME_SNAPSHOT') {
    return '当前知识库快照已过期，请刷新或重新选择知识库后重试。';
  }

  if (
    RUNTIME_SCOPE_NETWORK_ERROR_PATTERNS.some((pattern) =>
      networkMessage.includes(pattern),
    )
  ) {
    return '当前工作空间上下文不可用，请刷新或重新选择知识库后重试。';
  }

  if (statusCode !== null && statusCode >= 500) {
    return '服务暂时不可用，请稍后重试。';
  }

  return '请求失败，请重试。';
};

const errorHandler = (error: ErrorResponseLike) => {
  const networkErrorMessage = resolveNetworkErrorMessage(error.networkError);
  if (networkErrorMessage) {
    message.error(networkErrorMessage);
    return;
  }

  const operationName = error?.operation?.operationName || '';
  for (const operationError of readOperationErrors(error)) {
    handleOperationError(operationName, operationError);
  }
};

export default errorHandler;

type OperationClientError = {
  errors?: ApiOperationError[];
  message?: string;
};

export const isOperationClientError = (
  error: unknown,
): error is OperationClientError => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return readOperationErrors(error as Record<string, unknown>).length > 0;
};

export const parseOperationError = (
  error: OperationClientError | Record<string, unknown> | null | undefined,
) => {
  const operationError = readOperationErrors(error)?.[0];
  if (!operationError) return null;
  const extensions = operationError.extensions || {};
  return {
    message: extensions.message as string | undefined,
    shortMessage: extensions.shortMessage as string | undefined,
    code: extensions.code as string | undefined,
    stacktrace: extensions?.stacktrace as Array<string> | undefined,
  };
};

export const isAntdFormValidationError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return Array.isArray((error as { errorFields?: unknown[] }).errorFields);
};

export const handleFormSubmitError = (
  error: unknown,
  fallbackMessage = '操作失败，请稍后重试。',
) => {
  if (isAntdFormValidationError(error)) {
    return;
  }

  message.error(fallbackMessage);
};
