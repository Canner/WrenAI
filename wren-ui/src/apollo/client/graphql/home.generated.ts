import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type CommonErrorFragment = { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null };

export type CommonResponseFragment = { __typename?: 'ThreadResponse', id: number, question: string, summary: string, status: Types.AskingTaskStatus, detail?: { __typename?: 'ThreadResponseDetail', sql?: string | null, description?: string | null, steps: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }>, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null } | null };

export type SuggestedQuestionsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type SuggestedQuestionsQuery = { __typename?: 'Query', suggestedQuestions: { __typename?: 'SuggestedQuestionResponse', questions: Array<{ __typename?: 'SuggestedQuestion', label: string, question: string } | null> } };

export type AskingTaskQueryVariables = Types.Exact<{
  taskId: Types.Scalars['String'];
}>;


export type AskingTaskQuery = { __typename?: 'Query', askingTask: { __typename?: 'AskingTask', status: Types.AskingTaskStatus, candidates: Array<{ __typename?: 'ResultCandidate', sql: string, summary: string, type: Types.ResultCandidateType, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null }>, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null } };

export type ThreadsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type ThreadsQuery = { __typename?: 'Query', threads: Array<{ __typename?: 'Thread', id: number, summary: string }> };

export type ThreadQueryVariables = Types.Exact<{
  threadId: Types.Scalars['Int'];
}>;


export type ThreadQuery = { __typename?: 'Query', thread: { __typename?: 'DetailedThread', id: number, sql: string, summary: string, responses: Array<{ __typename?: 'ThreadResponse', id: number, question: string, summary: string, status: Types.AskingTaskStatus, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null, detail?: { __typename?: 'ThreadResponseDetail', sql?: string | null, description?: string | null, steps: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }>, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null } | null }> } };

export type ThreadResponseQueryVariables = Types.Exact<{
  responseId: Types.Scalars['Int'];
}>;


export type ThreadResponseQuery = { __typename?: 'Query', threadResponse: { __typename?: 'ThreadResponse', id: number, question: string, summary: string, status: Types.AskingTaskStatus, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null, detail?: { __typename?: 'ThreadResponseDetail', sql?: string | null, description?: string | null, steps: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }>, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null } | null } };

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


export type CreateThreadMutation = { __typename?: 'Mutation', createThread: { __typename?: 'Thread', id: number, sql: string, summary: string } };

export type CreateThreadResponseMutationVariables = Types.Exact<{
  threadId: Types.Scalars['Int'];
  data: Types.CreateThreadResponseInput;
}>;


export type CreateThreadResponseMutation = { __typename?: 'Mutation', createThreadResponse: { __typename?: 'ThreadResponse', id: number, question: string, summary: string, status: Types.AskingTaskStatus, error?: { __typename?: 'Error', code?: string | null, shortMessage?: string | null, message?: string | null, stacktrace?: Array<string | null> | null } | null, detail?: { __typename?: 'ThreadResponseDetail', sql?: string | null, description?: string | null, steps: Array<{ __typename?: 'DetailStep', summary: string, sql: string, cteName?: string | null }>, view?: { __typename?: 'ViewInfo', id: number, name: string, statement: string, displayName: string } | null } | null } };

export type UpdateThreadMutationVariables = Types.Exact<{
  where: Types.ThreadUniqueWhereInput;
  data: Types.UpdateThreadInput;
}>;


export type UpdateThreadMutation = { __typename?: 'Mutation', updateThread: { __typename?: 'Thread', id: number, sql: string, summary: string } };

export type DeleteThreadMutationVariables = Types.Exact<{
  where: Types.ThreadUniqueWhereInput;
}>;


export type DeleteThreadMutation = { __typename?: 'Mutation', deleteThread: boolean };

export type PreviewDataMutationVariables = Types.Exact<{
  where: Types.PreviewDataInput;
}>;


export type PreviewDataMutation = { __typename?: 'Mutation', previewData: any };

export type GetNativeSqlQueryVariables = Types.Exact<{
  responseId: Types.Scalars['Int'];
}>;


export type GetNativeSqlQuery = { __typename?: 'Query', nativeSql: string };

export const CommonErrorFragmentDoc = gql`
    fragment CommonError on Error {
  code
  shortMessage
  message
  stacktrace
}
    `;
export const CommonResponseFragmentDoc = gql`
    fragment CommonResponse on ThreadResponse {
  id
  question
  summary
  status
  detail {
    sql
    description
    steps {
      summary
      sql
      cteName
    }
    view {
      id
      name
      statement
      displayName
    }
  }
}
    `;
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
    candidates {
      sql
      summary
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
    sql
    summary
    responses {
      ...CommonResponse
      error {
        ...CommonError
      }
    }
  }
}
    ${CommonResponseFragmentDoc}
${CommonErrorFragmentDoc}`;

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
    error {
      ...CommonError
    }
  }
}
    ${CommonResponseFragmentDoc}
${CommonErrorFragmentDoc}`;

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
    sql
    summary
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
    error {
      code
      shortMessage
      message
      stacktrace
    }
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
    sql
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