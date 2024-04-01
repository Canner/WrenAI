import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type ListModelsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type ListModelsQuery = { __typename?: 'Query', listModels: Array<{ __typename?: 'ModelInfo', id: number, referenceName: string, sourceTableName: string, displayName: string, cached: boolean, primaryKey?: string | null, refreshTime?: string | null, refSql?: string | null, fields: Array<{ __typename?: 'FieldInfo', id: number, referenceName: string } | null> }> };

export type GetModelQueryVariables = Types.Exact<{
  where: Types.ModelWhereInput;
}>;


export type GetModelQuery = { __typename?: 'Query', model: { __typename?: 'DetailedModel', referenceName: string, displayName: string, sourceTableName: string, refSql: string, primaryKey?: string | null, cached: boolean, refreshTime?: string | null, fields?: Array<{ __typename?: 'DetailedColumn', referenceName: string, displayName: string, sourceColumnName: string, type?: string | null, isCalculated: boolean, notNull: boolean } | null> | null, relations?: Array<{ __typename?: 'DetailedRelation', fromModelId: number, fromColumnId: number, toModelId: number, toColumnId: number, type: Types.RelationType, name: string } | null> | null } };

export type CreateModelMutationVariables = Types.Exact<{
  data: Types.CreateModelInput;
}>;


export type CreateModelMutation = { __typename?: 'Mutation', createModel: any };

export type UpdateModelMutationVariables = Types.Exact<{
  where: Types.ModelWhereInput;
  data: Types.UpdateModelInput;
}>;


export type UpdateModelMutation = { __typename?: 'Mutation', updateModel: any };

export type DeleteModelMutationVariables = Types.Exact<{
  where: Types.ModelWhereInput;
}>;


export type DeleteModelMutation = { __typename?: 'Mutation', deleteModel: boolean };


export const ListModelsDocument = gql`
    query ListModels {
  listModels {
    id
    referenceName
    sourceTableName
    displayName
    fields {
      id
      referenceName
    }
    cached
    primaryKey
    refreshTime
    refSql
  }
}
    `;

/**
 * __useListModelsQuery__
 *
 * To run a query within a React component, call `useListModelsQuery` and pass it any options that fit your needs.
 * When your component renders, `useListModelsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useListModelsQuery({
 *   variables: {
 *   },
 * });
 */
export function useListModelsQuery(baseOptions?: Apollo.QueryHookOptions<ListModelsQuery, ListModelsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<ListModelsQuery, ListModelsQueryVariables>(ListModelsDocument, options);
      }
export function useListModelsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<ListModelsQuery, ListModelsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<ListModelsQuery, ListModelsQueryVariables>(ListModelsDocument, options);
        }
export type ListModelsQueryHookResult = ReturnType<typeof useListModelsQuery>;
export type ListModelsLazyQueryHookResult = ReturnType<typeof useListModelsLazyQuery>;
export type ListModelsQueryResult = Apollo.QueryResult<ListModelsQuery, ListModelsQueryVariables>;
export const GetModelDocument = gql`
    query GetModel($where: ModelWhereInput!) {
  model(where: $where) {
    referenceName
    displayName
    sourceTableName
    refSql
    primaryKey
    cached
    refreshTime
    fields {
      referenceName
      displayName
      sourceColumnName
      type
      isCalculated
      notNull
    }
    relations {
      fromModelId
      fromColumnId
      toModelId
      toColumnId
      type
      name
    }
  }
}
    `;

/**
 * __useGetModelQuery__
 *
 * To run a query within a React component, call `useGetModelQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetModelQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetModelQuery({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useGetModelQuery(baseOptions: Apollo.QueryHookOptions<GetModelQuery, GetModelQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GetModelQuery, GetModelQueryVariables>(GetModelDocument, options);
      }
export function useGetModelLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GetModelQuery, GetModelQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GetModelQuery, GetModelQueryVariables>(GetModelDocument, options);
        }
export type GetModelQueryHookResult = ReturnType<typeof useGetModelQuery>;
export type GetModelLazyQueryHookResult = ReturnType<typeof useGetModelLazyQuery>;
export type GetModelQueryResult = Apollo.QueryResult<GetModelQuery, GetModelQueryVariables>;
export const CreateModelDocument = gql`
    mutation CreateModel($data: CreateModelInput!) {
  createModel(data: $data)
}
    `;
export type CreateModelMutationFn = Apollo.MutationFunction<CreateModelMutation, CreateModelMutationVariables>;

/**
 * __useCreateModelMutation__
 *
 * To run a mutation, you first call `useCreateModelMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateModelMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createModelMutation, { data, loading, error }] = useCreateModelMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateModelMutation(baseOptions?: Apollo.MutationHookOptions<CreateModelMutation, CreateModelMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateModelMutation, CreateModelMutationVariables>(CreateModelDocument, options);
      }
export type CreateModelMutationHookResult = ReturnType<typeof useCreateModelMutation>;
export type CreateModelMutationResult = Apollo.MutationResult<CreateModelMutation>;
export type CreateModelMutationOptions = Apollo.BaseMutationOptions<CreateModelMutation, CreateModelMutationVariables>;
export const UpdateModelDocument = gql`
    mutation UpdateModel($where: ModelWhereInput!, $data: UpdateModelInput!) {
  updateModel(where: $where, data: $data)
}
    `;
export type UpdateModelMutationFn = Apollo.MutationFunction<UpdateModelMutation, UpdateModelMutationVariables>;

/**
 * __useUpdateModelMutation__
 *
 * To run a mutation, you first call `useUpdateModelMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateModelMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateModelMutation, { data, loading, error }] = useUpdateModelMutation({
 *   variables: {
 *      where: // value for 'where'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateModelMutation(baseOptions?: Apollo.MutationHookOptions<UpdateModelMutation, UpdateModelMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateModelMutation, UpdateModelMutationVariables>(UpdateModelDocument, options);
      }
export type UpdateModelMutationHookResult = ReturnType<typeof useUpdateModelMutation>;
export type UpdateModelMutationResult = Apollo.MutationResult<UpdateModelMutation>;
export type UpdateModelMutationOptions = Apollo.BaseMutationOptions<UpdateModelMutation, UpdateModelMutationVariables>;
export const DeleteModelDocument = gql`
    mutation DeleteModel($where: ModelWhereInput!) {
  deleteModel(where: $where)
}
    `;
export type DeleteModelMutationFn = Apollo.MutationFunction<DeleteModelMutation, DeleteModelMutationVariables>;

/**
 * __useDeleteModelMutation__
 *
 * To run a mutation, you first call `useDeleteModelMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteModelMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteModelMutation, { data, loading, error }] = useDeleteModelMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useDeleteModelMutation(baseOptions?: Apollo.MutationHookOptions<DeleteModelMutation, DeleteModelMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteModelMutation, DeleteModelMutationVariables>(DeleteModelDocument, options);
      }
export type DeleteModelMutationHookResult = ReturnType<typeof useDeleteModelMutation>;
export type DeleteModelMutationResult = Apollo.MutationResult<DeleteModelMutation>;
export type DeleteModelMutationOptions = Apollo.BaseMutationOptions<DeleteModelMutation, DeleteModelMutationVariables>;