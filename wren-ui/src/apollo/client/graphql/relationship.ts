import { gql } from '@apollo/client';

export const CREATE_RELATIONSHIP = gql`
  mutation CreateRelationship($data: RelationInput!) {
    createRelation(data: $data)
  }
`;

export const UPDATE_RELATIONSHIP = gql`
  mutation UpdateRelationship(
    $where: WhereIdInput!
    $data: UpdateRelationInput!
  ) {
    updateRelation(where: $where, data: $data)
  }
`;

export const DELETE_RELATIONSHIP = gql`
  mutation DeleteRelationship($where: WhereIdInput!) {
    deleteRelation(where: $where)
  }
`;
