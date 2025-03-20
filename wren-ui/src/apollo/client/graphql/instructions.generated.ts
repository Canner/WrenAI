import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type InstructionFragment = { __typename?: 'Instruction', id: number, projectId: number, instruction: string, questions: Array<string>, isDefault: boolean, createdAt: string, updatedAt: string };

export type InstructionsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type InstructionsQuery = { __typename?: 'Query', instructions: Array<{ __typename?: 'Instruction', id: number, projectId: number, instruction: string, questions: Array<string>, isDefault: boolean, createdAt: string, updatedAt: string } | null> };

export type CreateInstructionMutationVariables = Types.Exact<{
  data: Types.CreateInstructionInput;
}>;


export type CreateInstructionMutation = { __typename?: 'Mutation', createInstruction: { __typename?: 'Instruction', id: number, projectId: number, instruction: string, questions: Array<string>, isDefault: boolean, createdAt: string, updatedAt: string } };

export type UpdateInstructionMutationVariables = Types.Exact<{
  where: Types.InstructionWhereInput;
  data: Types.UpdateInstructionInput;
}>;


export type UpdateInstructionMutation = { __typename?: 'Mutation', updateInstruction: { __typename?: 'Instruction', id: number, projectId: number, instruction: string, questions: Array<string>, isDefault: boolean, createdAt: string, updatedAt: string } };

export type DeleteInstructionMutationVariables = Types.Exact<{
  where: Types.InstructionWhereInput;
}>;


export type DeleteInstructionMutation = { __typename?: 'Mutation', deleteInstruction: boolean };

export const InstructionFragmentDoc = gql`
    fragment Instruction on Instruction {
  id
  projectId
  instruction
  questions
  isDefault
  createdAt
  updatedAt
}
    `;
export const InstructionsDocument = gql`
    query Instructions {
  instructions {
    ...Instruction
  }
}
    ${InstructionFragmentDoc}`;

/**
 * __useInstructionsQuery__
 *
 * To run a query within a React component, call `useInstructionsQuery` and pass it any options that fit your needs.
 * When your component renders, `useInstructionsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useInstructionsQuery({
 *   variables: {
 *   },
 * });
 */
export function useInstructionsQuery(baseOptions?: Apollo.QueryHookOptions<InstructionsQuery, InstructionsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<InstructionsQuery, InstructionsQueryVariables>(InstructionsDocument, options);
      }
export function useInstructionsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<InstructionsQuery, InstructionsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<InstructionsQuery, InstructionsQueryVariables>(InstructionsDocument, options);
        }
export type InstructionsQueryHookResult = ReturnType<typeof useInstructionsQuery>;
export type InstructionsLazyQueryHookResult = ReturnType<typeof useInstructionsLazyQuery>;
export type InstructionsQueryResult = Apollo.QueryResult<InstructionsQuery, InstructionsQueryVariables>;
export const CreateInstructionDocument = gql`
    mutation CreateInstruction($data: CreateInstructionInput!) {
  createInstruction(data: $data) {
    ...Instruction
  }
}
    ${InstructionFragmentDoc}`;
export type CreateInstructionMutationFn = Apollo.MutationFunction<CreateInstructionMutation, CreateInstructionMutationVariables>;

/**
 * __useCreateInstructionMutation__
 *
 * To run a mutation, you first call `useCreateInstructionMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateInstructionMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createInstructionMutation, { data, loading, error }] = useCreateInstructionMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateInstructionMutation(baseOptions?: Apollo.MutationHookOptions<CreateInstructionMutation, CreateInstructionMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateInstructionMutation, CreateInstructionMutationVariables>(CreateInstructionDocument, options);
      }
export type CreateInstructionMutationHookResult = ReturnType<typeof useCreateInstructionMutation>;
export type CreateInstructionMutationResult = Apollo.MutationResult<CreateInstructionMutation>;
export type CreateInstructionMutationOptions = Apollo.BaseMutationOptions<CreateInstructionMutation, CreateInstructionMutationVariables>;
export const UpdateInstructionDocument = gql`
    mutation UpdateInstruction($where: InstructionWhereInput!, $data: UpdateInstructionInput!) {
  updateInstruction(where: $where, data: $data) {
    ...Instruction
  }
}
    ${InstructionFragmentDoc}`;
export type UpdateInstructionMutationFn = Apollo.MutationFunction<UpdateInstructionMutation, UpdateInstructionMutationVariables>;

/**
 * __useUpdateInstructionMutation__
 *
 * To run a mutation, you first call `useUpdateInstructionMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateInstructionMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateInstructionMutation, { data, loading, error }] = useUpdateInstructionMutation({
 *   variables: {
 *      where: // value for 'where'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateInstructionMutation(baseOptions?: Apollo.MutationHookOptions<UpdateInstructionMutation, UpdateInstructionMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateInstructionMutation, UpdateInstructionMutationVariables>(UpdateInstructionDocument, options);
      }
export type UpdateInstructionMutationHookResult = ReturnType<typeof useUpdateInstructionMutation>;
export type UpdateInstructionMutationResult = Apollo.MutationResult<UpdateInstructionMutation>;
export type UpdateInstructionMutationOptions = Apollo.BaseMutationOptions<UpdateInstructionMutation, UpdateInstructionMutationVariables>;
export const DeleteInstructionDocument = gql`
    mutation DeleteInstruction($where: InstructionWhereInput!) {
  deleteInstruction(where: $where)
}
    `;
export type DeleteInstructionMutationFn = Apollo.MutationFunction<DeleteInstructionMutation, DeleteInstructionMutationVariables>;

/**
 * __useDeleteInstructionMutation__
 *
 * To run a mutation, you first call `useDeleteInstructionMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteInstructionMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteInstructionMutation, { data, loading, error }] = useDeleteInstructionMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useDeleteInstructionMutation(baseOptions?: Apollo.MutationHookOptions<DeleteInstructionMutation, DeleteInstructionMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteInstructionMutation, DeleteInstructionMutationVariables>(DeleteInstructionDocument, options);
      }
export type DeleteInstructionMutationHookResult = ReturnType<typeof useDeleteInstructionMutation>;
export type DeleteInstructionMutationResult = Apollo.MutationResult<DeleteInstructionMutation>;
export type DeleteInstructionMutationOptions = Apollo.BaseMutationOptions<DeleteInstructionMutation, DeleteInstructionMutationVariables>;