import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type CreateViewMutationVariables = Types.Exact<{
  data: Types.CreateViewInput;
}>;


export type CreateViewMutation = { __typename?: 'Mutation', createView: { __typename?: 'ViewInfo', id: number, name: string, statement: string } };

export type DeleteViewMutationVariables = Types.Exact<{
  where: Types.ViewWhereUniqueInput;
}>;


export type DeleteViewMutation = { __typename?: 'Mutation', deleteView: boolean };

export type GetViewQueryVariables = Types.Exact<{
  where: Types.ViewWhereUniqueInput;
}>;


export type GetViewQuery = { __typename?: 'Query', view: { __typename?: 'ViewInfo', id: number, name: string, statement: string } };

export type ListViewsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type ListViewsQuery = { __typename?: 'Query', listViews: Array<{ __typename?: 'ViewInfo', id: number, name: string, displayName: string, statement: string }> };

export type PreviewViewDataMutationVariables = Types.Exact<{
  where: Types.PreviewViewDataInput;
}>;


export type PreviewViewDataMutation = { __typename?: 'Mutation', previewViewData: any };

export type ValidateViewMutationVariables = Types.Exact<{
  data: Types.ValidateViewInput;
}>;


export type ValidateViewMutation = { __typename?: 'Mutation', validateView: { __typename?: 'ViewValidationResponse', valid: boolean, message?: string | null } };


export const CreateViewDocument = gql`
    mutation CreateView($data: CreateViewInput!) {
  createView(data: $data) {
    id
    name
    statement
  }
}
    `;
export type CreateViewMutationFn = Apollo.MutationFunction<CreateViewMutation, CreateViewMutationVariables>;

/**
 * __useCreateViewMutation__
 *
 * To run a mutation, you first call `useCreateViewMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateViewMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createViewMutation, { data, loading, error }] = useCreateViewMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateViewMutation(baseOptions?: Apollo.MutationHookOptions<CreateViewMutation, CreateViewMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateViewMutation, CreateViewMutationVariables>(CreateViewDocument, options);
      }
export type CreateViewMutationHookResult = ReturnType<typeof useCreateViewMutation>;
export type CreateViewMutationResult = Apollo.MutationResult<CreateViewMutation>;
export type CreateViewMutationOptions = Apollo.BaseMutationOptions<CreateViewMutation, CreateViewMutationVariables>;
export const DeleteViewDocument = gql`
    mutation DeleteView($where: ViewWhereUniqueInput!) {
  deleteView(where: $where)
}
    `;
export type DeleteViewMutationFn = Apollo.MutationFunction<DeleteViewMutation, DeleteViewMutationVariables>;

/**
 * __useDeleteViewMutation__
 *
 * To run a mutation, you first call `useDeleteViewMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteViewMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteViewMutation, { data, loading, error }] = useDeleteViewMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useDeleteViewMutation(baseOptions?: Apollo.MutationHookOptions<DeleteViewMutation, DeleteViewMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteViewMutation, DeleteViewMutationVariables>(DeleteViewDocument, options);
      }
export type DeleteViewMutationHookResult = ReturnType<typeof useDeleteViewMutation>;
export type DeleteViewMutationResult = Apollo.MutationResult<DeleteViewMutation>;
export type DeleteViewMutationOptions = Apollo.BaseMutationOptions<DeleteViewMutation, DeleteViewMutationVariables>;
export const GetViewDocument = gql`
    query GetView($where: ViewWhereUniqueInput!) {
  view(where: $ViewWhereUniqueInput) {
    id
    name
    statement
  }
}
    `;

/**
 * __useGetViewQuery__
 *
 * To run a query within a React component, call `useGetViewQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetViewQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetViewQuery({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useGetViewQuery(baseOptions: Apollo.QueryHookOptions<GetViewQuery, GetViewQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GetViewQuery, GetViewQueryVariables>(GetViewDocument, options);
      }
export function useGetViewLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GetViewQuery, GetViewQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GetViewQuery, GetViewQueryVariables>(GetViewDocument, options);
        }
export type GetViewQueryHookResult = ReturnType<typeof useGetViewQuery>;
export type GetViewLazyQueryHookResult = ReturnType<typeof useGetViewLazyQuery>;
export type GetViewQueryResult = Apollo.QueryResult<GetViewQuery, GetViewQueryVariables>;
export const ListViewsDocument = gql`
    query ListViews {
  listViews {
    id
    name
    displayName
    statement
  }
}
    `;

/**
 * __useListViewsQuery__
 *
 * To run a query within a React component, call `useListViewsQuery` and pass it any options that fit your needs.
 * When your component renders, `useListViewsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useListViewsQuery({
 *   variables: {
 *   },
 * });
 */
export function useListViewsQuery(baseOptions?: Apollo.QueryHookOptions<ListViewsQuery, ListViewsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<ListViewsQuery, ListViewsQueryVariables>(ListViewsDocument, options);
      }
export function useListViewsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<ListViewsQuery, ListViewsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<ListViewsQuery, ListViewsQueryVariables>(ListViewsDocument, options);
        }
export type ListViewsQueryHookResult = ReturnType<typeof useListViewsQuery>;
export type ListViewsLazyQueryHookResult = ReturnType<typeof useListViewsLazyQuery>;
export type ListViewsQueryResult = Apollo.QueryResult<ListViewsQuery, ListViewsQueryVariables>;
export const PreviewViewDataDocument = gql`
    mutation PreviewViewData($where: PreviewViewDataInput!) {
  previewViewData(where: $where)
}
    `;
export type PreviewViewDataMutationFn = Apollo.MutationFunction<PreviewViewDataMutation, PreviewViewDataMutationVariables>;

/**
 * __usePreviewViewDataMutation__
 *
 * To run a mutation, you first call `usePreviewViewDataMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `usePreviewViewDataMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [previewViewDataMutation, { data, loading, error }] = usePreviewViewDataMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function usePreviewViewDataMutation(baseOptions?: Apollo.MutationHookOptions<PreviewViewDataMutation, PreviewViewDataMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<PreviewViewDataMutation, PreviewViewDataMutationVariables>(PreviewViewDataDocument, options);
      }
export type PreviewViewDataMutationHookResult = ReturnType<typeof usePreviewViewDataMutation>;
export type PreviewViewDataMutationResult = Apollo.MutationResult<PreviewViewDataMutation>;
export type PreviewViewDataMutationOptions = Apollo.BaseMutationOptions<PreviewViewDataMutation, PreviewViewDataMutationVariables>;
export const ValidateViewDocument = gql`
    mutation ValidateView($data: ValidateViewInput!) {
  validateView(data: $data) {
    valid
    message
  }
}
    `;
export type ValidateViewMutationFn = Apollo.MutationFunction<ValidateViewMutation, ValidateViewMutationVariables>;

/**
 * __useValidateViewMutation__
 *
 * To run a mutation, you first call `useValidateViewMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useValidateViewMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [validateViewMutation, { data, loading, error }] = useValidateViewMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useValidateViewMutation(baseOptions?: Apollo.MutationHookOptions<ValidateViewMutation, ValidateViewMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<ValidateViewMutation, ValidateViewMutationVariables>(ValidateViewDocument, options);
      }
export type ValidateViewMutationHookResult = ReturnType<typeof useValidateViewMutation>;
export type ValidateViewMutationResult = Apollo.MutationResult<ValidateViewMutation>;
export type ValidateViewMutationOptions = Apollo.BaseMutationOptions<ValidateViewMutation, ValidateViewMutationVariables>;