import { message } from 'antd';
import {
  shouldRecoverRuntimeScopeFromErrorCode,
  triggerRuntimeScopeRecovery,
} from '@/apollo/client/runtimeScope';

type GraphQLErrorLike = {
  message?: string;
  extensions?: {
    code?: string;
    message?: string;
    shortMessage?: string;
    stacktrace?: Array<string>;
    exception?: {
      stacktrace?: Array<string>;
    };
  } | null;
};

type ErrorResponseLike = {
  networkError?: unknown;
  operation?: {
    operationName?: string;
  } | null;
  graphQLErrors?: GraphQLErrorLike[] | null;
};

// Refer to backend GeneralErrorCodes for mapping
export const ERROR_CODES = {
  INVALID_CALCULATED_FIELD: 'INVALID_CALCULATED_FIELD',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  NO_CHART: 'NO_CHART',
};

/**
 * Replace the token %{s} in the message with the detail message.
 * For example:
 *
 *  Input: ('Failed to update %{data source}.')
 *  Output: Failed to update data source.
 *
 *  Input: ('Failed to update %{data source}.', 'The data source is not found.')
 *  Output: Failed to update - The data source is not found.
 *
 * @param message The default message with replace token %{s}.
 * @param detailMessage The detail message.
 * @returns string
 */
const replaceMessage = (message: string, detailMessage?: string) => {
  const regex = /\%\{.+\}/;
  const textWithoutTokenRegex = /(?<=\%\{).+(?=\})/;
  const matchText = message.match(textWithoutTokenRegex);
  if (matchText === null) {
    console.warn('Replace token not found in message:', message);
    return message;
  }
  return detailMessage
    ? message.replace(regex, `- ${detailMessage}`)
    : message.replace(regex, matchText[0]);
};

abstract class ErrorHandler {
  public handle(error: GraphQLErrorLike) {
    const errorMessage = this.getErrorMessage(error);
    if (errorMessage) message.error(errorMessage);
  }

  abstract getErrorMessage(error: GraphQLErrorLike): string | null;
}

const errorHandlers = new Map<string, ErrorHandler>();

class SaveTablesErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create model(s).';
    }
  }
}

class SaveRelationsErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to define relations.';
    }
  }
}

class CreateAskingTaskErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return '创建问答任务失败，请稍后重试。';
    }
  }
}

class CreateThreadErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return '创建对话失败，请稍后重试。';
    }
  }
}

class UpdateThreadErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return '更新对话失败。';
    }
  }
}

class DeleteThreadErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return '删除对话失败。';
    }
  }
}

class CreateThreadResponseErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create thread response.';
    }
  }
}

class UpdateThreadResponseErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update thread response.';
    }
  }
}

class GenerateThreadResponseAnswerErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to generate thread response answer.';
    }
  }
}

class AdjustThreadResponseErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to adjust thread response answer.';
    }
  }
}

class CreateViewErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create view.';
    }
  }
}

class UpdateDataSourceErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return replaceMessage(
          `Failed to update %{data source}.`,
          error.message,
        );
    }
  }
}

class CreateModelErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create model.';
    }
  }
}

class UpdateModelErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update model.';
    }
  }
}

class DeleteModelErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete model.';
    }
  }
}

class UpdateModelMetadataErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update model metadata.';
    }
  }
}

class CreateCalculatedFieldErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create calculated field.';
    }
  }
}

class UpdateCalculatedFieldErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update calculated field.';
    }
  }
}

class DeleteCalculatedFieldErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete calculated field.';
    }
  }
}

class CreateRelationshipErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create relationship.';
    }
  }
}

class UpdateRelationshipErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update relationship.';
    }
  }
}

class DeleteRelationshipErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete relationship.';
    }
  }
}

class UpdateViewMetadataErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update view metadata.';
    }
  }
}

class TriggerDataSourceDetectionErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to scan data source.';
    }
  }
}

class ResolveSchemaChangeErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to resolve schema change.';
    }
  }
}

class CreateDashboardItemErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create dashboard item.';
    }
  }
}

class UpdateDashboardItemErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update dashboard item.';
    }
  }
}

class UpdateDashboardItemLayoutsErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update dashboard item layouts.';
    }
  }
}

class DeleteDashboardItemErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete dashboard item.';
    }
  }
}

class SetDashboardScheduleErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to set dashboard schedule.';
    }
  }
}

class CreateSqlPairErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create question-sql pair.';
    }
  }
}

class UpdateSqlPairErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update question-sql pair.';
    }
  }
}

class DeleteSqlPairErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete question-sql pair.';
    }
  }
}

class CreateInstructionErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create instruction.';
    }
  }
}

class UpdateInstructionErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update instruction.';
    }
  }
}

class DeleteInstructionErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLErrorLike) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete instruction.';
    }
  }
}

errorHandlers.set('SaveTables', new SaveTablesErrorHandler());
errorHandlers.set('SaveRelations', new SaveRelationsErrorHandler());
errorHandlers.set('CreateAskingTask', new CreateAskingTaskErrorHandler());
errorHandlers.set('CreateThread', new CreateThreadErrorHandler());
errorHandlers.set('UpdateThread', new UpdateThreadErrorHandler());
errorHandlers.set('DeleteThread', new DeleteThreadErrorHandler());
errorHandlers.set(
  'CreateThreadResponse',
  new CreateThreadResponseErrorHandler(),
);
errorHandlers.set(
  'UpdateThreadResponse',
  new UpdateThreadResponseErrorHandler(),
);
errorHandlers.set(
  'GenerateThreadResponseAnswer',
  new GenerateThreadResponseAnswerErrorHandler(),
);
errorHandlers.set(
  'AdjustThreadResponse',
  new AdjustThreadResponseErrorHandler(),
);

errorHandlers.set('CreateView', new CreateViewErrorHandler());
errorHandlers.set('UpdateDataSource', new UpdateDataSourceErrorHandler());
errorHandlers.set('CreateModel', new CreateModelErrorHandler());
errorHandlers.set('UpdateModel', new UpdateModelErrorHandler());
errorHandlers.set('DeleteModel', new DeleteModelErrorHandler());
errorHandlers.set('UpdateModelMetadata', new UpdateModelMetadataErrorHandler());
errorHandlers.set('UpdateViewMetadata', new UpdateViewMetadataErrorHandler());
errorHandlers.set(
  'CreateCalculatedField',
  new CreateCalculatedFieldErrorHandler(),
);
errorHandlers.set(
  'UpdateCalculatedField',
  new UpdateCalculatedFieldErrorHandler(),
);
errorHandlers.set(
  'DeleteCalculatedField',
  new DeleteCalculatedFieldErrorHandler(),
);

// Relationship
errorHandlers.set('CreateRelationship', new CreateRelationshipErrorHandler());
errorHandlers.set('UpdateRelationship', new UpdateRelationshipErrorHandler());
errorHandlers.set('DeleteRelationship', new DeleteRelationshipErrorHandler());

// Schema change
errorHandlers.set(
  'TriggerDataSourceDetection',
  new TriggerDataSourceDetectionErrorHandler(),
);
errorHandlers.set('ResolveSchemaChange', new ResolveSchemaChangeErrorHandler());

// Dashboard
errorHandlers.set('CreateDashboardItem', new CreateDashboardItemErrorHandler());
errorHandlers.set('UpdateDashboardItem', new UpdateDashboardItemErrorHandler());
errorHandlers.set(
  'UpdateDashboardItemLayouts',
  new UpdateDashboardItemLayoutsErrorHandler(),
);
errorHandlers.set('DeleteDashboardItem', new DeleteDashboardItemErrorHandler());
errorHandlers.set(
  'SetDashboardSchedule',
  new SetDashboardScheduleErrorHandler(),
);

// SQL Pair
errorHandlers.set('CreateSqlPair', new CreateSqlPairErrorHandler());
errorHandlers.set('UpdateSqlPair', new UpdateSqlPairErrorHandler());
errorHandlers.set('DeleteSqlPair', new DeleteSqlPairErrorHandler());

// Instruction
errorHandlers.set('CreateInstruction', new CreateInstructionErrorHandler());
errorHandlers.set('UpdateInstruction', new UpdateInstructionErrorHandler());
errorHandlers.set('DeleteInstruction', new DeleteInstructionErrorHandler());

const OFFLINE_NETWORK_ERROR_PATTERNS = [
  'failed to fetch',
  'network request failed',
  'load failed',
  'networkerror',
  'fetch failed',
  'econnrefused',
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

const readNetworkGraphQLErrorMessage = (
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

const readNetworkGraphQLErrorCode = (networkError: unknown): string | null => {
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

  const statusCode = readNetworkStatusCode(networkError);
  const graphQLErrorCode = readNetworkGraphQLErrorCode(networkError);
  const networkMessage = normalizeErrorText(
    `${(networkError as Error)?.message || ''} ${readNetworkGraphQLErrorMessage(networkError) || ''}`,
  );

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

  if (shouldRecoverRuntimeScopeFromErrorCode(graphQLErrorCode)) {
    triggerRuntimeScopeRecovery();
  }

  if (graphQLErrorCode === 'NO_DEPLOYMENT_FOUND') {
    return '当前知识库运行时不可用，请刷新或重新选择知识库后重试。';
  }

  if (graphQLErrorCode === 'OUTDATED_RUNTIME_SNAPSHOT') {
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
  if (error.graphQLErrors) {
    for (const err of error.graphQLErrors) {
      errorHandlers.get(operationName)?.handle(err);
    }
  }
};

export default errorHandler;

type ApolloLikeError = {
  graphQLErrors?: GraphQLErrorLike[];
  message?: string;
};

export const isApolloLikeError = (error: unknown): error is ApolloLikeError => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return Array.isArray((error as ApolloLikeError).graphQLErrors);
};

export const parseGraphQLError = (
  error: ApolloLikeError | null | undefined,
) => {
  if (!error) return null;
  const graphQLErrors = error.graphQLErrors?.[0];
  const extensions = graphQLErrors?.extensions || {};
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
