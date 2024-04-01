import { gql } from '@apollo/client';

export const LIST_MODELS = gql`
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

export const GET_MODEL = gql`
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
        # properties
      }
      relations {
        fromModelId
        fromColumnId
        toModelId
        toColumnId
        type
        name
      }
      # properties
    }
  }
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
