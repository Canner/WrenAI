import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type ViewFieldFragment = { __typename?: 'DiagramViewField', id: string, displayName: string, referenceName: string, type: string, nodeType: Types.NodeType, description?: string | null };

export type RelationFieldFragment = { __typename?: 'DiagramModelRelationField', id: string, relationId: number, type: Types.RelationType, nodeType: Types.NodeType, displayName: string, referenceName: string, fromModelId: number, fromModelName: string, fromModelDisplayName: string, fromColumnId: number, fromColumnName: string, fromColumnDisplayName: string, toModelId: number, toModelName: string, toModelDisplayName: string, toColumnId: number, toColumnName: string, toColumnDisplayName: string, description?: string | null };

export type NestedFieldFragment = { __typename?: 'DiagramModelNestedField', id: string, nestedColumnId: number, columnPath: Array<string>, type: string, displayName: string, referenceName: string, description?: string | null };

export type FieldFragment = { __typename?: 'DiagramModelField', id: string, columnId: number, type: string, nodeType: Types.NodeType, displayName: string, referenceName: string, description?: string | null, isPrimaryKey: boolean, expression?: string | null, aggregation?: string | null, lineage?: Array<number> | null, nestedFields?: Array<{ __typename?: 'DiagramModelNestedField', id: string, nestedColumnId: number, columnPath: Array<string>, type: string, displayName: string, referenceName: string, description?: string | null }> | null };

export type DiagramQueryVariables = Types.Exact<{ [key: string]: never; }>;


export type DiagramQuery = { __typename?: 'Query', diagram: { __typename?: 'Diagram', models: Array<{ __typename?: 'DiagramModel', id: string, modelId: number, nodeType: Types.NodeType, displayName: string, referenceName: string, sourceTableName: string, refSql?: string | null, cached: boolean, refreshTime?: string | null, description?: string | null, fields: Array<{ __typename?: 'DiagramModelField', id: string, columnId: number, type: string, nodeType: Types.NodeType, displayName: string, referenceName: string, description?: string | null, isPrimaryKey: boolean, expression?: string | null, aggregation?: string | null, lineage?: Array<number> | null, nestedFields?: Array<{ __typename?: 'DiagramModelNestedField', id: string, nestedColumnId: number, columnPath: Array<string>, type: string, displayName: string, referenceName: string, description?: string | null }> | null } | null>, calculatedFields: Array<{ __typename?: 'DiagramModelField', id: string, columnId: number, type: string, nodeType: Types.NodeType, displayName: string, referenceName: string, description?: string | null, isPrimaryKey: boolean, expression?: string | null, aggregation?: string | null, lineage?: Array<number> | null, nestedFields?: Array<{ __typename?: 'DiagramModelNestedField', id: string, nestedColumnId: number, columnPath: Array<string>, type: string, displayName: string, referenceName: string, description?: string | null }> | null } | null>, relationFields: Array<{ __typename?: 'DiagramModelRelationField', id: string, relationId: number, type: Types.RelationType, nodeType: Types.NodeType, displayName: string, referenceName: string, fromModelId: number, fromModelName: string, fromModelDisplayName: string, fromColumnId: number, fromColumnName: string, fromColumnDisplayName: string, toModelId: number, toModelName: string, toModelDisplayName: string, toColumnId: number, toColumnName: string, toColumnDisplayName: string, description?: string | null } | null> } | null>, views: Array<{ __typename?: 'DiagramView', id: string, viewId: number, nodeType: Types.NodeType, displayName: string, description?: string | null, referenceName: string, statement: string, fields: Array<{ __typename?: 'DiagramViewField', id: string, displayName: string, referenceName: string, type: string, nodeType: Types.NodeType, description?: string | null } | null> } | null> } };

export const ViewFieldFragmentDoc = gql`
    fragment ViewField on DiagramViewField {
  id
  displayName
  referenceName
  type
  nodeType
  description
}
    `;
export const RelationFieldFragmentDoc = gql`
    fragment RelationField on DiagramModelRelationField {
  id
  relationId
  type
  nodeType
  displayName
  referenceName
  fromModelId
  fromModelName
  fromModelDisplayName
  fromColumnId
  fromColumnName
  fromColumnDisplayName
  toModelId
  toModelName
  toModelDisplayName
  toColumnId
  toColumnName
  toColumnDisplayName
  description
}
    `;
export const NestedFieldFragmentDoc = gql`
    fragment NestedField on DiagramModelNestedField {
  id
  nestedColumnId
  columnPath
  type
  displayName
  referenceName
  description
}
    `;
export const FieldFragmentDoc = gql`
    fragment Field on DiagramModelField {
  id
  columnId
  type
  nodeType
  displayName
  referenceName
  description
  isPrimaryKey
  expression
  aggregation
  lineage
  nestedFields {
    ...NestedField
  }
}
    ${NestedFieldFragmentDoc}`;
export const DiagramDocument = gql`
    query Diagram {
  diagram {
    models {
      id
      modelId
      nodeType
      displayName
      referenceName
      sourceTableName
      refSql
      cached
      refreshTime
      description
      fields {
        ...Field
      }
      calculatedFields {
        ...Field
      }
      relationFields {
        ...RelationField
      }
    }
    views {
      id
      viewId
      nodeType
      displayName
      description
      referenceName
      statement
      fields {
        ...ViewField
      }
    }
  }
}
    ${FieldFragmentDoc}
${RelationFieldFragmentDoc}
${ViewFieldFragmentDoc}`;

/**
 * __useDiagramQuery__
 *
 * To run a query within a React component, call `useDiagramQuery` and pass it any options that fit your needs.
 * When your component renders, `useDiagramQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useDiagramQuery({
 *   variables: {
 *   },
 * });
 */
export function useDiagramQuery(baseOptions?: Apollo.QueryHookOptions<DiagramQuery, DiagramQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<DiagramQuery, DiagramQueryVariables>(DiagramDocument, options);
      }
export function useDiagramLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<DiagramQuery, DiagramQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<DiagramQuery, DiagramQueryVariables>(DiagramDocument, options);
        }
export type DiagramQueryHookResult = ReturnType<typeof useDiagramQuery>;
export type DiagramLazyQueryHookResult = ReturnType<typeof useDiagramLazyQuery>;
export type DiagramQueryResult = Apollo.QueryResult<DiagramQuery, DiagramQueryVariables>;