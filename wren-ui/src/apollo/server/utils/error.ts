import { GraphQLError } from 'graphql';

export enum GeneralErrorCodes {
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',

  // AI service errors
  MISLEADING_QUERY = 'MISLEADING_QUERY',
  NO_RELEVANT_DATA = 'NO_RELEVANT_DATA',
  NO_RELEVANT_SQL = 'NO_RELEVANT_SQL',

  // Exception error for AI service (e.g., network connection error)
  AI_SERVICE_UNDEFINED_ERROR = 'OTHERS',

  // Connector errors
  // duckdb
  INIT_SQL_ERROR = 'INIT_SQL_ERROR',
  SESSION_PROPS_ERROR = 'SESSION_PROPS_ERROR',

  // calculated field validation
  DUPLICATED_FIELD_NAME = 'DUPLICATED_FIELD_NAME',
  INVALID_EXPRESSION = 'INVALID_EXPRESSION',
  INVALID_CALCULATED_FIELD = 'INVALID_CALCULATED_FIELD',
}

export const errorMessages = {
  [GeneralErrorCodes.INTERNAL_SERVER_ERROR]: 'Internal server error',

  // AI service errors
  [GeneralErrorCodes.MISLEADING_QUERY]:
    'The query provided is misleading and may not yield accurate results. Please refine your query.',
  [GeneralErrorCodes.NO_RELEVANT_DATA]:
    'No relevant data found for the given query. Please try a different query.',
  [GeneralErrorCodes.NO_RELEVANT_SQL]:
    'No relevant SQL found for the given query. Please check your query and try again.',

  // Connector errors
  // duckdb
  [GeneralErrorCodes.INIT_SQL_ERROR]:
    'The initializing SQL seems to be invalid, Please check your SQL and try again.',
  [GeneralErrorCodes.SESSION_PROPS_ERROR]:
    'The session properties seem to be invalid, Please check your session properties and try again.',

  // calculated field validation
  [GeneralErrorCodes.DUPLICATED_FIELD_NAME]: 'This field name already exists',
  [GeneralErrorCodes.INVALID_EXPRESSION]:
    'Invalid expression, please check your expression and try again.',
  [GeneralErrorCodes.INVALID_CALCULATED_FIELD]:
    'Can not execute a query when using this calculated field',
};

export const shortMessages = {
  [GeneralErrorCodes.INTERNAL_SERVER_ERROR]: 'Internal server error',
  [GeneralErrorCodes.MISLEADING_QUERY]: 'Misleading query',
  [GeneralErrorCodes.NO_RELEVANT_DATA]: 'No relevant data',
  [GeneralErrorCodes.NO_RELEVANT_SQL]: 'No relevant SQL',
  [GeneralErrorCodes.INIT_SQL_ERROR]: 'Invalid initializing SQL',
  [GeneralErrorCodes.SESSION_PROPS_ERROR]: 'Invalid session properties',
  [GeneralErrorCodes.DUPLICATED_FIELD_NAME]: 'Duplicated field name',
  [GeneralErrorCodes.INVALID_EXPRESSION]: 'Invalid expression',
  [GeneralErrorCodes.INVALID_CALCULATED_FIELD]: 'Invalid calculated field',
};

export const create = (
  code?: GeneralErrorCodes,
  options?: {
    customMessage?: string;
    originalError?: Error;
  },
): GraphQLError => {
  const { customMessage, originalError } = options || {};
  // Default to INTERNAL_SERVER_ERROR if no code is provided
  code = code || GeneralErrorCodes.INTERNAL_SERVER_ERROR;

  // Get the error message based on the code
  const message =
    customMessage ||
    originalError?.message ||
    errorMessages[code] ||
    errorMessages[GeneralErrorCodes.INTERNAL_SERVER_ERROR];

  // Return the GraphQLError
  const err = new GraphQLError(message, {
    extensions: {
      originalError,
      code,
      message,
      shortMessage:
        shortMessages[code] ||
        shortMessages[GeneralErrorCodes.INTERNAL_SERVER_ERROR],
    },
  });

  return err;
};

/**
 * Default error handler for Apollo Server
 * For error like this:
 * [GraphQLError: connect ECONNREFUSED 127.0.0.1:8080] {
 *   locations: [ { line: 2, column: 3 } ],
 *   path: [ 'previewData' ],
 *   extensions: {
 *     code: 'INTERNAL_SERVER_ERROR',
 *     exception: {
 *       port: 8080,
 *       address: '127.0.0.1',
 *       syscall: 'connect',
 *       code: 'ECONNREFUSED',
 *       errno: -61,
 *       message: 'connect ECONNREFUSED 127.0.0.1:8080',
 *       stack: 'Error: connect ECONNREFUSED 127.0.0.1:8080\n' +
 *         '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1278:16)',
 *       name: 'Error',
 *       config: [Object],
 *       request: [Writable],
 *       stacktrace: [Array]
 *     }
 *   }
 * }
 * it will easily cause `Converting circular structure to JSON` error.
 * Thus, we only pick required fields to reformat the error.
 */
export const defaultApolloErrorHandler = (error: GraphQLError) => {
  if (error instanceof GraphQLError) {
    const code = (error.extensions?.code ||
      GeneralErrorCodes.INTERNAL_SERVER_ERROR) as GeneralErrorCodes;
    return {
      locations: error.locations,
      path: error.path,
      message: error.message,
      extensions: {
        code,
        message: error.message,
        shortMessage: shortMessages[code],
        stacktrace: error.extensions?.exception?.stacktrace,
      },
    };
  }

  // Return the original error if it's not a GraphQLError
  return error;
};
