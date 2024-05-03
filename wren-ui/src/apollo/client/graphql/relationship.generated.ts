import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type CreateRelationshipMutationVariables = Types.Exact<{
  data: Types.RelationInput;
}>;


export type CreateRelationshipMutation = { __typename?: 'Mutation', createRelation: any };

export type UpdateRelationshipMutationVariables = Types.Exact<{
  where: Types.WhereIdInput;
  data: Types.UpdateRelationInput;
}>;


export type UpdateRelationshipMutation = { __typename?: 'Mutation', updateRelation: any };

export type DeleteRelationshipMutationVariables = Types.Exact<{
  where: Types.WhereIdInput;
}>;


export type DeleteRelationshipMutation = { __typename?: 'Mutation', deleteRelation: boolean };


export const CreateRelationshipDocument = gql`
    mutation CreateRelationship($data: RelationInput!) {
  createRelation(data: $data)
}
    `;
export type CreateRelationshipMutationFn = Apollo.MutationFunction<CreateRelationshipMutation, CreateRelationshipMutationVariables>;

/**
 * __useCreateRelationshipMutation__
 *
 * To run a mutation, you first call `useCreateRelationshipMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateRelationshipMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createRelationshipMutation, { data, loading, error }] = useCreateRelationshipMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateRelationshipMutation(baseOptions?: Apollo.MutationHookOptions<CreateRelationshipMutation, CreateRelationshipMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateRelationshipMutation, CreateRelationshipMutationVariables>(CreateRelationshipDocument, options);
      }
export type CreateRelationshipMutationHookResult = ReturnType<typeof useCreateRelationshipMutation>;
export type CreateRelationshipMutationResult = Apollo.MutationResult<CreateRelationshipMutation>;
export type CreateRelationshipMutationOptions = Apollo.BaseMutationOptions<CreateRelationshipMutation, CreateRelationshipMutationVariables>;
export const UpdateRelationshipDocument = gql`
    mutation UpdateRelationship($where: WhereIdInput!, $data: UpdateRelationInput!) {
  updateRelation(where: $where, data: $data)
}
    `;
export type UpdateRelationshipMutationFn = Apollo.MutationFunction<UpdateRelationshipMutation, UpdateRelationshipMutationVariables>;

/**
 * __useUpdateRelationshipMutation__
 *
 * To run a mutation, you first call `useUpdateRelationshipMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateRelationshipMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateRelationshipMutation, { data, loading, error }] = useUpdateRelationshipMutation({
 *   variables: {
 *      where: // value for 'where'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateRelationshipMutation(baseOptions?: Apollo.MutationHookOptions<UpdateRelationshipMutation, UpdateRelationshipMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateRelationshipMutation, UpdateRelationshipMutationVariables>(UpdateRelationshipDocument, options);
      }
export type UpdateRelationshipMutationHookResult = ReturnType<typeof useUpdateRelationshipMutation>;
export type UpdateRelationshipMutationResult = Apollo.MutationResult<UpdateRelationshipMutation>;
export type UpdateRelationshipMutationOptions = Apollo.BaseMutationOptions<UpdateRelationshipMutation, UpdateRelationshipMutationVariables>;
export const DeleteRelationshipDocument = gql`
    mutation DeleteRelationship($where: WhereIdInput!) {
  deleteRelation(where: $where)
}
    `;
export type DeleteRelationshipMutationFn = Apollo.MutationFunction<DeleteRelationshipMutation, DeleteRelationshipMutationVariables>;

/**
 * __useDeleteRelationshipMutation__
 *
 * To run a mutation, you first call `useDeleteRelationshipMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteRelationshipMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteRelationshipMutation, { data, loading, error }] = useDeleteRelationshipMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useDeleteRelationshipMutation(baseOptions?: Apollo.MutationHookOptions<DeleteRelationshipMutation, DeleteRelationshipMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteRelationshipMutation, DeleteRelationshipMutationVariables>(DeleteRelationshipDocument, options);
      }
export type DeleteRelationshipMutationHookResult = ReturnType<typeof useDeleteRelationshipMutation>;
export type DeleteRelationshipMutationResult = Apollo.MutationResult<DeleteRelationshipMutation>;
export type DeleteRelationshipMutationOptions = Apollo.BaseMutationOptions<DeleteRelationshipMutation, DeleteRelationshipMutationVariables>;