import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type CommonColumnFragment = { __typename?: 'DetailedColumn', displayName: string, referenceName: string, sourceColumnName: string, type?: string | null, isCalculated: boolean, notNull: boolean, properties: any };

export type CommonFieldFragment = { __typename?: 'FieldInfo', id: number, displayName: string, referenceName: string, sourceColumnName: string, type?: string | null, isCalculated: boolean, notNull: boolean, expression?: string | null, properties?: any | null };

export type CommonRelationFragment = { __typename?: 'DetailedRelation', fromModelId: number, fromColumnId: number, toModelId: number, toColumnId: number, type: Types.RelationType, name: string };

export type ListModelsQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type ListModelsQuery = { __typename?: 'Query', listModels: Array<{ __typename?: 'ModelInfo', id: number, displayName: string, referenceName: string, sourceTableName: string, refSql?: string | null, primaryKey?: string | null, cached: boolean, refreshTime?: string | null, description?: string | null, fields: Array<{ __typename?: 'FieldInfo', id: number, displayName: string, referenceName: string, sourceColumnName: string, type?: string | null, isCalculated: boolean, notNull: boolean, expression?: string | null, properties?: any | null } | null>, calculatedFields: Array<{ __typename?: 'FieldInfo', id: number, displayName: string, referenceName: string, sourceColumnName: string, type?: string | null, isCalculated: boolean, notNull: boolean, expression?: string | null, properties?: any | null } | null> }> };

export type GetModelQueryVariables = Types.Exact<{
  where: Types.ModelWhereInput;
}>;


export type GetModelQuery = { __typename?: 'Query', model: { __typename?: 'DetailedModel', displayName: string, referenceName: string, sourceTableName: string, refSql: string, primaryKey?: string | null, cached: boolean, refreshTime?: string | null, description?: string | null, properties: any, fields?: Array<{ __typename?: 'DetailedColumn', displayName: string, referenceName: string, sourceColumnName: string, type?: string | null, isCalculated: boolean, notNull: boolean, properties: any } | null> | null, calculatedFields?: Array<{ __typename?: 'DetailedColumn', displayName: string, referenceName: string, sourceColumnName: string, type?: string | null, isCalculated: boolean, notNull: boolean, properties: any } | null> | null, relations?: Array<{ __typename?: 'DetailedRelation', fromModelId: number, fromColumnId: number, toModelId: number, toColumnId: number, type: Types.RelationType, name: string } | null> | null } };

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

export type PreviewModelDataMutationVariables = Types.Exact<{
  where: Types.WhereIdInput;
}>;


export type PreviewModelDataMutation = { __typename?: 'Mutation', previewModelData: any };

export const CommonColumnFragmentDoc = gql`
    fragment CommonColumn on DetailedColumn {
  displayName
  referenceName
  sourceColumnName
  type
  isCalculated
  notNull
  properties
}
    `;
export const CommonFieldFragmentDoc = gql`
    fragment CommonField on FieldInfo {
  id
  displayName
  referenceName
  sourceColumnName
  type
  isCalculated
  notNull
  expression
  properties
}
    `;
export const CommonRelationFragmentDoc = gql`
    fragment CommonRelation on DetailedRelation {
  fromModelId
  fromColumnId
  toModelId
  toColumnId
  type
  name
}
    `;
export const ListModelsDocument = gql`
    query ListModels {
  listModels {
    id
    displayName
    referenceName
    sourceTableName
    refSql
    primaryKey
    cached
    refreshTime
    description
    fields {
      ...CommonField
    }
    calculatedFields {
      ...CommonField
    }
  }
}
    ${CommonFieldFragmentDoc}`;

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
    displayName
    referenceName
    sourceTableName
    refSql
    primaryKey
    cached
    refreshTime
    description
    fields {
      ...CommonColumn
    }
    calculatedFields {
      ...CommonColumn
    }
    relations {
      ...CommonRelation
    }
    properties
  }
}
    ${CommonColumnFragmentDoc}
${CommonRelationFragmentDoc}`;

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
export const PreviewModelDataDocument = gql`
    mutation PreviewModelData($where: WhereIdInput!) {
  previewModelData(where: $where)
}
    `;
export type PreviewModelDataMutationFn = Apollo.MutationFunction<PreviewModelDataMutation, PreviewModelDataMutationVariables>;

/**
 * __usePreviewModelDataMutation__
 *
 * To run a mutation, you first call `usePreviewModelDataMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `usePreviewModelDataMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [previewModelDataMutation, { data, loading, error }] = usePreviewModelDataMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function usePreviewModelDataMutation(baseOptions?: Apollo.MutationHookOptions<PreviewModelDataMutation, PreviewModelDataMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<PreviewModelDataMutation, PreviewModelDataMutationVariables>(PreviewModelDataDocument, options);
      }
export type PreviewModelDataMutationHookResult = ReturnType<typeof usePreviewModelDataMutation>;
export type PreviewModelDataMutationResult = Apollo.MutationResult<PreviewModelDataMutation>;
export type PreviewModelDataMutationOptions = Apollo.BaseMutationOptions<PreviewModelDataMutation, PreviewModelDataMutationVariables>;