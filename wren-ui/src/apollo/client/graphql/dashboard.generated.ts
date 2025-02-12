import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type CommonDashboardItemFragment = { __typename?: 'DashboardItem', id: number, dashboardId: number, type: Types.DashboardItemType, layout: { __typename?: 'DashboardItemLayout', x: number, y: number, w: number, h: number }, detail: { __typename?: 'DashboardItemDetail', sql: string, chartSchema?: any | null } };

export type DashboardItemsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type DashboardItemsQuery = { __typename?: 'Query', dashboardItems: Array<{ __typename?: 'DashboardItem', id: number, dashboardId: number, type: Types.DashboardItemType, layout: { __typename?: 'DashboardItemLayout', x: number, y: number, w: number, h: number }, detail: { __typename?: 'DashboardItemDetail', sql: string, chartSchema?: any | null } }> };

export type CreateDashboardItemMutationVariables = Types.Exact<{
  data: Types.CreateDashboardItemInput;
}>;


export type CreateDashboardItemMutation = { __typename?: 'Mutation', createDashboardItem: { __typename?: 'DashboardItem', id: number, dashboardId: number, type: Types.DashboardItemType, layout: { __typename?: 'DashboardItemLayout', x: number, y: number, w: number, h: number }, detail: { __typename?: 'DashboardItemDetail', sql: string, chartSchema?: any | null } } };

export type UpdateDashboardItemLayoutsMutationVariables = Types.Exact<{
  data: Types.UpdateDashboardItemLayoutsInput;
}>;


export type UpdateDashboardItemLayoutsMutation = { __typename?: 'Mutation', updateDashboardItemLayouts: Array<{ __typename?: 'DashboardItem', id: number, dashboardId: number, type: Types.DashboardItemType, layout: { __typename?: 'DashboardItemLayout', x: number, y: number, w: number, h: number }, detail: { __typename?: 'DashboardItemDetail', sql: string, chartSchema?: any | null } }> };

export type DeleteDashboardItemMutationVariables = Types.Exact<{
  where: Types.DashboardItemWhereInput;
}>;


export type DeleteDashboardItemMutation = { __typename?: 'Mutation', deleteDashboardItem: boolean };

export type PreviewItemSqlMutationVariables = Types.Exact<{
  data: Types.PreviewItemSqlInput;
}>;


export type PreviewItemSqlMutation = { __typename?: 'Mutation', previewItemSQL: any };

export const CommonDashboardItemFragmentDoc = gql`
    fragment CommonDashboardItem on DashboardItem {
  id
  dashboardId
  type
  layout {
    x
    y
    w
    h
  }
  detail {
    sql
    chartSchema
  }
}
    `;
export const DashboardItemsDocument = gql`
    query DashboardItems {
  dashboardItems {
    ...CommonDashboardItem
  }
}
    ${CommonDashboardItemFragmentDoc}`;

/**
 * __useDashboardItemsQuery__
 *
 * To run a query within a React component, call `useDashboardItemsQuery` and pass it any options that fit your needs.
 * When your component renders, `useDashboardItemsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useDashboardItemsQuery({
 *   variables: {
 *   },
 * });
 */
export function useDashboardItemsQuery(baseOptions?: Apollo.QueryHookOptions<DashboardItemsQuery, DashboardItemsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<DashboardItemsQuery, DashboardItemsQueryVariables>(DashboardItemsDocument, options);
      }
export function useDashboardItemsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<DashboardItemsQuery, DashboardItemsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<DashboardItemsQuery, DashboardItemsQueryVariables>(DashboardItemsDocument, options);
        }
export type DashboardItemsQueryHookResult = ReturnType<typeof useDashboardItemsQuery>;
export type DashboardItemsLazyQueryHookResult = ReturnType<typeof useDashboardItemsLazyQuery>;
export type DashboardItemsQueryResult = Apollo.QueryResult<DashboardItemsQuery, DashboardItemsQueryVariables>;
export const CreateDashboardItemDocument = gql`
    mutation CreateDashboardItem($data: CreateDashboardItemInput!) {
  createDashboardItem(data: $data) {
    ...CommonDashboardItem
  }
}
    ${CommonDashboardItemFragmentDoc}`;
export type CreateDashboardItemMutationFn = Apollo.MutationFunction<CreateDashboardItemMutation, CreateDashboardItemMutationVariables>;

/**
 * __useCreateDashboardItemMutation__
 *
 * To run a mutation, you first call `useCreateDashboardItemMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateDashboardItemMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createDashboardItemMutation, { data, loading, error }] = useCreateDashboardItemMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateDashboardItemMutation(baseOptions?: Apollo.MutationHookOptions<CreateDashboardItemMutation, CreateDashboardItemMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateDashboardItemMutation, CreateDashboardItemMutationVariables>(CreateDashboardItemDocument, options);
      }
export type CreateDashboardItemMutationHookResult = ReturnType<typeof useCreateDashboardItemMutation>;
export type CreateDashboardItemMutationResult = Apollo.MutationResult<CreateDashboardItemMutation>;
export type CreateDashboardItemMutationOptions = Apollo.BaseMutationOptions<CreateDashboardItemMutation, CreateDashboardItemMutationVariables>;
export const UpdateDashboardItemLayoutsDocument = gql`
    mutation UpdateDashboardItemLayouts($data: UpdateDashboardItemLayoutsInput!) {
  updateDashboardItemLayouts(data: $data) {
    ...CommonDashboardItem
  }
}
    ${CommonDashboardItemFragmentDoc}`;
export type UpdateDashboardItemLayoutsMutationFn = Apollo.MutationFunction<UpdateDashboardItemLayoutsMutation, UpdateDashboardItemLayoutsMutationVariables>;

/**
 * __useUpdateDashboardItemLayoutsMutation__
 *
 * To run a mutation, you first call `useUpdateDashboardItemLayoutsMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateDashboardItemLayoutsMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateDashboardItemLayoutsMutation, { data, loading, error }] = useUpdateDashboardItemLayoutsMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateDashboardItemLayoutsMutation(baseOptions?: Apollo.MutationHookOptions<UpdateDashboardItemLayoutsMutation, UpdateDashboardItemLayoutsMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateDashboardItemLayoutsMutation, UpdateDashboardItemLayoutsMutationVariables>(UpdateDashboardItemLayoutsDocument, options);
      }
export type UpdateDashboardItemLayoutsMutationHookResult = ReturnType<typeof useUpdateDashboardItemLayoutsMutation>;
export type UpdateDashboardItemLayoutsMutationResult = Apollo.MutationResult<UpdateDashboardItemLayoutsMutation>;
export type UpdateDashboardItemLayoutsMutationOptions = Apollo.BaseMutationOptions<UpdateDashboardItemLayoutsMutation, UpdateDashboardItemLayoutsMutationVariables>;
export const DeleteDashboardItemDocument = gql`
    mutation DeleteDashboardItem($where: DashboardItemWhereInput!) {
  deleteDashboardItem(where: $where)
}
    `;
export type DeleteDashboardItemMutationFn = Apollo.MutationFunction<DeleteDashboardItemMutation, DeleteDashboardItemMutationVariables>;

/**
 * __useDeleteDashboardItemMutation__
 *
 * To run a mutation, you first call `useDeleteDashboardItemMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteDashboardItemMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteDashboardItemMutation, { data, loading, error }] = useDeleteDashboardItemMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useDeleteDashboardItemMutation(baseOptions?: Apollo.MutationHookOptions<DeleteDashboardItemMutation, DeleteDashboardItemMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteDashboardItemMutation, DeleteDashboardItemMutationVariables>(DeleteDashboardItemDocument, options);
      }
export type DeleteDashboardItemMutationHookResult = ReturnType<typeof useDeleteDashboardItemMutation>;
export type DeleteDashboardItemMutationResult = Apollo.MutationResult<DeleteDashboardItemMutation>;
export type DeleteDashboardItemMutationOptions = Apollo.BaseMutationOptions<DeleteDashboardItemMutation, DeleteDashboardItemMutationVariables>;
export const PreviewItemSqlDocument = gql`
    mutation PreviewItemSQL($data: PreviewItemSQLInput!) {
  previewItemSQL(data: $data)
}
    `;
export type PreviewItemSqlMutationFn = Apollo.MutationFunction<PreviewItemSqlMutation, PreviewItemSqlMutationVariables>;

/**
 * __usePreviewItemSqlMutation__
 *
 * To run a mutation, you first call `usePreviewItemSqlMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `usePreviewItemSqlMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [previewItemSqlMutation, { data, loading, error }] = usePreviewItemSqlMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function usePreviewItemSqlMutation(baseOptions?: Apollo.MutationHookOptions<PreviewItemSqlMutation, PreviewItemSqlMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<PreviewItemSqlMutation, PreviewItemSqlMutationVariables>(PreviewItemSqlDocument, options);
      }
export type PreviewItemSqlMutationHookResult = ReturnType<typeof usePreviewItemSqlMutation>;
export type PreviewItemSqlMutationResult = Apollo.MutationResult<PreviewItemSqlMutation>;
export type PreviewItemSqlMutationOptions = Apollo.BaseMutationOptions<PreviewItemSqlMutation, PreviewItemSqlMutationVariables>;