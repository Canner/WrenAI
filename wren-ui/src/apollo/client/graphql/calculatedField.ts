import { gql } from '@apollo/client';

export const VALIDATE_CALCULATED_FIELD = gql`
  mutation ValidateCalculatedField($data: ValidateCalculatedFieldInput!) {
    validateCalculatedField(data: $data) {
      message
      valid
    }
  }
`;

export const CREATE_CALCULATED_FIELD = gql`
  mutation CreateCalculatedField($data: CreateCalculatedFieldInput!) {
    createCalculatedField(data: $data)
  }
`;

export const UPDATE_CALCULATED_FIELD = gql`
  mutation UpdateCalculatedField(
    $where: UpdateCalculatedFieldWhere!
    $data: UpdateCalculatedFieldInput!
  ) {
    updateCalculatedField(where: $where, data: $data)
  }
`;

export const DELETE_CALCULATED_FIELD = gql`
  mutation DeleteCalculatedField($where: UpdateCalculatedFieldWhere!) {
    deleteCalculatedField(where: $where)
  }
`;
