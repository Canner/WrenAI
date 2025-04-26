import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type ApiHistoryQueryVariables = Types.Exact<{
  filter?: Types.InputMaybe<Types.ApiHistoryFilterInput>;
  pagination: Types.ApiHistoryPaginationInput;
}>;


export type ApiHistoryQuery = { __typename?: 'Query', apiHistory: { __typename?: 'ApiHistoryPaginatedResponse', total: number, hasMore: boolean, items: Array<{ __typename?: 'ApiHistoryResponse', id: string, projectId: number, apiType: Types.ApiType, threadId?: string | null, headers?: any | null, requestPayload?: any | null, responsePayload?: any | null, statusCode?: number | null, durationMs?: number | null, createdAt: string, updatedAt: string }> } };


export const ApiHistoryDocument = gql`
    query ApiHistory($filter: ApiHistoryFilterInput, $pagination: ApiHistoryPaginationInput!) {
  apiHistory(filter: $filter, pagination: $pagination) {
    items {
      id
      projectId
      apiType
      threadId
      headers
      requestPayload
      responsePayload
      statusCode
      durationMs
      createdAt
      updatedAt
    }
    total
    hasMore
  }
}
    `;

/**
 * __useApiHistoryQuery__
 *
 * To run a query within a React component, call `useApiHistoryQuery` and pass it any options that fit your needs.
 * When your component renders, `useApiHistoryQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useApiHistoryQuery({
 *   variables: {
 *      filter: // value for 'filter'
 *      pagination: // value for 'pagination'
 *   },
 * });
 */
export function useApiHistoryQuery(baseOptions: Apollo.QueryHookOptions<ApiHistoryQuery, ApiHistoryQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<ApiHistoryQuery, ApiHistoryQueryVariables>(ApiHistoryDocument, options);
      }
export function useApiHistoryLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<ApiHistoryQuery, ApiHistoryQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<ApiHistoryQuery, ApiHistoryQueryVariables>(ApiHistoryDocument, options);
        }
export type ApiHistoryQueryHookResult = ReturnType<typeof useApiHistoryQuery>;
export type ApiHistoryLazyQueryHookResult = ReturnType<typeof useApiHistoryLazyQuery>;
export type ApiHistoryQueryResult = Apollo.QueryResult<ApiHistoryQuery, ApiHistoryQueryVariables>;