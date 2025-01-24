import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type CommonErrorFragment = { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null };

export type CommonBreakdownDetailFragment = { __typename?: 'ThreadResponseBreakdownDetail', queryId?: string | null, status: Types.AskingTaskStatus, description?: string | null, steps?: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }> | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null };

export type CommonAnswerDetailFragment = { __typename?: 'ThreadResponseAnswerDetail', queryId?: string | null, status?: Types.ThreadResponseAnswerStatus | null, content?: string | null, numRowsUsedInLLM?: number | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null };

export type CommonChartDetailFragment = { __typename?: 'ThreadResponseChartDetail', queryId?: string | null, status: Types.ChartTaskStatus, description?: string | null, chartType?: Types.ChartType | null, chartSchema?: any | null, adjustment?: boolean | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null };

export type CommonResponseFragment = { __typename?: 'ThreadResponse', id: number, threadId: number, question: string, sql: string, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null, breakdownDetail?: { __typename?: 'ThreadResponseBreakdownDetail', queryId?: string | null, status: Types.AskingTaskStatus, description?: string | null, steps?: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }> | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, answerDetail?: { __typename?: 'ThreadResponseAnswerDetail', queryId?: string | null, status?: Types.ThreadResponseAnswerStatus | null, content?: string | null, numRowsUsedInLLM?: number | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, chartDetail?: { __typename?: 'ThreadResponseChartDetail', queryId?: string | null, status: Types.ChartTaskStatus, description?: string | null, chartType?: Types.ChartType | null, chartSchema?: any | null, adjustment?: boolean | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null };

export type CommonRecommendedQuestionsTaskFragment = { __typename?: 'RecommendedQuestionsTask', status: Types.RecommendedQuestionsTaskStatus, questions: Array<{ __typename?: 'ResultQuestion', question: string, category: string, sql: string }>, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null };

export type SuggestedQuestionsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type SuggestedQuestionsQuery = { __typename?: 'Query', suggestedQuestions: { __typename?: 'SuggestedQuestionResponse', questions: Array<{ __typename?: 'SuggestedQuestion', label: string, question: string } | null> } };

export type AskingTaskQueryVariables = Types.Exact<{
  taskId: Types.Scalars['String'];
}>;


export type AskingTaskQuery = { __typename?: 'Query', askingTask: { __typename?: 'AskingTask', status: Types.AskingTaskStatus, type?: Types.AskingTaskType | null, intentReasoning?: string | null, candidates: Array<{ __typename?: 'ResultCandidate', sql: string, type: Types.ResultCandidateType, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null }>, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } };

export type ThreadsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type ThreadsQuery = { __typename?: 'Query', threads: Array<{ __typename?: 'Thread', id: number, summary: string }> };

export type ThreadQueryVariables = Types.Exact<{
  threadId: Types.Scalars['Int'];
}>;


export type ThreadQuery = { __typename?: 'Query', thread: { __typename?: 'DetailedThread', id: number, responses: Array<{ __typename?: 'ThreadResponse', id: number, threadId: number, question: string, sql: string, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null, breakdownDetail?: { __typename?: 'ThreadResponseBreakdownDetail', queryId?: string | null, status: Types.AskingTaskStatus, description?: string | null, steps?: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }> | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, answerDetail?: { __typename?: 'ThreadResponseAnswerDetail', queryId?: string | null, status?: Types.ThreadResponseAnswerStatus | null, content?: string | null, numRowsUsedInLLM?: number | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, chartDetail?: { __typename?: 'ThreadResponseChartDetail', queryId?: string | null, status: Types.ChartTaskStatus, description?: string | null, chartType?: Types.ChartType | null, chartSchema?: any | null, adjustment?: boolean | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null }> } };

export type ThreadResponseQueryVariables = Types.Exact<{
  responseId: Types.Scalars['Int'];
}>;


export type ThreadResponseQuery = { __typename?: 'Query', threadResponse: { __typename?: 'ThreadResponse', id: number, threadId: number, question: string, sql: string, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null, breakdownDetail?: { __typename?: 'ThreadResponseBreakdownDetail', queryId?: string | null, status: Types.AskingTaskStatus, description?: string | null, steps?: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }> | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, answerDetail?: { __typename?: 'ThreadResponseAnswerDetail', queryId?: string | null, status?: Types.ThreadResponseAnswerStatus | null, content?: string | null, numRowsUsedInLLM?: number | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, chartDetail?: { __typename?: 'ThreadResponseChartDetail', queryId?: string | null, status: Types.ChartTaskStatus, description?: string | null, chartType?: Types.ChartType | null, chartSchema?: any | null, adjustment?: boolean | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null } };

export type CreateAskingTaskMutationVariables = Types.Exact<{
  data: Types.AskingTaskInput;
}>;


export type CreateAskingTaskMutation = { __typename?: 'Mutation', createAskingTask: { __typename?: 'Task', id: string } };

export type CancelAskingTaskMutationVariables = Types.Exact<{
  taskId: Types.Scalars['String'];
}>;


export type CancelAskingTaskMutation = { __typename?: 'Mutation', cancelAskingTask: boolean };

export type CreateThreadMutationVariables = Types.Exact<{
  data: Types.CreateThreadInput;
}>;


export type CreateThreadMutation = { __typename?: 'Mutation', createThread: { __typename?: 'Thread', id: number } };

export type CreateThreadResponseMutationVariables = Types.Exact<{
  threadId: Types.Scalars['Int'];
  data: Types.CreateThreadResponseInput;
}>;


export type CreateThreadResponseMutation = { __typename?: 'Mutation', createThreadResponse: { __typename?: 'ThreadResponse', id: number, threadId: number, question: string, sql: string, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null, breakdownDetail?: { __typename?: 'ThreadResponseBreakdownDetail', queryId?: string | null, status: Types.AskingTaskStatus, description?: string | null, steps?: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }> | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, answerDetail?: { __typename?: 'ThreadResponseAnswerDetail', queryId?: string | null, status?: Types.ThreadResponseAnswerStatus | null, content?: string | null, numRowsUsedInLLM?: number | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, chartDetail?: { __typename?: 'ThreadResponseChartDetail', queryId?: string | null, status: Types.ChartTaskStatus, description?: string | null, chartType?: Types.ChartType | null, chartSchema?: any | null, adjustment?: boolean | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null } };

export type UpdateThreadMutationVariables = Types.Exact<{
  where: Types.ThreadUniqueWhereInput;
  data: Types.UpdateThreadInput;
}>;


export type UpdateThreadMutation = { __typename?: 'Mutation', updateThread: { __typename?: 'Thread', id: number, summary: string } };

export type DeleteThreadMutationVariables = Types.Exact<{
  where: Types.ThreadUniqueWhereInput;
}>;


export type DeleteThreadMutation = { __typename?: 'Mutation', deleteThread: boolean };

export type PreviewDataMutationVariables = Types.Exact<{
  where: Types.PreviewDataInput;
}>;


export type PreviewDataMutation = { __typename?: 'Mutation', previewData: any };

export type PreviewBreakdownDataMutationVariables = Types.Exact<{
  where: Types.PreviewDataInput;
}>;


export type PreviewBreakdownDataMutation = { __typename?: 'Mutation', previewBreakdownData: any };

export type GetNativeSqlQueryVariables = Types.Exact<{
  responseId: Types.Scalars['Int'];
}>;


export type GetNativeSqlQuery = { __typename?: 'Query', nativeSql: string };

export type CreateInstantRecommendedQuestionsMutationVariables = Types.Exact<{
  data: Types.InstantRecommendedQuestionsInput;
}>;


export type CreateInstantRecommendedQuestionsMutation = { __typename?: 'Mutation', createInstantRecommendedQuestions: { __typename?: 'Task', id: string } };

export type InstantRecommendedQuestionsQueryVariables = Types.Exact<{
  taskId: Types.Scalars['String'];
}>;


export type InstantRecommendedQuestionsQuery = { __typename?: 'Query', instantRecommendedQuestions: { __typename?: 'RecommendedQuestionsTask', status: Types.RecommendedQuestionsTaskStatus, questions: Array<{ __typename?: 'ResultQuestion', question: string, category: string, sql: string }>, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } };

export type GetThreadRecommendationQuestionsQueryVariables = Types.Exact<{
  threadId: Types.Scalars['Int'];
}>;


export type GetThreadRecommendationQuestionsQuery = { __typename?: 'Query', getThreadRecommendationQuestions: { __typename?: 'RecommendedQuestionsTask', status: Types.RecommendedQuestionsTaskStatus, questions: Array<{ __typename?: 'ResultQuestion', question: string, category: string, sql: string }>, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } };

export type GetProjectRecommendationQuestionsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type GetProjectRecommendationQuestionsQuery = { __typename?: 'Query', getProjectRecommendationQuestions: { __typename?: 'RecommendedQuestionsTask', status: Types.RecommendedQuestionsTaskStatus, questions: Array<{ __typename?: 'ResultQuestion', question: string, category: string, sql: string }>, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } };

export type GenerateProjectRecommendationQuestionsMutationVariables = Types.Exact<{ [key: string]: never; }>;


export type GenerateProjectRecommendationQuestionsMutation = { __typename?: 'Mutation', generateProjectRecommendationQuestions: boolean };

export type GenerateThreadRecommendationQuestionsMutationVariables = Types.Exact<{
  threadId: Types.Scalars['Int'];
}>;


export type GenerateThreadRecommendationQuestionsMutation = { __typename?: 'Mutation', generateThreadRecommendationQuestions: boolean };

export type GenerateThreadResponseBreakdownMutationVariables = Types.Exact<{
  responseId: Types.Scalars['Int'];
}>;


export type GenerateThreadResponseBreakdownMutation = { __typename?: 'Mutation', generateThreadResponseBreakdown: { __typename?: 'ThreadResponse', id: number, threadId: number, question: string, sql: string, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null, breakdownDetail?: { __typename?: 'ThreadResponseBreakdownDetail', queryId?: string | null, status: Types.AskingTaskStatus, description?: string | null, steps?: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }> | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, answerDetail?: { __typename?: 'ThreadResponseAnswerDetail', queryId?: string | null, status?: Types.ThreadResponseAnswerStatus | null, content?: string | null, numRowsUsedInLLM?: number | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, chartDetail?: { __typename?: 'ThreadResponseChartDetail', queryId?: string | null, status: Types.ChartTaskStatus, description?: string | null, chartType?: Types.ChartType | null, chartSchema?: any | null, adjustment?: boolean | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null } };

export type GenerateThreadResponseAnswerMutationVariables = Types.Exact<{
  responseId: Types.Scalars['Int'];
}>;


export type GenerateThreadResponseAnswerMutation = { __typename?: 'Mutation', generateThreadResponseAnswer: { __typename?: 'ThreadResponse', id: number, threadId: number, question: string, sql: string, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null, breakdownDetail?: { __typename?: 'ThreadResponseBreakdownDetail', queryId?: string | null, status: Types.AskingTaskStatus, description?: string | null, steps?: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }> | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, answerDetail?: { __typename?: 'ThreadResponseAnswerDetail', queryId?: string | null, status?: Types.ThreadResponseAnswerStatus | null, content?: string | null, numRowsUsedInLLM?: number | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, chartDetail?: { __typename?: 'ThreadResponseChartDetail', queryId?: string | null, status: Types.ChartTaskStatus, description?: string | null, chartType?: Types.ChartType | null, chartSchema?: any | null, adjustment?: boolean | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null } };

export type GenerateThreadResponseChartMutationVariables = Types.Exact<{
  responseId: Types.Scalars['Int'];
}>;


export type GenerateThreadResponseChartMutation = { __typename?: 'Mutation', generateThreadResponseChart: { __typename?: 'ThreadResponse', id: number, threadId: number, question: string, sql: string, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null, breakdownDetail?: { __typename?: 'ThreadResponseBreakdownDetail', queryId?: string | null, status: Types.AskingTaskStatus, description?: string | null, steps?: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }> | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, answerDetail?: { __typename?: 'ThreadResponseAnswerDetail', queryId?: string | null, status?: Types.ThreadResponseAnswerStatus | null, content?: string | null, numRowsUsedInLLM?: number | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, chartDetail?: { __typename?: 'ThreadResponseChartDetail', queryId?: string | null, status: Types.ChartTaskStatus, description?: string | null, chartType?: Types.ChartType | null, chartSchema?: any | null, adjustment?: boolean | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null } };

export type AdjustThreadResponseChartMutationVariables = Types.Exact<{
  responseId: Types.Scalars['Int'];
  data: Types.AdjustThreadResponseChartInput;
}>;


export type AdjustThreadResponseChartMutation = { __typename?: 'Mutation', adjustThreadResponseChart: { __typename?: 'ThreadResponse', id: number, threadId: number, question: string, sql: string, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null, breakdownDetail?: { __typename?: 'ThreadResponseBreakdownDetail', queryId?: string | null, status: Types.AskingTaskStatus, description?: string | null, steps?: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }> | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, answerDetail?: { __typename?: 'ThreadResponseAnswerDetail', queryId?: string | null, status?: Types.ThreadResponseAnswerStatus | null, content?: string | null, numRowsUsedInLLM?: number | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null, chartDetail?: { __typename?: 'ThreadResponseChartDetail', queryId?: string | null, status: Types.ChartTaskStatus, description?: string | null, chartType?: Types.ChartType | null, chartSchema?: any | null, adjustment?: boolean | null, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } | null } };

export const CommonErrorFragmentDoc = gql`
    fragment CommonError on Error {
  code
  shortMessage
  message
  stacktrace
}
    `;
export const CommonBreakdownDetailFragmentDoc = gql`
    fragment CommonBreakdownDetail on ThreadResponseBreakdownDetail {
  queryId
  status
  description
  steps {
    summary
    sql
    cteName
  }
  error {
    ...CommonError
  }
}
    ${CommonErrorFragmentDoc}`;
export const CommonAnswerDetailFragmentDoc = gql`
    fragment CommonAnswerDetail on ThreadResponseAnswerDetail {
  queryId
  status
  content
  numRowsUsedInLLM
  error {
    ...CommonError
  }
}
    ${CommonErrorFragmentDoc}`;
export const CommonChartDetailFragmentDoc = gql`
    fragment CommonChartDetail on ThreadResponseChartDetail {
  queryId
  status
  description
  chartType
  chartSchema
  error {
    ...CommonError
  }
  adjustment
}
    ${CommonErrorFragmentDoc}`;
export const CommonResponseFragmentDoc = gql`
    fragment CommonResponse on ThreadResponse {
  id
  threadId
  question
  sql
  view {
    id
    name
    statement
    displayName
  }
  breakdownDetail {
    ...CommonBreakdownDetail
  }
  answerDetail {
    ...CommonAnswerDetail
  }
  chartDetail {
    ...CommonChartDetail
  }
}
    ${CommonBreakdownDetailFragmentDoc}
${CommonAnswerDetailFragmentDoc}
${CommonChartDetailFragmentDoc}`;
export const CommonRecommendedQuestionsTaskFragmentDoc = gql`
    fragment CommonRecommendedQuestionsTask on RecommendedQuestionsTask {
  status
  questions {
    question
    category
    sql
  }
  error {
    ...CommonError
  }
}
    ${CommonErrorFragmentDoc}`;
export const SuggestedQuestionsDocument = gql`
    query SuggestedQuestions {
  suggestedQuestions {
    questions {
      label
      question
    }
  }
}
    `;

/**
 * __useSuggestedQuestionsQuery__
 *
 * To run a query within a React component, call `useSuggestedQuestionsQuery` and pass it any options that fit your needs.
 * When your component renders, `useSuggestedQuestionsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useSuggestedQuestionsQuery({
 *   variables: {
 *   },
 * });
 */
export function useSuggestedQuestionsQuery(baseOptions?: Apollo.QueryHookOptions<SuggestedQuestionsQuery, SuggestedQuestionsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<SuggestedQuestionsQuery, SuggestedQuestionsQueryVariables>(SuggestedQuestionsDocument, options);
      }
export function useSuggestedQuestionsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<SuggestedQuestionsQuery, SuggestedQuestionsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<SuggestedQuestionsQuery, SuggestedQuestionsQueryVariables>(SuggestedQuestionsDocument, options);
        }
export type SuggestedQuestionsQueryHookResult = ReturnType<typeof useSuggestedQuestionsQuery>;
export type SuggestedQuestionsLazyQueryHookResult = ReturnType<typeof useSuggestedQuestionsLazyQuery>;
export type SuggestedQuestionsQueryResult = Apollo.QueryResult<SuggestedQuestionsQuery, SuggestedQuestionsQueryVariables>;
export const AskingTaskDocument = gql`
    query AskingTask($taskId: String!) {
  askingTask(taskId: $taskId) {
    status
    type
    candidates {
      sql
      type
      view {
        id
        name
        statement
        displayName
      }
    }
    error {
      ...CommonError
    }
    intentReasoning
  }
}
    ${CommonErrorFragmentDoc}`;

/**
 * __useAskingTaskQuery__
 *
 * To run a query within a React component, call `useAskingTaskQuery` and pass it any options that fit your needs.
 * When your component renders, `useAskingTaskQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useAskingTaskQuery({
 *   variables: {
 *      taskId: // value for 'taskId'
 *   },
 * });
 */
export function useAskingTaskQuery(baseOptions: Apollo.QueryHookOptions<AskingTaskQuery, AskingTaskQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<AskingTaskQuery, AskingTaskQueryVariables>(AskingTaskDocument, options);
      }
export function useAskingTaskLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<AskingTaskQuery, AskingTaskQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<AskingTaskQuery, AskingTaskQueryVariables>(AskingTaskDocument, options);
        }
export type AskingTaskQueryHookResult = ReturnType<typeof useAskingTaskQuery>;
export type AskingTaskLazyQueryHookResult = ReturnType<typeof useAskingTaskLazyQuery>;
export type AskingTaskQueryResult = Apollo.QueryResult<AskingTaskQuery, AskingTaskQueryVariables>;
export const ThreadsDocument = gql`
    query Threads {
  threads {
    id
    summary
  }
}
    `;

/**
 * __useThreadsQuery__
 *
 * To run a query within a React component, call `useThreadsQuery` and pass it any options that fit your needs.
 * When your component renders, `useThreadsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useThreadsQuery({
 *   variables: {
 *   },
 * });
 */
export function useThreadsQuery(baseOptions?: Apollo.QueryHookOptions<ThreadsQuery, ThreadsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<ThreadsQuery, ThreadsQueryVariables>(ThreadsDocument, options);
      }
export function useThreadsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<ThreadsQuery, ThreadsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<ThreadsQuery, ThreadsQueryVariables>(ThreadsDocument, options);
        }
export type ThreadsQueryHookResult = ReturnType<typeof useThreadsQuery>;
export type ThreadsLazyQueryHookResult = ReturnType<typeof useThreadsLazyQuery>;
export type ThreadsQueryResult = Apollo.QueryResult<ThreadsQuery, ThreadsQueryVariables>;
export const ThreadDocument = gql`
    query Thread($threadId: Int!) {
  thread(threadId: $threadId) {
    id
    responses {
      ...CommonResponse
    }
  }
}
    ${CommonResponseFragmentDoc}`;

/**
 * __useThreadQuery__
 *
 * To run a query within a React component, call `useThreadQuery` and pass it any options that fit your needs.
 * When your component renders, `useThreadQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useThreadQuery({
 *   variables: {
 *      threadId: // value for 'threadId'
 *   },
 * });
 */
export function useThreadQuery(baseOptions: Apollo.QueryHookOptions<ThreadQuery, ThreadQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<ThreadQuery, ThreadQueryVariables>(ThreadDocument, options);
      }
export function useThreadLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<ThreadQuery, ThreadQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<ThreadQuery, ThreadQueryVariables>(ThreadDocument, options);
        }
export type ThreadQueryHookResult = ReturnType<typeof useThreadQuery>;
export type ThreadLazyQueryHookResult = ReturnType<typeof useThreadLazyQuery>;
export type ThreadQueryResult = Apollo.QueryResult<ThreadQuery, ThreadQueryVariables>;
export const ThreadResponseDocument = gql`
    query ThreadResponse($responseId: Int!) {
  threadResponse(responseId: $responseId) {
    ...CommonResponse
  }
}
    ${CommonResponseFragmentDoc}`;

/**
 * __useThreadResponseQuery__
 *
 * To run a query within a React component, call `useThreadResponseQuery` and pass it any options that fit your needs.
 * When your component renders, `useThreadResponseQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useThreadResponseQuery({
 *   variables: {
 *      responseId: // value for 'responseId'
 *   },
 * });
 */
export function useThreadResponseQuery(baseOptions: Apollo.QueryHookOptions<ThreadResponseQuery, ThreadResponseQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<ThreadResponseQuery, ThreadResponseQueryVariables>(ThreadResponseDocument, options);
      }
export function useThreadResponseLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<ThreadResponseQuery, ThreadResponseQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<ThreadResponseQuery, ThreadResponseQueryVariables>(ThreadResponseDocument, options);
        }
export type ThreadResponseQueryHookResult = ReturnType<typeof useThreadResponseQuery>;
export type ThreadResponseLazyQueryHookResult = ReturnType<typeof useThreadResponseLazyQuery>;
export type ThreadResponseQueryResult = Apollo.QueryResult<ThreadResponseQuery, ThreadResponseQueryVariables>;
export const CreateAskingTaskDocument = gql`
    mutation CreateAskingTask($data: AskingTaskInput!) {
  createAskingTask(data: $data) {
    id
  }
}
    `;
export type CreateAskingTaskMutationFn = Apollo.MutationFunction<CreateAskingTaskMutation, CreateAskingTaskMutationVariables>;

/**
 * __useCreateAskingTaskMutation__
 *
 * To run a mutation, you first call `useCreateAskingTaskMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateAskingTaskMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createAskingTaskMutation, { data, loading, error }] = useCreateAskingTaskMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateAskingTaskMutation(baseOptions?: Apollo.MutationHookOptions<CreateAskingTaskMutation, CreateAskingTaskMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateAskingTaskMutation, CreateAskingTaskMutationVariables>(CreateAskingTaskDocument, options);
      }
export type CreateAskingTaskMutationHookResult = ReturnType<typeof useCreateAskingTaskMutation>;
export type CreateAskingTaskMutationResult = Apollo.MutationResult<CreateAskingTaskMutation>;
export type CreateAskingTaskMutationOptions = Apollo.BaseMutationOptions<CreateAskingTaskMutation, CreateAskingTaskMutationVariables>;
export const CancelAskingTaskDocument = gql`
    mutation CancelAskingTask($taskId: String!) {
  cancelAskingTask(taskId: $taskId)
}
    `;
export type CancelAskingTaskMutationFn = Apollo.MutationFunction<CancelAskingTaskMutation, CancelAskingTaskMutationVariables>;

/**
 * __useCancelAskingTaskMutation__
 *
 * To run a mutation, you first call `useCancelAskingTaskMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCancelAskingTaskMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [cancelAskingTaskMutation, { data, loading, error }] = useCancelAskingTaskMutation({
 *   variables: {
 *      taskId: // value for 'taskId'
 *   },
 * });
 */
export function useCancelAskingTaskMutation(baseOptions?: Apollo.MutationHookOptions<CancelAskingTaskMutation, CancelAskingTaskMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CancelAskingTaskMutation, CancelAskingTaskMutationVariables>(CancelAskingTaskDocument, options);
      }
export type CancelAskingTaskMutationHookResult = ReturnType<typeof useCancelAskingTaskMutation>;
export type CancelAskingTaskMutationResult = Apollo.MutationResult<CancelAskingTaskMutation>;
export type CancelAskingTaskMutationOptions = Apollo.BaseMutationOptions<CancelAskingTaskMutation, CancelAskingTaskMutationVariables>;
export const CreateThreadDocument = gql`
    mutation CreateThread($data: CreateThreadInput!) {
  createThread(data: $data) {
    id
  }
}
    `;
export type CreateThreadMutationFn = Apollo.MutationFunction<CreateThreadMutation, CreateThreadMutationVariables>;

/**
 * __useCreateThreadMutation__
 *
 * To run a mutation, you first call `useCreateThreadMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateThreadMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createThreadMutation, { data, loading, error }] = useCreateThreadMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateThreadMutation(baseOptions?: Apollo.MutationHookOptions<CreateThreadMutation, CreateThreadMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateThreadMutation, CreateThreadMutationVariables>(CreateThreadDocument, options);
      }
export type CreateThreadMutationHookResult = ReturnType<typeof useCreateThreadMutation>;
export type CreateThreadMutationResult = Apollo.MutationResult<CreateThreadMutation>;
export type CreateThreadMutationOptions = Apollo.BaseMutationOptions<CreateThreadMutation, CreateThreadMutationVariables>;
export const CreateThreadResponseDocument = gql`
    mutation CreateThreadResponse($threadId: Int!, $data: CreateThreadResponseInput!) {
  createThreadResponse(threadId: $threadId, data: $data) {
    ...CommonResponse
  }
}
    ${CommonResponseFragmentDoc}`;
export type CreateThreadResponseMutationFn = Apollo.MutationFunction<CreateThreadResponseMutation, CreateThreadResponseMutationVariables>;

/**
 * __useCreateThreadResponseMutation__
 *
 * To run a mutation, you first call `useCreateThreadResponseMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateThreadResponseMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createThreadResponseMutation, { data, loading, error }] = useCreateThreadResponseMutation({
 *   variables: {
 *      threadId: // value for 'threadId'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateThreadResponseMutation(baseOptions?: Apollo.MutationHookOptions<CreateThreadResponseMutation, CreateThreadResponseMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateThreadResponseMutation, CreateThreadResponseMutationVariables>(CreateThreadResponseDocument, options);
      }
export type CreateThreadResponseMutationHookResult = ReturnType<typeof useCreateThreadResponseMutation>;
export type CreateThreadResponseMutationResult = Apollo.MutationResult<CreateThreadResponseMutation>;
export type CreateThreadResponseMutationOptions = Apollo.BaseMutationOptions<CreateThreadResponseMutation, CreateThreadResponseMutationVariables>;
export const UpdateThreadDocument = gql`
    mutation UpdateThread($where: ThreadUniqueWhereInput!, $data: UpdateThreadInput!) {
  updateThread(where: $where, data: $data) {
    id
    summary
  }
}
    `;
export type UpdateThreadMutationFn = Apollo.MutationFunction<UpdateThreadMutation, UpdateThreadMutationVariables>;

/**
 * __useUpdateThreadMutation__
 *
 * To run a mutation, you first call `useUpdateThreadMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateThreadMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateThreadMutation, { data, loading, error }] = useUpdateThreadMutation({
 *   variables: {
 *      where: // value for 'where'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateThreadMutation(baseOptions?: Apollo.MutationHookOptions<UpdateThreadMutation, UpdateThreadMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateThreadMutation, UpdateThreadMutationVariables>(UpdateThreadDocument, options);
      }
export type UpdateThreadMutationHookResult = ReturnType<typeof useUpdateThreadMutation>;
export type UpdateThreadMutationResult = Apollo.MutationResult<UpdateThreadMutation>;
export type UpdateThreadMutationOptions = Apollo.BaseMutationOptions<UpdateThreadMutation, UpdateThreadMutationVariables>;
export const DeleteThreadDocument = gql`
    mutation DeleteThread($where: ThreadUniqueWhereInput!) {
  deleteThread(where: $where)
}
    `;
export type DeleteThreadMutationFn = Apollo.MutationFunction<DeleteThreadMutation, DeleteThreadMutationVariables>;

/**
 * __useDeleteThreadMutation__
 *
 * To run a mutation, you first call `useDeleteThreadMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteThreadMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteThreadMutation, { data, loading, error }] = useDeleteThreadMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useDeleteThreadMutation(baseOptions?: Apollo.MutationHookOptions<DeleteThreadMutation, DeleteThreadMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteThreadMutation, DeleteThreadMutationVariables>(DeleteThreadDocument, options);
      }
export type DeleteThreadMutationHookResult = ReturnType<typeof useDeleteThreadMutation>;
export type DeleteThreadMutationResult = Apollo.MutationResult<DeleteThreadMutation>;
export type DeleteThreadMutationOptions = Apollo.BaseMutationOptions<DeleteThreadMutation, DeleteThreadMutationVariables>;
export const PreviewDataDocument = gql`
    mutation PreviewData($where: PreviewDataInput!) {
  previewData(where: $where)
}
    `;
export type PreviewDataMutationFn = Apollo.MutationFunction<PreviewDataMutation, PreviewDataMutationVariables>;

/**
 * __usePreviewDataMutation__
 *
 * To run a mutation, you first call `usePreviewDataMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `usePreviewDataMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [previewDataMutation, { data, loading, error }] = usePreviewDataMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function usePreviewDataMutation(baseOptions?: Apollo.MutationHookOptions<PreviewDataMutation, PreviewDataMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<PreviewDataMutation, PreviewDataMutationVariables>(PreviewDataDocument, options);
      }
export type PreviewDataMutationHookResult = ReturnType<typeof usePreviewDataMutation>;
export type PreviewDataMutationResult = Apollo.MutationResult<PreviewDataMutation>;
export type PreviewDataMutationOptions = Apollo.BaseMutationOptions<PreviewDataMutation, PreviewDataMutationVariables>;
export const PreviewBreakdownDataDocument = gql`
    mutation PreviewBreakdownData($where: PreviewDataInput!) {
  previewBreakdownData(where: $where)
}
    `;
export type PreviewBreakdownDataMutationFn = Apollo.MutationFunction<PreviewBreakdownDataMutation, PreviewBreakdownDataMutationVariables>;

/**
 * __usePreviewBreakdownDataMutation__
 *
 * To run a mutation, you first call `usePreviewBreakdownDataMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `usePreviewBreakdownDataMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [previewBreakdownDataMutation, { data, loading, error }] = usePreviewBreakdownDataMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function usePreviewBreakdownDataMutation(baseOptions?: Apollo.MutationHookOptions<PreviewBreakdownDataMutation, PreviewBreakdownDataMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<PreviewBreakdownDataMutation, PreviewBreakdownDataMutationVariables>(PreviewBreakdownDataDocument, options);
      }
export type PreviewBreakdownDataMutationHookResult = ReturnType<typeof usePreviewBreakdownDataMutation>;
export type PreviewBreakdownDataMutationResult = Apollo.MutationResult<PreviewBreakdownDataMutation>;
export type PreviewBreakdownDataMutationOptions = Apollo.BaseMutationOptions<PreviewBreakdownDataMutation, PreviewBreakdownDataMutationVariables>;
export const GetNativeSqlDocument = gql`
    query GetNativeSQL($responseId: Int!) {
  nativeSql(responseId: $responseId)
}
    `;

/**
 * __useGetNativeSqlQuery__
 *
 * To run a query within a React component, call `useGetNativeSqlQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetNativeSqlQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetNativeSqlQuery({
 *   variables: {
 *      responseId: // value for 'responseId'
 *   },
 * });
 */
export function useGetNativeSqlQuery(baseOptions: Apollo.QueryHookOptions<GetNativeSqlQuery, GetNativeSqlQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GetNativeSqlQuery, GetNativeSqlQueryVariables>(GetNativeSqlDocument, options);
      }
export function useGetNativeSqlLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GetNativeSqlQuery, GetNativeSqlQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GetNativeSqlQuery, GetNativeSqlQueryVariables>(GetNativeSqlDocument, options);
        }
export type GetNativeSqlQueryHookResult = ReturnType<typeof useGetNativeSqlQuery>;
export type GetNativeSqlLazyQueryHookResult = ReturnType<typeof useGetNativeSqlLazyQuery>;
export type GetNativeSqlQueryResult = Apollo.QueryResult<GetNativeSqlQuery, GetNativeSqlQueryVariables>;
export const CreateInstantRecommendedQuestionsDocument = gql`
    mutation CreateInstantRecommendedQuestions($data: InstantRecommendedQuestionsInput!) {
  createInstantRecommendedQuestions(data: $data) {
    id
  }
}
    `;
export type CreateInstantRecommendedQuestionsMutationFn = Apollo.MutationFunction<CreateInstantRecommendedQuestionsMutation, CreateInstantRecommendedQuestionsMutationVariables>;

/**
 * __useCreateInstantRecommendedQuestionsMutation__
 *
 * To run a mutation, you first call `useCreateInstantRecommendedQuestionsMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateInstantRecommendedQuestionsMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createInstantRecommendedQuestionsMutation, { data, loading, error }] = useCreateInstantRecommendedQuestionsMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateInstantRecommendedQuestionsMutation(baseOptions?: Apollo.MutationHookOptions<CreateInstantRecommendedQuestionsMutation, CreateInstantRecommendedQuestionsMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateInstantRecommendedQuestionsMutation, CreateInstantRecommendedQuestionsMutationVariables>(CreateInstantRecommendedQuestionsDocument, options);
      }
export type CreateInstantRecommendedQuestionsMutationHookResult = ReturnType<typeof useCreateInstantRecommendedQuestionsMutation>;
export type CreateInstantRecommendedQuestionsMutationResult = Apollo.MutationResult<CreateInstantRecommendedQuestionsMutation>;
export type CreateInstantRecommendedQuestionsMutationOptions = Apollo.BaseMutationOptions<CreateInstantRecommendedQuestionsMutation, CreateInstantRecommendedQuestionsMutationVariables>;
export const InstantRecommendedQuestionsDocument = gql`
    query InstantRecommendedQuestions($taskId: String!) {
  instantRecommendedQuestions(taskId: $taskId) {
    ...CommonRecommendedQuestionsTask
  }
}
    ${CommonRecommendedQuestionsTaskFragmentDoc}`;

/**
 * __useInstantRecommendedQuestionsQuery__
 *
 * To run a query within a React component, call `useInstantRecommendedQuestionsQuery` and pass it any options that fit your needs.
 * When your component renders, `useInstantRecommendedQuestionsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useInstantRecommendedQuestionsQuery({
 *   variables: {
 *      taskId: // value for 'taskId'
 *   },
 * });
 */
export function useInstantRecommendedQuestionsQuery(baseOptions: Apollo.QueryHookOptions<InstantRecommendedQuestionsQuery, InstantRecommendedQuestionsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<InstantRecommendedQuestionsQuery, InstantRecommendedQuestionsQueryVariables>(InstantRecommendedQuestionsDocument, options);
      }
export function useInstantRecommendedQuestionsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<InstantRecommendedQuestionsQuery, InstantRecommendedQuestionsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<InstantRecommendedQuestionsQuery, InstantRecommendedQuestionsQueryVariables>(InstantRecommendedQuestionsDocument, options);
        }
export type InstantRecommendedQuestionsQueryHookResult = ReturnType<typeof useInstantRecommendedQuestionsQuery>;
export type InstantRecommendedQuestionsLazyQueryHookResult = ReturnType<typeof useInstantRecommendedQuestionsLazyQuery>;
export type InstantRecommendedQuestionsQueryResult = Apollo.QueryResult<InstantRecommendedQuestionsQuery, InstantRecommendedQuestionsQueryVariables>;
export const GetThreadRecommendationQuestionsDocument = gql`
    query GetThreadRecommendationQuestions($threadId: Int!) {
  getThreadRecommendationQuestions(threadId: $threadId) {
    ...CommonRecommendedQuestionsTask
  }
}
    ${CommonRecommendedQuestionsTaskFragmentDoc}`;

/**
 * __useGetThreadRecommendationQuestionsQuery__
 *
 * To run a query within a React component, call `useGetThreadRecommendationQuestionsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetThreadRecommendationQuestionsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetThreadRecommendationQuestionsQuery({
 *   variables: {
 *      threadId: // value for 'threadId'
 *   },
 * });
 */
export function useGetThreadRecommendationQuestionsQuery(baseOptions: Apollo.QueryHookOptions<GetThreadRecommendationQuestionsQuery, GetThreadRecommendationQuestionsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GetThreadRecommendationQuestionsQuery, GetThreadRecommendationQuestionsQueryVariables>(GetThreadRecommendationQuestionsDocument, options);
      }
export function useGetThreadRecommendationQuestionsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GetThreadRecommendationQuestionsQuery, GetThreadRecommendationQuestionsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GetThreadRecommendationQuestionsQuery, GetThreadRecommendationQuestionsQueryVariables>(GetThreadRecommendationQuestionsDocument, options);
        }
export type GetThreadRecommendationQuestionsQueryHookResult = ReturnType<typeof useGetThreadRecommendationQuestionsQuery>;
export type GetThreadRecommendationQuestionsLazyQueryHookResult = ReturnType<typeof useGetThreadRecommendationQuestionsLazyQuery>;
export type GetThreadRecommendationQuestionsQueryResult = Apollo.QueryResult<GetThreadRecommendationQuestionsQuery, GetThreadRecommendationQuestionsQueryVariables>;
export const GetProjectRecommendationQuestionsDocument = gql`
    query GetProjectRecommendationQuestions {
  getProjectRecommendationQuestions {
    ...CommonRecommendedQuestionsTask
  }
}
    ${CommonRecommendedQuestionsTaskFragmentDoc}`;

/**
 * __useGetProjectRecommendationQuestionsQuery__
 *
 * To run a query within a React component, call `useGetProjectRecommendationQuestionsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetProjectRecommendationQuestionsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetProjectRecommendationQuestionsQuery({
 *   variables: {
 *   },
 * });
 */
export function useGetProjectRecommendationQuestionsQuery(baseOptions?: Apollo.QueryHookOptions<GetProjectRecommendationQuestionsQuery, GetProjectRecommendationQuestionsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GetProjectRecommendationQuestionsQuery, GetProjectRecommendationQuestionsQueryVariables>(GetProjectRecommendationQuestionsDocument, options);
      }
export function useGetProjectRecommendationQuestionsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GetProjectRecommendationQuestionsQuery, GetProjectRecommendationQuestionsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GetProjectRecommendationQuestionsQuery, GetProjectRecommendationQuestionsQueryVariables>(GetProjectRecommendationQuestionsDocument, options);
        }
export type GetProjectRecommendationQuestionsQueryHookResult = ReturnType<typeof useGetProjectRecommendationQuestionsQuery>;
export type GetProjectRecommendationQuestionsLazyQueryHookResult = ReturnType<typeof useGetProjectRecommendationQuestionsLazyQuery>;
export type GetProjectRecommendationQuestionsQueryResult = Apollo.QueryResult<GetProjectRecommendationQuestionsQuery, GetProjectRecommendationQuestionsQueryVariables>;
export const GenerateProjectRecommendationQuestionsDocument = gql`
    mutation GenerateProjectRecommendationQuestions {
  generateProjectRecommendationQuestions
}
    `;
export type GenerateProjectRecommendationQuestionsMutationFn = Apollo.MutationFunction<GenerateProjectRecommendationQuestionsMutation, GenerateProjectRecommendationQuestionsMutationVariables>;

/**
 * __useGenerateProjectRecommendationQuestionsMutation__
 *
 * To run a mutation, you first call `useGenerateProjectRecommendationQuestionsMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useGenerateProjectRecommendationQuestionsMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [generateProjectRecommendationQuestionsMutation, { data, loading, error }] = useGenerateProjectRecommendationQuestionsMutation({
 *   variables: {
 *   },
 * });
 */
export function useGenerateProjectRecommendationQuestionsMutation(baseOptions?: Apollo.MutationHookOptions<GenerateProjectRecommendationQuestionsMutation, GenerateProjectRecommendationQuestionsMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<GenerateProjectRecommendationQuestionsMutation, GenerateProjectRecommendationQuestionsMutationVariables>(GenerateProjectRecommendationQuestionsDocument, options);
      }
export type GenerateProjectRecommendationQuestionsMutationHookResult = ReturnType<typeof useGenerateProjectRecommendationQuestionsMutation>;
export type GenerateProjectRecommendationQuestionsMutationResult = Apollo.MutationResult<GenerateProjectRecommendationQuestionsMutation>;
export type GenerateProjectRecommendationQuestionsMutationOptions = Apollo.BaseMutationOptions<GenerateProjectRecommendationQuestionsMutation, GenerateProjectRecommendationQuestionsMutationVariables>;
export const GenerateThreadRecommendationQuestionsDocument = gql`
    mutation GenerateThreadRecommendationQuestions($threadId: Int!) {
  generateThreadRecommendationQuestions(threadId: $threadId)
}
    `;
export type GenerateThreadRecommendationQuestionsMutationFn = Apollo.MutationFunction<GenerateThreadRecommendationQuestionsMutation, GenerateThreadRecommendationQuestionsMutationVariables>;

/**
 * __useGenerateThreadRecommendationQuestionsMutation__
 *
 * To run a mutation, you first call `useGenerateThreadRecommendationQuestionsMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useGenerateThreadRecommendationQuestionsMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [generateThreadRecommendationQuestionsMutation, { data, loading, error }] = useGenerateThreadRecommendationQuestionsMutation({
 *   variables: {
 *      threadId: // value for 'threadId'
 *   },
 * });
 */
export function useGenerateThreadRecommendationQuestionsMutation(baseOptions?: Apollo.MutationHookOptions<GenerateThreadRecommendationQuestionsMutation, GenerateThreadRecommendationQuestionsMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<GenerateThreadRecommendationQuestionsMutation, GenerateThreadRecommendationQuestionsMutationVariables>(GenerateThreadRecommendationQuestionsDocument, options);
      }
export type GenerateThreadRecommendationQuestionsMutationHookResult = ReturnType<typeof useGenerateThreadRecommendationQuestionsMutation>;
export type GenerateThreadRecommendationQuestionsMutationResult = Apollo.MutationResult<GenerateThreadRecommendationQuestionsMutation>;
export type GenerateThreadRecommendationQuestionsMutationOptions = Apollo.BaseMutationOptions<GenerateThreadRecommendationQuestionsMutation, GenerateThreadRecommendationQuestionsMutationVariables>;
export const GenerateThreadResponseBreakdownDocument = gql`
    mutation GenerateThreadResponseBreakdown($responseId: Int!) {
  generateThreadResponseBreakdown(responseId: $responseId) {
    ...CommonResponse
  }
}
    ${CommonResponseFragmentDoc}`;
export type GenerateThreadResponseBreakdownMutationFn = Apollo.MutationFunction<GenerateThreadResponseBreakdownMutation, GenerateThreadResponseBreakdownMutationVariables>;

/**
 * __useGenerateThreadResponseBreakdownMutation__
 *
 * To run a mutation, you first call `useGenerateThreadResponseBreakdownMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useGenerateThreadResponseBreakdownMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [generateThreadResponseBreakdownMutation, { data, loading, error }] = useGenerateThreadResponseBreakdownMutation({
 *   variables: {
 *      responseId: // value for 'responseId'
 *   },
 * });
 */
export function useGenerateThreadResponseBreakdownMutation(baseOptions?: Apollo.MutationHookOptions<GenerateThreadResponseBreakdownMutation, GenerateThreadResponseBreakdownMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<GenerateThreadResponseBreakdownMutation, GenerateThreadResponseBreakdownMutationVariables>(GenerateThreadResponseBreakdownDocument, options);
      }
export type GenerateThreadResponseBreakdownMutationHookResult = ReturnType<typeof useGenerateThreadResponseBreakdownMutation>;
export type GenerateThreadResponseBreakdownMutationResult = Apollo.MutationResult<GenerateThreadResponseBreakdownMutation>;
export type GenerateThreadResponseBreakdownMutationOptions = Apollo.BaseMutationOptions<GenerateThreadResponseBreakdownMutation, GenerateThreadResponseBreakdownMutationVariables>;
export const GenerateThreadResponseAnswerDocument = gql`
    mutation GenerateThreadResponseAnswer($responseId: Int!) {
  generateThreadResponseAnswer(responseId: $responseId) {
    ...CommonResponse
  }
}
    ${CommonResponseFragmentDoc}`;
export type GenerateThreadResponseAnswerMutationFn = Apollo.MutationFunction<GenerateThreadResponseAnswerMutation, GenerateThreadResponseAnswerMutationVariables>;

/**
 * __useGenerateThreadResponseAnswerMutation__
 *
 * To run a mutation, you first call `useGenerateThreadResponseAnswerMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useGenerateThreadResponseAnswerMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [generateThreadResponseAnswerMutation, { data, loading, error }] = useGenerateThreadResponseAnswerMutation({
 *   variables: {
 *      responseId: // value for 'responseId'
 *   },
 * });
 */
export function useGenerateThreadResponseAnswerMutation(baseOptions?: Apollo.MutationHookOptions<GenerateThreadResponseAnswerMutation, GenerateThreadResponseAnswerMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<GenerateThreadResponseAnswerMutation, GenerateThreadResponseAnswerMutationVariables>(GenerateThreadResponseAnswerDocument, options);
      }
export type GenerateThreadResponseAnswerMutationHookResult = ReturnType<typeof useGenerateThreadResponseAnswerMutation>;
export type GenerateThreadResponseAnswerMutationResult = Apollo.MutationResult<GenerateThreadResponseAnswerMutation>;
export type GenerateThreadResponseAnswerMutationOptions = Apollo.BaseMutationOptions<GenerateThreadResponseAnswerMutation, GenerateThreadResponseAnswerMutationVariables>;
export const GenerateThreadResponseChartDocument = gql`
    mutation GenerateThreadResponseChart($responseId: Int!) {
  generateThreadResponseChart(responseId: $responseId) {
    ...CommonResponse
  }
}
    ${CommonResponseFragmentDoc}`;
export type GenerateThreadResponseChartMutationFn = Apollo.MutationFunction<GenerateThreadResponseChartMutation, GenerateThreadResponseChartMutationVariables>;

/**
 * __useGenerateThreadResponseChartMutation__
 *
 * To run a mutation, you first call `useGenerateThreadResponseChartMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useGenerateThreadResponseChartMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [generateThreadResponseChartMutation, { data, loading, error }] = useGenerateThreadResponseChartMutation({
 *   variables: {
 *      responseId: // value for 'responseId'
 *   },
 * });
 */
export function useGenerateThreadResponseChartMutation(baseOptions?: Apollo.MutationHookOptions<GenerateThreadResponseChartMutation, GenerateThreadResponseChartMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<GenerateThreadResponseChartMutation, GenerateThreadResponseChartMutationVariables>(GenerateThreadResponseChartDocument, options);
      }
export type GenerateThreadResponseChartMutationHookResult = ReturnType<typeof useGenerateThreadResponseChartMutation>;
export type GenerateThreadResponseChartMutationResult = Apollo.MutationResult<GenerateThreadResponseChartMutation>;
export type GenerateThreadResponseChartMutationOptions = Apollo.BaseMutationOptions<GenerateThreadResponseChartMutation, GenerateThreadResponseChartMutationVariables>;
export const AdjustThreadResponseChartDocument = gql`
    mutation AdjustThreadResponseChart($responseId: Int!, $data: AdjustThreadResponseChartInput!) {
  adjustThreadResponseChart(responseId: $responseId, data: $data) {
    ...CommonResponse
  }
}
    ${CommonResponseFragmentDoc}`;
export type AdjustThreadResponseChartMutationFn = Apollo.MutationFunction<AdjustThreadResponseChartMutation, AdjustThreadResponseChartMutationVariables>;

/**
 * __useAdjustThreadResponseChartMutation__
 *
 * To run a mutation, you first call `useAdjustThreadResponseChartMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useAdjustThreadResponseChartMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [adjustThreadResponseChartMutation, { data, loading, error }] = useAdjustThreadResponseChartMutation({
 *   variables: {
 *      responseId: // value for 'responseId'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useAdjustThreadResponseChartMutation(baseOptions?: Apollo.MutationHookOptions<AdjustThreadResponseChartMutation, AdjustThreadResponseChartMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<AdjustThreadResponseChartMutation, AdjustThreadResponseChartMutationVariables>(AdjustThreadResponseChartDocument, options);
      }
export type AdjustThreadResponseChartMutationHookResult = ReturnType<typeof useAdjustThreadResponseChartMutation>;
export type AdjustThreadResponseChartMutationResult = Apollo.MutationResult<AdjustThreadResponseChartMutation>;
export type AdjustThreadResponseChartMutationOptions = Apollo.BaseMutationOptions<AdjustThreadResponseChartMutation, AdjustThreadResponseChartMutationVariables>;