import { gql } from '@apollo/client';

const VIEW_FIELD = gql`
  fragment ViewField on DiagramViewField {
    id
    displayName
    referenceName
    type
    nodeType
    description
  }
`;

const RELATION_FIELD = gql`
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

const NESTED_FIELD = gql`
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

const FIELD = gql`
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
  ${NESTED_FIELD}
`;

export const DIAGRAM = gql`
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
  ${FIELD}
  ${RELATION_FIELD}
  ${VIEW_FIELD}
`;
