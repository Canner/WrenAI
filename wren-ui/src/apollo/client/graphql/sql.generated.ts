import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type PreviewSqlMutationVariables = Types.Exact<{
  data: Types.PreviewSqlDataInput;
}>;


export type PreviewSqlMutation = { __typename?: 'Mutation', previewSql: any };


export const PreviewSqlDocument = gql`
    mutation PreviewSQL($data: PreviewSQLDataInput!) {
  previewSql(data: $data)
}
    `;
export type PreviewSqlMutationFn = Apollo.MutationFunction<PreviewSqlMutation, PreviewSqlMutationVariables>;

/**
 * __usePreviewSqlMutation__
 *
 * To run a mutation, you first call `usePreviewSqlMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `usePreviewSqlMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [previewSqlMutation, { data, loading, error }] = usePreviewSqlMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function usePreviewSqlMutation(baseOptions?: Apollo.MutationHookOptions<PreviewSqlMutation, PreviewSqlMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<PreviewSqlMutation, PreviewSqlMutationVariables>(PreviewSqlDocument, options);
      }
export type PreviewSqlMutationHookResult = ReturnType<typeof usePreviewSqlMutation>;
export type PreviewSqlMutationResult = Apollo.MutationResult<PreviewSqlMutation>;
export type PreviewSqlMutationOptions = Apollo.BaseMutationOptions<PreviewSqlMutation, PreviewSqlMutationVariables>;