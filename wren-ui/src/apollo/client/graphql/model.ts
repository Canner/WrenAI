import { gql } from '@apollo/client';

export const LIST_MODELS = gql`
  query ListModels {
    listModels {
      cached
      description
      name
      primaryKey
      refreshTime
      refSql
    }
  }
`;

export const GET_MODEL = gql`
  query GetModel($where: ModelWhereInput!) {
    getModel(where: $where) {
      name
      refSql
      primaryKey
      cached
      refreshTime
      description
      columns {
        name
        type
        isCalculated
        notNull
        properties
      }
      properties
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
