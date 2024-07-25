import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type DeployMutationVariables = Types.Exact<{ [key: string]: never; }>;


export type DeployMutation = { __typename?: 'Mutation', deploy: any };

export type DeployStatusQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type DeployStatusQuery = { __typename?: 'Query', modelSync: { __typename?: 'ModelSyncResponse', status: Types.SyncStatus } };


export const DeployDocument = gql`
    mutation Deploy {
  deploy
}
    `;
export type DeployMutationFn = Apollo.MutationFunction<DeployMutation, DeployMutationVariables>;

/**
 * __useDeployMutation__
 *
 * To run a mutation, you first call `useDeployMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeployMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deployMutation, { data, loading, error }] = useDeployMutation({
 *   variables: {
 *   },
 * });
 */
export function useDeployMutation(baseOptions?: Apollo.MutationHookOptions<DeployMutation, DeployMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeployMutation, DeployMutationVariables>(DeployDocument, options);
      }
export type DeployMutationHookResult = ReturnType<typeof useDeployMutation>;
export type DeployMutationResult = Apollo.MutationResult<DeployMutation>;
export type DeployMutationOptions = Apollo.BaseMutationOptions<DeployMutation, DeployMutationVariables>;
export const DeployStatusDocument = gql`
    query DeployStatus {
  modelSync {
    status
  }
}
    `;

/**
 * __useDeployStatusQuery__
 *
 * To run a query within a React component, call `useDeployStatusQuery` and pass it any options that fit your needs.
 * When your component renders, `useDeployStatusQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useDeployStatusQuery({
 *   variables: {
 *   },
 * });
 */
export function useDeployStatusQuery(baseOptions?: Apollo.QueryHookOptions<DeployStatusQuery, DeployStatusQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<DeployStatusQuery, DeployStatusQueryVariables>(DeployStatusDocument, options);
      }
export function useDeployStatusLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<DeployStatusQuery, DeployStatusQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<DeployStatusQuery, DeployStatusQueryVariables>(DeployStatusDocument, options);
        }
export type DeployStatusQueryHookResult = ReturnType<typeof useDeployStatusQuery>;
export type DeployStatusLazyQueryHookResult = ReturnType<typeof useDeployStatusLazyQuery>;
export type DeployStatusQueryResult = Apollo.QueryResult<DeployStatusQuery, DeployStatusQueryVariables>;