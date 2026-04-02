import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type RuntimeSelectorStateQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type RuntimeSelectorStateQuery = { __typename?: 'Query', runtimeSelectorState?: { __typename?: 'RuntimeSelectorState', currentProjectId?: number | null, currentWorkspace?: { __typename?: 'RuntimeSelectorWorkspace', id: string, slug: string, name: string } | null, currentKnowledgeBase?: { __typename?: 'RuntimeSelectorKnowledgeBase', id: string, slug: string, name: string, defaultKbSnapshotId?: string | null } | null, currentKbSnapshot?: { __typename?: 'RuntimeSelectorKBSnapshot', id: string, snapshotKey: string, displayName: string, deployHash: string, status: string } | null, knowledgeBases: Array<{ __typename?: 'RuntimeSelectorKnowledgeBase', id: string, slug: string, name: string, defaultKbSnapshotId?: string | null }>, kbSnapshots: Array<{ __typename?: 'RuntimeSelectorKBSnapshot', id: string, snapshotKey: string, displayName: string, deployHash: string, status: string }> } | null };


export const RuntimeSelectorStateDocument = gql`
    query RuntimeSelectorState {
  runtimeSelectorState {
    currentProjectId
    currentWorkspace {
      id
      slug
      name
    }
    currentKnowledgeBase {
      id
      slug
      name
      defaultKbSnapshotId
    }
    currentKbSnapshot {
      id
      snapshotKey
      displayName
      deployHash
      status
    }
    knowledgeBases {
      id
      slug
      name
      defaultKbSnapshotId
    }
    kbSnapshots {
      id
      snapshotKey
      displayName
      deployHash
      status
    }
  }
}
    `;

/**
 * __useRuntimeSelectorStateQuery__
 *
 * To run a query within a React component, call `useRuntimeSelectorStateQuery` and pass it any options that fit your needs.
 * When your component renders, `useRuntimeSelectorStateQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useRuntimeSelectorStateQuery({
 *   variables: {
 *   },
 * });
 */
export function useRuntimeSelectorStateQuery(baseOptions?: Apollo.QueryHookOptions<RuntimeSelectorStateQuery, RuntimeSelectorStateQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<RuntimeSelectorStateQuery, RuntimeSelectorStateQueryVariables>(RuntimeSelectorStateDocument, options);
      }
export function useRuntimeSelectorStateLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<RuntimeSelectorStateQuery, RuntimeSelectorStateQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<RuntimeSelectorStateQuery, RuntimeSelectorStateQueryVariables>(RuntimeSelectorStateDocument, options);
        }
export type RuntimeSelectorStateQueryHookResult = ReturnType<typeof useRuntimeSelectorStateQuery>;
export type RuntimeSelectorStateLazyQueryHookResult = ReturnType<typeof useRuntimeSelectorStateLazyQuery>;
export type RuntimeSelectorStateQueryResult = Apollo.QueryResult<RuntimeSelectorStateQuery, RuntimeSelectorStateQueryVariables>;