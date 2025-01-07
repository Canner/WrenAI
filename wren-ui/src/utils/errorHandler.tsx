import { GraphQLError } from 'graphql';
import { ErrorResponse } from '@apollo/client/link/error';
import { ApolloError } from '@apollo/client';
import { message } from 'antd';

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
  public handle(error: GraphQLError) {
    const errorMessage = this.getErrorMessage(error);
    if (errorMessage) message.error(errorMessage);
  }

  abstract getErrorMessage(error: GraphQLError): string | null;
}

const errorHandlers = new Map<string, ErrorHandler>();

class SaveTablesErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create model(s).';
    }
  }
}

class SaveRelationsErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to define relations.';
    }
  }
}

class CreateAskingTaskErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create asking task.';
    }
  }
}

class CreateThreadErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create thread.';
    }
  }
}

class UpdateThreadErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update thread.';
    }
  }
}

class DeleteThreadErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete thread.';
    }
  }
}

class CreateThreadResponseErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create thread response.';
    }
  }
}

class GenerateThreadResponseAnswerErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to generate thread response answer.';
    }
  }
}

class GenerateThreadResponseBreakdownErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to generate thread response breakdown SQL answer.';
    }
  }
}

class CreateViewErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create view.';
    }
  }
}

class UpdateDataSourceErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
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
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create model.';
    }
  }
}

class UpdateModelErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update model.';
    }
  }
}

class DeleteModelErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete model.';
    }
  }
}

class UpdateModelMetadataErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update model metadata.';
    }
  }
}

class CreateCalculatedFieldErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create calculated field.';
    }
  }
}

class UpdateCalculatedFieldErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update calculated field.';
    }
  }
}

class DeleteCalculatedFieldErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete calculated field.';
    }
  }
}

class CreateRelationshipErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create relationship.';
    }
  }
}

class UpdateRelationshipErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update relationship.';
    }
  }
}

class DeleteRelationshipErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete relationship.';
    }
  }
}

class UpdateViewMetadataErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update view metadata.';
    }
  }
}

class TriggerDataSourceDetectionErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to scan data source.';
    }
  }
}

class ResolveSchemaChangeErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to resolve schema change.';
    }
  }
}

class CreateDashboardItemErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to create dashboard item.';
    }
  }
}

class UpdateDashboardItemLayoutsErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to update dashboard item layouts.';
    }
  }
}

class DeleteDashboardItemErrorHandler extends ErrorHandler {
  public getErrorMessage(error: GraphQLError) {
    switch (error.extensions?.code) {
      default:
        return 'Failed to delete dashboard item.';
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
  'GenerateThreadResponseAnswer',
  new GenerateThreadResponseAnswerErrorHandler(),
);
errorHandlers.set(
  'GenerateThreadResponseBreakdown',
  new GenerateThreadResponseBreakdownErrorHandler(),
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
errorHandlers.set(
  'UpdateDashboardItemLayouts',
  new UpdateDashboardItemLayoutsErrorHandler(),
);
errorHandlers.set('DeleteDashboardItem', new DeleteDashboardItemErrorHandler());

const errorHandler = (error: ErrorResponse) => {
  // networkError
  if (error.networkError) {
    message.error(
      'No internet. Please check your network connection and try again.',
    );
  }

  const operationName = error?.operation?.operationName || '';
  if (error.graphQLErrors) {
    for (const err of error.graphQLErrors) {
      errorHandlers.get(operationName)?.handle(err);
    }
  }
};

export default errorHandler;

export const parseGraphQLError = (error: ApolloError) => {
  if (!error) return null;
  const graphQLErrors: GraphQLError = error.graphQLErrors?.[0];
  const extensions = graphQLErrors?.extensions || {};
  return {
    message: extensions.message as string,
    shortMessage: extensions.shortMessage as string,
    code: extensions.code as string,
    stacktrace: extensions?.stacktrace as Array<string> | undefined,
  };
};
