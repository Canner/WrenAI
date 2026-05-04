import { gql } from '@apollo/client';

const COMMON_COLUMN = gql`
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

const COMMON_FIELD = gql`
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

const COMMON_RELATION = gql`
  fragment CommonRelation on DetailedRelation {
    fromModelId
    fromColumnId
    toModelId
    toColumnId
    type
    name
  }
`;

export const LIST_MODELS = gql`
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
  ${COMMON_FIELD}
`;

export const GET_MODEL = gql`
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
  ${COMMON_COLUMN}
  ${COMMON_RELATION}
`;

export const CREATE_MODEL = gql`
  mutation CreateModel($data: CreateModelInput!) {
    createModel(data: $data)
  }
`;

export const UPDATE_MODEL = gql`
  mutation UpdateModel($where: ModelWhereInput!, $data: UpdateModelInput!) {
    updateModel(where: $where, data: $data)
  }
`;

export const DELETE_MODEL = gql`
  mutation DeleteModel($where: ModelWhereInput!) {
    deleteModel(where: $where)
  }
`;

export const PREVIEW_MODEL_DATA = gql`
  mutation PreviewModelData($where: WhereIdInput!) {
    previewModelData(where: $where)
  }
`;
