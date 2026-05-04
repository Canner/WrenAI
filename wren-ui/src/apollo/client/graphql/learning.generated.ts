import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type LearningRecordQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type LearningRecordQuery = { __typename?: 'Query', learningRecord: { __typename?: 'LearningRecord', paths: Array<string> } };

export type SaveLearningRecordMutationVariables = Types.Exact<{
  data: Types.SaveLearningRecordInput;
}>;


export type SaveLearningRecordMutation = { __typename?: 'Mutation', saveLearningRecord: { __typename?: 'LearningRecord', paths: Array<string> } };


export const LearningRecordDocument = gql`
    query LearningRecord {
  learningRecord {
    paths
  }
}
    `;

/**
 * __useLearningRecordQuery__
 *
 * To run a query within a React component, call `useLearningRecordQuery` and pass it any options that fit your needs.
 * When your component renders, `useLearningRecordQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useLearningRecordQuery({
 *   variables: {
 *   },
 * });
 */
export function useLearningRecordQuery(baseOptions?: Apollo.QueryHookOptions<LearningRecordQuery, LearningRecordQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<LearningRecordQuery, LearningRecordQueryVariables>(LearningRecordDocument, options);
      }
export function useLearningRecordLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<LearningRecordQuery, LearningRecordQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<LearningRecordQuery, LearningRecordQueryVariables>(LearningRecordDocument, options);
        }
export type LearningRecordQueryHookResult = ReturnType<typeof useLearningRecordQuery>;
export type LearningRecordLazyQueryHookResult = ReturnType<typeof useLearningRecordLazyQuery>;
export type LearningRecordQueryResult = Apollo.QueryResult<LearningRecordQuery, LearningRecordQueryVariables>;
export const SaveLearningRecordDocument = gql`
    mutation SaveLearningRecord($data: SaveLearningRecordInput!) {
  saveLearningRecord(data: $data) {
    paths
  }
}
    `;
export type SaveLearningRecordMutationFn = Apollo.MutationFunction<SaveLearningRecordMutation, SaveLearningRecordMutationVariables>;

/**
 * __useSaveLearningRecordMutation__
 *
 * To run a mutation, you first call `useSaveLearningRecordMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useSaveLearningRecordMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [saveLearningRecordMutation, { data, loading, error }] = useSaveLearningRecordMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useSaveLearningRecordMutation(baseOptions?: Apollo.MutationHookOptions<SaveLearningRecordMutation, SaveLearningRecordMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<SaveLearningRecordMutation, SaveLearningRecordMutationVariables>(SaveLearningRecordDocument, options);
      }
export type SaveLearningRecordMutationHookResult = ReturnType<typeof useSaveLearningRecordMutation>;
export type SaveLearningRecordMutationResult = Apollo.MutationResult<SaveLearningRecordMutation>;
export type SaveLearningRecordMutationOptions = Apollo.BaseMutationOptions<SaveLearningRecordMutation, SaveLearningRecordMutationVariables>;