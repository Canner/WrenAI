import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type ValidateCalculatedFieldMutationVariables = Types.Exact<{
  data: Types.ValidateCalculatedFieldInput;
}>;


export type ValidateCalculatedFieldMutation = { __typename?: 'Mutation', validateCalculatedField: { __typename?: 'CalculatedFieldValidationResponse', message?: string | null, valid: boolean } };

export type CreateCalculatedFieldMutationVariables = Types.Exact<{
  data: Types.CreateCalculatedFieldInput;
}>;


export type CreateCalculatedFieldMutation = { __typename?: 'Mutation', createCalculatedField: any };

export type UpdateCalculatedFieldMutationVariables = Types.Exact<{
  where: Types.UpdateCalculatedFieldWhere;
  data: Types.UpdateCalculatedFieldInput;
}>;


export type UpdateCalculatedFieldMutation = { __typename?: 'Mutation', updateCalculatedField: any };

export type DeleteCalculatedFieldMutationVariables = Types.Exact<{
  where: Types.UpdateCalculatedFieldWhere;
}>;


export type DeleteCalculatedFieldMutation = { __typename?: 'Mutation', deleteCalculatedField: boolean };


export const ValidateCalculatedFieldDocument = gql`
    mutation ValidateCalculatedField($data: ValidateCalculatedFieldInput!) {
  validateCalculatedField(data: $data) {
    message
    valid
  }
}
    `;
export type ValidateCalculatedFieldMutationFn = Apollo.MutationFunction<ValidateCalculatedFieldMutation, ValidateCalculatedFieldMutationVariables>;

/**
 * __useValidateCalculatedFieldMutation__
 *
 * To run a mutation, you first call `useValidateCalculatedFieldMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useValidateCalculatedFieldMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [validateCalculatedFieldMutation, { data, loading, error }] = useValidateCalculatedFieldMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useValidateCalculatedFieldMutation(baseOptions?: Apollo.MutationHookOptions<ValidateCalculatedFieldMutation, ValidateCalculatedFieldMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<ValidateCalculatedFieldMutation, ValidateCalculatedFieldMutationVariables>(ValidateCalculatedFieldDocument, options);
      }
export type ValidateCalculatedFieldMutationHookResult = ReturnType<typeof useValidateCalculatedFieldMutation>;
export type ValidateCalculatedFieldMutationResult = Apollo.MutationResult<ValidateCalculatedFieldMutation>;
export type ValidateCalculatedFieldMutationOptions = Apollo.BaseMutationOptions<ValidateCalculatedFieldMutation, ValidateCalculatedFieldMutationVariables>;
export const CreateCalculatedFieldDocument = gql`
    mutation CreateCalculatedField($data: CreateCalculatedFieldInput!) {
  createCalculatedField(data: $data)
}
    `;
export type CreateCalculatedFieldMutationFn = Apollo.MutationFunction<CreateCalculatedFieldMutation, CreateCalculatedFieldMutationVariables>;

/**
 * __useCreateCalculatedFieldMutation__
 *
 * To run a mutation, you first call `useCreateCalculatedFieldMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateCalculatedFieldMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createCalculatedFieldMutation, { data, loading, error }] = useCreateCalculatedFieldMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateCalculatedFieldMutation(baseOptions?: Apollo.MutationHookOptions<CreateCalculatedFieldMutation, CreateCalculatedFieldMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateCalculatedFieldMutation, CreateCalculatedFieldMutationVariables>(CreateCalculatedFieldDocument, options);
      }
export type CreateCalculatedFieldMutationHookResult = ReturnType<typeof useCreateCalculatedFieldMutation>;
export type CreateCalculatedFieldMutationResult = Apollo.MutationResult<CreateCalculatedFieldMutation>;
export type CreateCalculatedFieldMutationOptions = Apollo.BaseMutationOptions<CreateCalculatedFieldMutation, CreateCalculatedFieldMutationVariables>;
export const UpdateCalculatedFieldDocument = gql`
    mutation UpdateCalculatedField($where: UpdateCalculatedFieldWhere!, $data: UpdateCalculatedFieldInput!) {
  updateCalculatedField(where: $where, data: $data)
}
    `;
export type UpdateCalculatedFieldMutationFn = Apollo.MutationFunction<UpdateCalculatedFieldMutation, UpdateCalculatedFieldMutationVariables>;

/**
 * __useUpdateCalculatedFieldMutation__
 *
 * To run a mutation, you first call `useUpdateCalculatedFieldMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateCalculatedFieldMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateCalculatedFieldMutation, { data, loading, error }] = useUpdateCalculatedFieldMutation({
 *   variables: {
 *      where: // value for 'where'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateCalculatedFieldMutation(baseOptions?: Apollo.MutationHookOptions<UpdateCalculatedFieldMutation, UpdateCalculatedFieldMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateCalculatedFieldMutation, UpdateCalculatedFieldMutationVariables>(UpdateCalculatedFieldDocument, options);
      }
export type UpdateCalculatedFieldMutationHookResult = ReturnType<typeof useUpdateCalculatedFieldMutation>;
export type UpdateCalculatedFieldMutationResult = Apollo.MutationResult<UpdateCalculatedFieldMutation>;
export type UpdateCalculatedFieldMutationOptions = Apollo.BaseMutationOptions<UpdateCalculatedFieldMutation, UpdateCalculatedFieldMutationVariables>;
export const DeleteCalculatedFieldDocument = gql`
    mutation DeleteCalculatedField($where: UpdateCalculatedFieldWhere!) {
  deleteCalculatedField(where: $where)
}
    `;
export type DeleteCalculatedFieldMutationFn = Apollo.MutationFunction<DeleteCalculatedFieldMutation, DeleteCalculatedFieldMutationVariables>;

/**
 * __useDeleteCalculatedFieldMutation__
 *
 * To run a mutation, you first call `useDeleteCalculatedFieldMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteCalculatedFieldMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteCalculatedFieldMutation, { data, loading, error }] = useDeleteCalculatedFieldMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useDeleteCalculatedFieldMutation(baseOptions?: Apollo.MutationHookOptions<DeleteCalculatedFieldMutation, DeleteCalculatedFieldMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteCalculatedFieldMutation, DeleteCalculatedFieldMutationVariables>(DeleteCalculatedFieldDocument, options);
      }
export type DeleteCalculatedFieldMutationHookResult = ReturnType<typeof useDeleteCalculatedFieldMutation>;
export type DeleteCalculatedFieldMutationResult = Apollo.MutationResult<DeleteCalculatedFieldMutation>;
export type DeleteCalculatedFieldMutationOptions = Apollo.BaseMutationOptions<DeleteCalculatedFieldMutation, DeleteCalculatedFieldMutationVariables>;