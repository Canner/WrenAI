import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type CommonDashboardItemFragment = { __typename?: 'DashboardItem', id: number, dashboardId: number, type: Types.DashboardItemType, displayName?: string | null, layout: { __typename?: 'DashboardItemLayout', x: number, y: number, w: number, h: number }, detail: { __typename?: 'DashboardItemDetail', sql: string, chartSchema?: any | null, renderHints?: any | null, canonicalizationVersion?: string | null, chartDataProfile?: any | null, validationErrors?: Array<string> | null, sourceResponseId?: number | null, sourceThreadId?: number | null, sourceQuestion?: string | null } };

export type DashboardItemsQueryVariables = Types.Exact<{
  where?: Types.InputMaybe<Types.DashboardWhereInput>;
}>;


export type DashboardItemsQuery = { __typename?: 'Query', dashboardItems: Array<{ __typename?: 'DashboardItem', id: number, dashboardId: number, type: Types.DashboardItemType, displayName?: string | null, layout: { __typename?: 'DashboardItemLayout', x: number, y: number, w: number, h: number }, detail: { __typename?: 'DashboardItemDetail', sql: string, chartSchema?: any | null, renderHints?: any | null, canonicalizationVersion?: string | null, chartDataProfile?: any | null, validationErrors?: Array<string> | null, sourceResponseId?: number | null, sourceThreadId?: number | null, sourceQuestion?: string | null } }> };

export type DashboardsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type DashboardsQuery = { __typename?: 'Query', dashboards: Array<{ __typename?: 'Dashboard', id: number, name: string, cacheEnabled: boolean, nextScheduledAt?: string | null, scheduleFrequency?: Types.ScheduleFrequencyEnum | null }> };

export type CreateDashboardMutationVariables = Types.Exact<{
  data: Types.CreateDashboardInput;
}>;


export type CreateDashboardMutation = { __typename?: 'Mutation', createDashboard: { __typename?: 'Dashboard', id: number, name: string, cacheEnabled: boolean, nextScheduledAt?: string | null, scheduleFrequency?: Types.ScheduleFrequencyEnum | null, scheduleTimezone?: string | null, scheduleCron?: string | null } };

export type CreateDashboardItemMutationVariables = Types.Exact<{
  data: Types.CreateDashboardItemInput;
}>;


export type CreateDashboardItemMutation = { __typename?: 'Mutation', createDashboardItem: { __typename?: 'DashboardItem', id: number, dashboardId: number, type: Types.DashboardItemType, displayName?: string | null, layout: { __typename?: 'DashboardItemLayout', x: number, y: number, w: number, h: number }, detail: { __typename?: 'DashboardItemDetail', sql: string, chartSchema?: any | null, renderHints?: any | null, canonicalizationVersion?: string | null, chartDataProfile?: any | null, validationErrors?: Array<string> | null, sourceResponseId?: number | null, sourceThreadId?: number | null, sourceQuestion?: string | null } } };

export type UpdateDashboardItemMutationVariables = Types.Exact<{
  where: Types.DashboardItemWhereInput;
  data: Types.UpdateDashboardItemInput;
}>;


export type UpdateDashboardItemMutation = { __typename?: 'Mutation', updateDashboardItem: { __typename?: 'DashboardItem', id: number, dashboardId: number, type: Types.DashboardItemType, displayName?: string | null, layout: { __typename?: 'DashboardItemLayout', x: number, y: number, w: number, h: number }, detail: { __typename?: 'DashboardItemDetail', sql: string, chartSchema?: any | null, renderHints?: any | null, canonicalizationVersion?: string | null, chartDataProfile?: any | null, validationErrors?: Array<string> | null, sourceResponseId?: number | null, sourceThreadId?: number | null, sourceQuestion?: string | null } } };

export type UpdateDashboardItemLayoutsMutationVariables = Types.Exact<{
  data: Types.UpdateDashboardItemLayoutsInput;
}>;


export type UpdateDashboardItemLayoutsMutation = { __typename?: 'Mutation', updateDashboardItemLayouts: Array<{ __typename?: 'DashboardItem', id: number, dashboardId: number, type: Types.DashboardItemType, displayName?: string | null, layout: { __typename?: 'DashboardItemLayout', x: number, y: number, w: number, h: number }, detail: { __typename?: 'DashboardItemDetail', sql: string, chartSchema?: any | null, renderHints?: any | null, canonicalizationVersion?: string | null, chartDataProfile?: any | null, validationErrors?: Array<string> | null, sourceResponseId?: number | null, sourceThreadId?: number | null, sourceQuestion?: string | null } }> };

export type DeleteDashboardItemMutationVariables = Types.Exact<{
  where: Types.DashboardItemWhereInput;
}>;


export type DeleteDashboardItemMutation = { __typename?: 'Mutation', deleteDashboardItem: boolean };

export type PreviewItemSqlMutationVariables = Types.Exact<{
  data: Types.PreviewItemSqlInput;
}>;


export type PreviewItemSqlMutation = { __typename?: 'Mutation', previewItemSQL: { __typename?: 'PreviewItemResponse', data: any, chartDataProfile?: any | null, cacheHit: boolean, cacheCreatedAt?: string | null, cacheOverrodeAt?: string | null, override: boolean } };

export type SetDashboardScheduleMutationVariables = Types.Exact<{
  data: Types.SetDashboardScheduleInput;
}>;


export type SetDashboardScheduleMutation = { __typename?: 'Mutation', setDashboardSchedule: { __typename?: 'Dashboard', id: number, name: string, cacheEnabled: boolean, scheduleFrequency?: Types.ScheduleFrequencyEnum | null, scheduleTimezone?: string | null, scheduleCron?: string | null, nextScheduledAt?: string | null } };

export type DashboardQueryVariables = Types.Exact<{
  where?: Types.InputMaybe<Types.DashboardWhereInput>;
}>;


export type DashboardQuery = { __typename?: 'Query', dashboard: { __typename?: 'DetailedDashboard', id: number, name: string, description?: string | null, cacheEnabled: boolean, nextScheduledAt?: string | null, schedule?: { __typename?: 'DashboardSchedule', frequency?: Types.ScheduleFrequencyEnum | null, hour?: number | null, minute?: number | null, day?: Types.CacheScheduleDayEnum | null, timezone?: string | null, cron?: string | null } | null, items: Array<{ __typename?: 'DashboardItem', id: number, dashboardId: number, type: Types.DashboardItemType, displayName?: string | null, layout: { __typename?: 'DashboardItemLayout', x: number, y: number, w: number, h: number }, detail: { __typename?: 'DashboardItemDetail', sql: string, chartSchema?: any | null, renderHints?: any | null, canonicalizationVersion?: string | null, chartDataProfile?: any | null, validationErrors?: Array<string> | null, sourceResponseId?: number | null, sourceThreadId?: number | null, sourceQuestion?: string | null } }> } };

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
    renderHints
    canonicalizationVersion
    chartDataProfile
    validationErrors
    sourceResponseId
    sourceThreadId
    sourceQuestion
  }
  displayName
}
    `;
export const DashboardItemsDocument = gql`
    query DashboardItems($where: DashboardWhereInput) {
  dashboardItems(where: $where) {
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
 *      where: // value for 'where'
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
export const DashboardsDocument = gql`
    query Dashboards {
  dashboards {
    id
    name
    cacheEnabled
    nextScheduledAt
    scheduleFrequency
  }
}
    `;

/**
 * __useDashboardsQuery__
 *
 * To run a query within a React component, call `useDashboardsQuery` and pass it any options that fit your needs.
 * When your component renders, `useDashboardsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useDashboardsQuery({
 *   variables: {
 *   },
 * });
 */
export function useDashboardsQuery(baseOptions?: Apollo.QueryHookOptions<DashboardsQuery, DashboardsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<DashboardsQuery, DashboardsQueryVariables>(DashboardsDocument, options);
      }
export function useDashboardsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<DashboardsQuery, DashboardsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<DashboardsQuery, DashboardsQueryVariables>(DashboardsDocument, options);
        }
export type DashboardsQueryHookResult = ReturnType<typeof useDashboardsQuery>;
export type DashboardsLazyQueryHookResult = ReturnType<typeof useDashboardsLazyQuery>;
export type DashboardsQueryResult = Apollo.QueryResult<DashboardsQuery, DashboardsQueryVariables>;
export const CreateDashboardDocument = gql`
    mutation CreateDashboard($data: CreateDashboardInput!) {
  createDashboard(data: $data) {
    id
    name
    cacheEnabled
    nextScheduledAt
    scheduleFrequency
    scheduleTimezone
    scheduleCron
  }
}
    `;
export type CreateDashboardMutationFn = Apollo.MutationFunction<CreateDashboardMutation, CreateDashboardMutationVariables>;

/**
 * __useCreateDashboardMutation__
 *
 * To run a mutation, you first call `useCreateDashboardMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateDashboardMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createDashboardMutation, { data, loading, error }] = useCreateDashboardMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateDashboardMutation(baseOptions?: Apollo.MutationHookOptions<CreateDashboardMutation, CreateDashboardMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateDashboardMutation, CreateDashboardMutationVariables>(CreateDashboardDocument, options);
      }
export type CreateDashboardMutationHookResult = ReturnType<typeof useCreateDashboardMutation>;
export type CreateDashboardMutationResult = Apollo.MutationResult<CreateDashboardMutation>;
export type CreateDashboardMutationOptions = Apollo.BaseMutationOptions<CreateDashboardMutation, CreateDashboardMutationVariables>;
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
export const UpdateDashboardItemDocument = gql`
    mutation UpdateDashboardItem($where: DashboardItemWhereInput!, $data: UpdateDashboardItemInput!) {
  updateDashboardItem(where: $where, data: $data) {
    ...CommonDashboardItem
  }
}
    ${CommonDashboardItemFragmentDoc}`;
export type UpdateDashboardItemMutationFn = Apollo.MutationFunction<UpdateDashboardItemMutation, UpdateDashboardItemMutationVariables>;

/**
 * __useUpdateDashboardItemMutation__
 *
 * To run a mutation, you first call `useUpdateDashboardItemMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateDashboardItemMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateDashboardItemMutation, { data, loading, error }] = useUpdateDashboardItemMutation({
 *   variables: {
 *      where: // value for 'where'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateDashboardItemMutation(baseOptions?: Apollo.MutationHookOptions<UpdateDashboardItemMutation, UpdateDashboardItemMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateDashboardItemMutation, UpdateDashboardItemMutationVariables>(UpdateDashboardItemDocument, options);
      }
export type UpdateDashboardItemMutationHookResult = ReturnType<typeof useUpdateDashboardItemMutation>;
export type UpdateDashboardItemMutationResult = Apollo.MutationResult<UpdateDashboardItemMutation>;
export type UpdateDashboardItemMutationOptions = Apollo.BaseMutationOptions<UpdateDashboardItemMutation, UpdateDashboardItemMutationVariables>;
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
  previewItemSQL(data: $data) {
    data
    chartDataProfile
    cacheHit
    cacheCreatedAt
    cacheOverrodeAt
    override
  }
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
export const SetDashboardScheduleDocument = gql`
    mutation SetDashboardSchedule($data: SetDashboardScheduleInput!) {
  setDashboardSchedule(data: $data) {
    id
    name
    cacheEnabled
    scheduleFrequency
    scheduleTimezone
    scheduleCron
    nextScheduledAt
  }
}
    `;
export type SetDashboardScheduleMutationFn = Apollo.MutationFunction<SetDashboardScheduleMutation, SetDashboardScheduleMutationVariables>;

/**
 * __useSetDashboardScheduleMutation__
 *
 * To run a mutation, you first call `useSetDashboardScheduleMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useSetDashboardScheduleMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [setDashboardScheduleMutation, { data, loading, error }] = useSetDashboardScheduleMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useSetDashboardScheduleMutation(baseOptions?: Apollo.MutationHookOptions<SetDashboardScheduleMutation, SetDashboardScheduleMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<SetDashboardScheduleMutation, SetDashboardScheduleMutationVariables>(SetDashboardScheduleDocument, options);
      }
export type SetDashboardScheduleMutationHookResult = ReturnType<typeof useSetDashboardScheduleMutation>;
export type SetDashboardScheduleMutationResult = Apollo.MutationResult<SetDashboardScheduleMutation>;
export type SetDashboardScheduleMutationOptions = Apollo.BaseMutationOptions<SetDashboardScheduleMutation, SetDashboardScheduleMutationVariables>;
export const DashboardDocument = gql`
    query Dashboard($where: DashboardWhereInput) {
  dashboard(where: $where) {
    id
    name
    description
    cacheEnabled
    nextScheduledAt
    schedule {
      frequency
      hour
      minute
      day
      timezone
      cron
    }
    items {
      ...CommonDashboardItem
    }
  }
}
    ${CommonDashboardItemFragmentDoc}`;

/**
 * __useDashboardQuery__
 *
 * To run a query within a React component, call `useDashboardQuery` and pass it any options that fit your needs.
 * When your component renders, `useDashboardQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useDashboardQuery({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useDashboardQuery(baseOptions?: Apollo.QueryHookOptions<DashboardQuery, DashboardQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<DashboardQuery, DashboardQueryVariables>(DashboardDocument, options);
      }
export function useDashboardLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<DashboardQuery, DashboardQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<DashboardQuery, DashboardQueryVariables>(DashboardDocument, options);
        }
export type DashboardQueryHookResult = ReturnType<typeof useDashboardQuery>;
export type DashboardLazyQueryHookResult = ReturnType<typeof useDashboardLazyQuery>;
export type DashboardQueryResult = Apollo.QueryResult<DashboardQuery, DashboardQueryVariables>;