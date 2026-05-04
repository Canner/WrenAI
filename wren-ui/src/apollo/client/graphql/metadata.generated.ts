import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type UpdateModelMetadataMutationVariables = Types.Exact<{
  where: Types.ModelWhereInput;
  data: Types.UpdateModelMetadataInput;
}>;


export type UpdateModelMetadataMutation = { __typename?: 'Mutation', updateModelMetadata: boolean };

export type UpdateViewMetadataMutationVariables = Types.Exact<{
  where: Types.ViewWhereUniqueInput;
  data: Types.UpdateViewMetadataInput;
}>;


export type UpdateViewMetadataMutation = { __typename?: 'Mutation', updateViewMetadata: boolean };


export const UpdateModelMetadataDocument = gql`
    mutation UpdateModelMetadata($where: ModelWhereInput!, $data: UpdateModelMetadataInput!) {
  updateModelMetadata(where: $where, data: $data)
}
    `;
export type UpdateModelMetadataMutationFn = Apollo.MutationFunction<UpdateModelMetadataMutation, UpdateModelMetadataMutationVariables>;

/**
 * __useUpdateModelMetadataMutation__
 *
 * To run a mutation, you first call `useUpdateModelMetadataMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateModelMetadataMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateModelMetadataMutation, { data, loading, error }] = useUpdateModelMetadataMutation({
 *   variables: {
 *      where: // value for 'where'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateModelMetadataMutation(baseOptions?: Apollo.MutationHookOptions<UpdateModelMetadataMutation, UpdateModelMetadataMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateModelMetadataMutation, UpdateModelMetadataMutationVariables>(UpdateModelMetadataDocument, options);
      }
export type UpdateModelMetadataMutationHookResult = ReturnType<typeof useUpdateModelMetadataMutation>;
export type UpdateModelMetadataMutationResult = Apollo.MutationResult<UpdateModelMetadataMutation>;
export type UpdateModelMetadataMutationOptions = Apollo.BaseMutationOptions<UpdateModelMetadataMutation, UpdateModelMetadataMutationVariables>;
export const UpdateViewMetadataDocument = gql`
    mutation UpdateViewMetadata($where: ViewWhereUniqueInput!, $data: UpdateViewMetadataInput!) {
  updateViewMetadata(where: $where, data: $data)
}
    `;
export type UpdateViewMetadataMutationFn = Apollo.MutationFunction<UpdateViewMetadataMutation, UpdateViewMetadataMutationVariables>;

/**
 * __useUpdateViewMetadataMutation__
 *
 * To run a mutation, you first call `useUpdateViewMetadataMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateViewMetadataMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateViewMetadataMutation, { data, loading, error }] = useUpdateViewMetadataMutation({
 *   variables: {
 *      where: // value for 'where'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateViewMetadataMutation(baseOptions?: Apollo.MutationHookOptions<UpdateViewMetadataMutation, UpdateViewMetadataMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateViewMetadataMutation, UpdateViewMetadataMutationVariables>(UpdateViewMetadataDocument, options);
      }
export type UpdateViewMetadataMutationHookResult = ReturnType<typeof useUpdateViewMetadataMutation>;
export type UpdateViewMetadataMutationResult = Apollo.MutationResult<UpdateViewMetadataMutation>;
export type UpdateViewMetadataMutationOptions = Apollo.BaseMutationOptions<UpdateViewMetadataMutation, UpdateViewMetadataMutationVariables>;