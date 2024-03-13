import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type ManifestQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type ManifestQuery = { __typename?: 'Query', manifest: any };

export type SaveMdlMutationVariables = Types.Exact<{
  data: Types.MdlInput;
}>;


export type SaveMdlMutation = { __typename?: 'Mutation', saveMDL: any };


export const ManifestDocument = gql`
    query Manifest {
  manifest
}
    `;

/**
 * __useManifestQuery__
 *
 * To run a query within a React component, call `useManifestQuery` and pass it any options that fit your needs.
 * When your component renders, `useManifestQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useManifestQuery({
 *   variables: {
 *   },
 * });
 */
export function useManifestQuery(baseOptions?: Apollo.QueryHookOptions<ManifestQuery, ManifestQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<ManifestQuery, ManifestQueryVariables>(ManifestDocument, options);
      }
export function useManifestLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<ManifestQuery, ManifestQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<ManifestQuery, ManifestQueryVariables>(ManifestDocument, options);
        }
export type ManifestQueryHookResult = ReturnType<typeof useManifestQuery>;
export type ManifestLazyQueryHookResult = ReturnType<typeof useManifestLazyQuery>;
export type ManifestQueryResult = Apollo.QueryResult<ManifestQuery, ManifestQueryVariables>;
export const SaveMdlDocument = gql`
    mutation SaveMDL($data: MDLInput!) {
  saveMDL(data: $data)
}
    `;
export type SaveMdlMutationFn = Apollo.MutationFunction<SaveMdlMutation, SaveMdlMutationVariables>;

/**
 * __useSaveMdlMutation__
 *
 * To run a mutation, you first call `useSaveMdlMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useSaveMdlMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [saveMdlMutation, { data, loading, error }] = useSaveMdlMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useSaveMdlMutation(baseOptions?: Apollo.MutationHookOptions<SaveMdlMutation, SaveMdlMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<SaveMdlMutation, SaveMdlMutationVariables>(SaveMdlDocument, options);
      }
export type SaveMdlMutationHookResult = ReturnType<typeof useSaveMdlMutation>;
export type SaveMdlMutationResult = Apollo.MutationResult<SaveMdlMutation>;
export type SaveMdlMutationOptions = Apollo.BaseMutationOptions<SaveMdlMutation, SaveMdlMutationVariables>;