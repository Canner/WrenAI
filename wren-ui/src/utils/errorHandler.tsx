import { GraphQLError } from 'graphql';
import { ErrorResponse } from '@apollo/client/link/error';
import { message } from 'antd';

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

errorHandlers.set('SaveTables', new SaveTablesErrorHandler());
errorHandlers.set('SaveRelations', new SaveRelationsErrorHandler());

const errorHandler = (error: ErrorResponse) => {
  const operationName = error?.operation?.operationName || '';
  if (error.graphQLErrors) {
    for (const err of error.graphQLErrors) {
      errorHandlers.get(operationName)?.handle(err);
    }
  }
};

export default errorHandler;
