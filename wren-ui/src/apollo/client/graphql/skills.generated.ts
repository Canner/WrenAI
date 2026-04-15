import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type SkillControlPlaneQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type SkillControlPlaneQuery = { __typename?: 'Query', runtimeSelectorState?: { __typename?: 'RuntimeSelectorState', currentWorkspace?: { __typename?: 'RuntimeSelectorWorkspace', id: string, name: string } | null, currentKnowledgeBase?: { __typename?: 'RuntimeSelectorKnowledgeBase', id: string, name: string } | null, currentKbSnapshot?: { __typename?: 'RuntimeSelectorKBSnapshot', id: string, displayName: string } | null, kbSnapshots: Array<{ __typename?: 'RuntimeSelectorKBSnapshot', id: string, displayName: string }> } | null, marketplaceCatalogSkills: Array<{ __typename?: 'SkillMarketplaceCatalog', id: string, slug: string, name: string, description?: string | null, category?: string | null, author?: string | null, version: string, runtimeKind: string, sourceType: string, sourceRef?: string | null, entrypoint?: string | null, defaultInstruction?: string | null, defaultExecutionMode?: string | null, manifest?: any | null, isBuiltin?: boolean | null, isFeatured?: boolean | null, installCount?: number | null }>, skillDefinitions: Array<{ __typename?: 'SkillDefinition', id: string, workspaceId: string, name: string, runtimeKind: string, sourceType: string, sourceRef?: string | null, entrypoint?: string | null, catalogId?: string | null, instruction?: string | null, isEnabled?: boolean | null, executionMode?: string | null, connectorId?: string | null, runtimeConfig?: any | null, kbSuggestionIds?: Array<string> | null, installedFrom?: string | null, migrationSourceBindingId?: string | null, manifest?: any | null, hasSecret: boolean, createdBy?: string | null }> };

export type CreateSkillDefinitionMutationVariables = Types.Exact<{
  data: Types.CreateSkillDefinitionInput;
}>;


export type CreateSkillDefinitionMutation = { __typename?: 'Mutation', createSkillDefinition: { __typename?: 'SkillDefinition', id: string } };

export type UpdateSkillDefinitionMutationVariables = Types.Exact<{
  where: Types.SkillDefinitionWhereUniqueInput;
  data: Types.UpdateSkillDefinitionInput;
}>;


export type UpdateSkillDefinitionMutation = { __typename?: 'Mutation', updateSkillDefinition: { __typename?: 'SkillDefinition', id: string } };

export type DeleteSkillDefinitionMutationVariables = Types.Exact<{
  where: Types.SkillDefinitionWhereUniqueInput;
}>;


export type DeleteSkillDefinitionMutation = { __typename?: 'Mutation', deleteSkillDefinition: boolean };

export type InstallSkillFromMarketplaceMutationVariables = Types.Exact<{
  catalogId: Types.Scalars['String'];
}>;


export type InstallSkillFromMarketplaceMutation = { __typename?: 'Mutation', installSkillFromMarketplace: { __typename?: 'SkillDefinition', id: string } };

export type ToggleSkillEnabledMutationVariables = Types.Exact<{
  skillDefinitionId: Types.Scalars['String'];
  enabled: Types.Scalars['Boolean'];
}>;


export type ToggleSkillEnabledMutation = { __typename?: 'Mutation', toggleSkillEnabled: { __typename?: 'SkillDefinition', id: string, isEnabled?: boolean | null } };

export type UpdateSkillDefinitionRuntimeMutationVariables = Types.Exact<{
  where: Types.SkillDefinitionWhereUniqueInput;
  data: Types.UpdateSkillDefinitionRuntimeInput;
}>;


export type UpdateSkillDefinitionRuntimeMutation = { __typename?: 'Mutation', updateSkillDefinitionRuntime: { __typename?: 'SkillDefinition', id: string } };


export const SkillControlPlaneDocument = gql`
    query SkillControlPlane {
  runtimeSelectorState {
    currentWorkspace {
      id
      name
    }
    currentKnowledgeBase {
      id
      name
    }
    currentKbSnapshot {
      id
      displayName
    }
    kbSnapshots {
      id
      displayName
    }
  }
  marketplaceCatalogSkills {
    id
    slug
    name
    description
    category
    author
    version
    runtimeKind
    sourceType
    sourceRef
    entrypoint
    defaultInstruction
    defaultExecutionMode
    manifest
    isBuiltin
    isFeatured
    installCount
  }
  skillDefinitions {
    id
    workspaceId
    name
    runtimeKind
    sourceType
    sourceRef
    entrypoint
    catalogId
    instruction
    isEnabled
    executionMode
    connectorId
    runtimeConfig
    kbSuggestionIds
    installedFrom
    migrationSourceBindingId
    manifest
    hasSecret
    createdBy
  }
}
    `;

/**
 * __useSkillControlPlaneQuery__
 *
 * To run a query within a React component, call `useSkillControlPlaneQuery` and pass it any options that fit your needs.
 * When your component renders, `useSkillControlPlaneQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useSkillControlPlaneQuery({
 *   variables: {
 *   },
 * });
 */
export function useSkillControlPlaneQuery(baseOptions?: Apollo.QueryHookOptions<SkillControlPlaneQuery, SkillControlPlaneQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<SkillControlPlaneQuery, SkillControlPlaneQueryVariables>(SkillControlPlaneDocument, options);
      }
export function useSkillControlPlaneLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<SkillControlPlaneQuery, SkillControlPlaneQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<SkillControlPlaneQuery, SkillControlPlaneQueryVariables>(SkillControlPlaneDocument, options);
        }
export type SkillControlPlaneQueryHookResult = ReturnType<typeof useSkillControlPlaneQuery>;
export type SkillControlPlaneLazyQueryHookResult = ReturnType<typeof useSkillControlPlaneLazyQuery>;
export type SkillControlPlaneQueryResult = Apollo.QueryResult<SkillControlPlaneQuery, SkillControlPlaneQueryVariables>;
export const CreateSkillDefinitionDocument = gql`
    mutation CreateSkillDefinition($data: CreateSkillDefinitionInput!) {
  createSkillDefinition(data: $data) {
    id
  }
}
    `;
export type CreateSkillDefinitionMutationFn = Apollo.MutationFunction<CreateSkillDefinitionMutation, CreateSkillDefinitionMutationVariables>;

/**
 * __useCreateSkillDefinitionMutation__
 *
 * To run a mutation, you first call `useCreateSkillDefinitionMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateSkillDefinitionMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createSkillDefinitionMutation, { data, loading, error }] = useCreateSkillDefinitionMutation({
 *   variables: {
 *      data: // value for 'data'
 *   },
 * });
 */
export function useCreateSkillDefinitionMutation(baseOptions?: Apollo.MutationHookOptions<CreateSkillDefinitionMutation, CreateSkillDefinitionMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateSkillDefinitionMutation, CreateSkillDefinitionMutationVariables>(CreateSkillDefinitionDocument, options);
      }
export type CreateSkillDefinitionMutationHookResult = ReturnType<typeof useCreateSkillDefinitionMutation>;
export type CreateSkillDefinitionMutationResult = Apollo.MutationResult<CreateSkillDefinitionMutation>;
export type CreateSkillDefinitionMutationOptions = Apollo.BaseMutationOptions<CreateSkillDefinitionMutation, CreateSkillDefinitionMutationVariables>;
export const UpdateSkillDefinitionDocument = gql`
    mutation UpdateSkillDefinition($where: SkillDefinitionWhereUniqueInput!, $data: UpdateSkillDefinitionInput!) {
  updateSkillDefinition(where: $where, data: $data) {
    id
  }
}
    `;
export type UpdateSkillDefinitionMutationFn = Apollo.MutationFunction<UpdateSkillDefinitionMutation, UpdateSkillDefinitionMutationVariables>;

/**
 * __useUpdateSkillDefinitionMutation__
 *
 * To run a mutation, you first call `useUpdateSkillDefinitionMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateSkillDefinitionMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateSkillDefinitionMutation, { data, loading, error }] = useUpdateSkillDefinitionMutation({
 *   variables: {
 *      where: // value for 'where'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateSkillDefinitionMutation(baseOptions?: Apollo.MutationHookOptions<UpdateSkillDefinitionMutation, UpdateSkillDefinitionMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateSkillDefinitionMutation, UpdateSkillDefinitionMutationVariables>(UpdateSkillDefinitionDocument, options);
      }
export type UpdateSkillDefinitionMutationHookResult = ReturnType<typeof useUpdateSkillDefinitionMutation>;
export type UpdateSkillDefinitionMutationResult = Apollo.MutationResult<UpdateSkillDefinitionMutation>;
export type UpdateSkillDefinitionMutationOptions = Apollo.BaseMutationOptions<UpdateSkillDefinitionMutation, UpdateSkillDefinitionMutationVariables>;
export const DeleteSkillDefinitionDocument = gql`
    mutation DeleteSkillDefinition($where: SkillDefinitionWhereUniqueInput!) {
  deleteSkillDefinition(where: $where)
}
    `;
export type DeleteSkillDefinitionMutationFn = Apollo.MutationFunction<DeleteSkillDefinitionMutation, DeleteSkillDefinitionMutationVariables>;

/**
 * __useDeleteSkillDefinitionMutation__
 *
 * To run a mutation, you first call `useDeleteSkillDefinitionMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteSkillDefinitionMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteSkillDefinitionMutation, { data, loading, error }] = useDeleteSkillDefinitionMutation({
 *   variables: {
 *      where: // value for 'where'
 *   },
 * });
 */
export function useDeleteSkillDefinitionMutation(baseOptions?: Apollo.MutationHookOptions<DeleteSkillDefinitionMutation, DeleteSkillDefinitionMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteSkillDefinitionMutation, DeleteSkillDefinitionMutationVariables>(DeleteSkillDefinitionDocument, options);
      }
export type DeleteSkillDefinitionMutationHookResult = ReturnType<typeof useDeleteSkillDefinitionMutation>;
export type DeleteSkillDefinitionMutationResult = Apollo.MutationResult<DeleteSkillDefinitionMutation>;
export type DeleteSkillDefinitionMutationOptions = Apollo.BaseMutationOptions<DeleteSkillDefinitionMutation, DeleteSkillDefinitionMutationVariables>;
export const InstallSkillFromMarketplaceDocument = gql`
    mutation InstallSkillFromMarketplace($catalogId: String!) {
  installSkillFromMarketplace(catalogId: $catalogId) {
    id
  }
}
    `;
export type InstallSkillFromMarketplaceMutationFn = Apollo.MutationFunction<InstallSkillFromMarketplaceMutation, InstallSkillFromMarketplaceMutationVariables>;

/**
 * __useInstallSkillFromMarketplaceMutation__
 *
 * To run a mutation, you first call `useInstallSkillFromMarketplaceMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useInstallSkillFromMarketplaceMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [installSkillFromMarketplaceMutation, { data, loading, error }] = useInstallSkillFromMarketplaceMutation({
 *   variables: {
 *      catalogId: // value for 'catalogId'
 *   },
 * });
 */
export function useInstallSkillFromMarketplaceMutation(baseOptions?: Apollo.MutationHookOptions<InstallSkillFromMarketplaceMutation, InstallSkillFromMarketplaceMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<InstallSkillFromMarketplaceMutation, InstallSkillFromMarketplaceMutationVariables>(InstallSkillFromMarketplaceDocument, options);
      }
export type InstallSkillFromMarketplaceMutationHookResult = ReturnType<typeof useInstallSkillFromMarketplaceMutation>;
export type InstallSkillFromMarketplaceMutationResult = Apollo.MutationResult<InstallSkillFromMarketplaceMutation>;
export type InstallSkillFromMarketplaceMutationOptions = Apollo.BaseMutationOptions<InstallSkillFromMarketplaceMutation, InstallSkillFromMarketplaceMutationVariables>;
export const ToggleSkillEnabledDocument = gql`
    mutation ToggleSkillEnabled($skillDefinitionId: String!, $enabled: Boolean!) {
  toggleSkillEnabled(skillDefinitionId: $skillDefinitionId, enabled: $enabled) {
    id
    isEnabled
  }
}
    `;
export type ToggleSkillEnabledMutationFn = Apollo.MutationFunction<ToggleSkillEnabledMutation, ToggleSkillEnabledMutationVariables>;

/**
 * __useToggleSkillEnabledMutation__
 *
 * To run a mutation, you first call `useToggleSkillEnabledMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useToggleSkillEnabledMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [toggleSkillEnabledMutation, { data, loading, error }] = useToggleSkillEnabledMutation({
 *   variables: {
 *      skillDefinitionId: // value for 'skillDefinitionId'
 *      enabled: // value for 'enabled'
 *   },
 * });
 */
export function useToggleSkillEnabledMutation(baseOptions?: Apollo.MutationHookOptions<ToggleSkillEnabledMutation, ToggleSkillEnabledMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<ToggleSkillEnabledMutation, ToggleSkillEnabledMutationVariables>(ToggleSkillEnabledDocument, options);
      }
export type ToggleSkillEnabledMutationHookResult = ReturnType<typeof useToggleSkillEnabledMutation>;
export type ToggleSkillEnabledMutationResult = Apollo.MutationResult<ToggleSkillEnabledMutation>;
export type ToggleSkillEnabledMutationOptions = Apollo.BaseMutationOptions<ToggleSkillEnabledMutation, ToggleSkillEnabledMutationVariables>;
export const UpdateSkillDefinitionRuntimeDocument = gql`
    mutation UpdateSkillDefinitionRuntime($where: SkillDefinitionWhereUniqueInput!, $data: UpdateSkillDefinitionRuntimeInput!) {
  updateSkillDefinitionRuntime(where: $where, data: $data) {
    id
  }
}
    `;
export type UpdateSkillDefinitionRuntimeMutationFn = Apollo.MutationFunction<UpdateSkillDefinitionRuntimeMutation, UpdateSkillDefinitionRuntimeMutationVariables>;

/**
 * __useUpdateSkillDefinitionRuntimeMutation__
 *
 * To run a mutation, you first call `useUpdateSkillDefinitionRuntimeMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateSkillDefinitionRuntimeMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateSkillDefinitionRuntimeMutation, { data, loading, error }] = useUpdateSkillDefinitionRuntimeMutation({
 *   variables: {
 *      where: // value for 'where'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateSkillDefinitionRuntimeMutation(baseOptions?: Apollo.MutationHookOptions<UpdateSkillDefinitionRuntimeMutation, UpdateSkillDefinitionRuntimeMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateSkillDefinitionRuntimeMutation, UpdateSkillDefinitionRuntimeMutationVariables>(UpdateSkillDefinitionRuntimeDocument, options);
      }
export type UpdateSkillDefinitionRuntimeMutationHookResult = ReturnType<typeof useUpdateSkillDefinitionRuntimeMutation>;
export type UpdateSkillDefinitionRuntimeMutationResult = Apollo.MutationResult<UpdateSkillDefinitionRuntimeMutation>;
export type UpdateSkillDefinitionRuntimeMutationOptions = Apollo.BaseMutationOptions<UpdateSkillDefinitionRuntimeMutation, UpdateSkillDefinitionRuntimeMutationVariables>;