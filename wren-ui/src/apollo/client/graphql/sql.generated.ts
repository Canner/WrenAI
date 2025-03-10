import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type PreviewSqlMutationVariables = Types.Exact<{
  data: Types.PreviewSqlDataInput;
}>;


export type PreviewSqlMutation = { __typename?: 'Mutation', previewSql: any };

export type GenerateQuestionMutationVariables = Types.Exact<{
  data: Types.GenerateQuestionInput;
}>;


export type GenerateQuestionMutation = { __typename?: 'Mutation', generateQuestion: string };


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
export const GenerateQuestionDocument = gql`
    mutation GenerateQuestion($data: GenerateQuestionInput!) {
  generateQuestion(data: $data)
}
    `;
export type GenerateQuestionMutationFn = Apollo.MutationFunction<GenerateQuestionMutation, GenerateQuestionMutationVariables>;

/**
 * __useGenerateQuestionMutation__
 *
 * To run a mutation, you first call `useGenerateQuestionMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useGenerateQuestionMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [generateQuestionMutation, { data, loading, error }] = useGenerateQuestionMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useGenerateQuestionMutation(baseOptions?: Apollo.MutationHookOptions<GenerateQuestionMutation, GenerateQuestionMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<GenerateQuestionMutation, GenerateQuestionMutationVariables>(GenerateQuestionDocument, options);
      }
export type GenerateQuestionMutationHookResult = ReturnType<typeof useGenerateQuestionMutation>;
export type GenerateQuestionMutationResult = Apollo.MutationResult<GenerateQuestionMutation>;
export type GenerateQuestionMutationOptions = Apollo.BaseMutationOptions<GenerateQuestionMutation, GenerateQuestionMutationVariables>;