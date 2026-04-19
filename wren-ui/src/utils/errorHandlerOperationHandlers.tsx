import { message } from 'antd';

export type ApiOperationError = {
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

/**
 * Replace the token %{s} in the message with the detail message.
 */
const replaceMessage = (text: string, detailMessage?: string) => {
  const regex = /\%\{.+\}/;
  const textWithoutTokenRegex = /(?<=\%\{).+(?=\})/;
  const matchText = text.match(textWithoutTokenRegex);
  if (matchText === null) {
    console.warn('Replace token not found in message:', text);
    return text;
  }
  return detailMessage
    ? text.replace(regex, `- ${detailMessage}`)
    : text.replace(regex, matchText[0]);
};

abstract class ErrorHandler {
  public handle(error: ApiOperationError) {
    const errorMessage = this.getErrorMessage(error);
    if (errorMessage) message.error(errorMessage);
  }

  abstract getErrorMessage(error: ApiOperationError): string | null;
}

const createDefaultErrorHandler = (messageText: string) =>
  new (class extends ErrorHandler {
    public getErrorMessage() {
      return messageText;
    }
  })();

const errorHandlers = new Map<string, ErrorHandler>([
  ['SaveTables', createDefaultErrorHandler('Failed to create model(s).')],
  ['SaveRelations', createDefaultErrorHandler('Failed to define relations.')],
  [
    'CreateAskingTask',
    createDefaultErrorHandler('创建问答任务失败，请稍后重试。'),
  ],
  ['CreateThread', createDefaultErrorHandler('创建对话失败，请稍后重试。')],
  ['UpdateThread', createDefaultErrorHandler('更新对话失败。')],
  ['DeleteThread', createDefaultErrorHandler('删除对话失败。')],
  [
    'CreateThreadResponse',
    createDefaultErrorHandler('Failed to create thread response.'),
  ],
  [
    'UpdateThreadResponse',
    createDefaultErrorHandler('Failed to update thread response.'),
  ],
  [
    'GenerateThreadResponseAnswer',
    createDefaultErrorHandler('Failed to generate thread response answer.'),
  ],
  [
    'AdjustThreadResponse',
    createDefaultErrorHandler('Failed to adjust thread response answer.'),
  ],
  ['CreateView', createDefaultErrorHandler('Failed to create view.')],
  [
    'UpdateConnection',
    new (class extends ErrorHandler {
      public getErrorMessage(error: ApiOperationError) {
        return replaceMessage(`Failed to update %{connection}.`, error.message);
      }
    })(),
  ],
  ['CreateModel', createDefaultErrorHandler('Failed to create model.')],
  ['UpdateModel', createDefaultErrorHandler('Failed to update model.')],
  ['DeleteModel', createDefaultErrorHandler('Failed to delete model.')],
  [
    'UpdateModelMetadata',
    createDefaultErrorHandler('Failed to update model metadata.'),
  ],
  [
    'CreateCalculatedField',
    createDefaultErrorHandler('Failed to create calculated field.'),
  ],
  [
    'UpdateCalculatedField',
    createDefaultErrorHandler('Failed to update calculated field.'),
  ],
  [
    'DeleteCalculatedField',
    createDefaultErrorHandler('Failed to delete calculated field.'),
  ],
  [
    'CreateRelationship',
    createDefaultErrorHandler('Failed to create relationship.'),
  ],
  [
    'UpdateRelationship',
    createDefaultErrorHandler('Failed to update relationship.'),
  ],
  [
    'DeleteRelationship',
    createDefaultErrorHandler('Failed to delete relationship.'),
  ],
  [
    'UpdateViewMetadata',
    createDefaultErrorHandler('Failed to update view metadata.'),
  ],
  [
    'TriggerConnectionDetection',
    createDefaultErrorHandler('Failed to scan connection schema.'),
  ],
  [
    'ResolveSchemaChange',
    createDefaultErrorHandler('Failed to resolve schema change.'),
  ],
  [
    'CreateDashboardItem',
    createDefaultErrorHandler('Failed to create dashboard item.'),
  ],
  [
    'UpdateDashboardItem',
    createDefaultErrorHandler('Failed to update dashboard item.'),
  ],
  [
    'UpdateDashboardItemLayouts',
    createDefaultErrorHandler('Failed to update dashboard item layouts.'),
  ],
  [
    'DeleteDashboardItem',
    createDefaultErrorHandler('Failed to delete dashboard item.'),
  ],
  [
    'SetDashboardSchedule',
    createDefaultErrorHandler('Failed to set dashboard schedule.'),
  ],
  [
    'CreateSqlPair',
    createDefaultErrorHandler('Failed to create question-sql pair.'),
  ],
  [
    'UpdateSqlPair',
    createDefaultErrorHandler('Failed to update question-sql pair.'),
  ],
  [
    'DeleteSqlPair',
    createDefaultErrorHandler('Failed to delete question-sql pair.'),
  ],
  [
    'CreateInstruction',
    createDefaultErrorHandler('Failed to create instruction.'),
  ],
  [
    'UpdateInstruction',
    createDefaultErrorHandler('Failed to update instruction.'),
  ],
  [
    'DeleteInstruction',
    createDefaultErrorHandler('Failed to delete instruction.'),
  ],
]);

export const handleOperationError = (
  operationName: string,
  operationError: ApiOperationError,
) => {
  errorHandlers.get(operationName)?.handle(operationError);
};
