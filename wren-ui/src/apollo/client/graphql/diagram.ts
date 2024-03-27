import { gql } from '@apollo/client';

const RELATION_FIELD = gql`
  fragment RelationField on DiagramModelRelationField {
    id
    relationId
    type
    nodeType
    displayName
    referenceName
    fromModelName
    fromColumnName
    toModelName
    toColumnName
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
  }
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
    }
  }
  ${FIELD}
  ${RELATION_FIELD}
`;
