import { gql } from '@apollo/client';

export const UPDATE_MODEL_METADATA = gql`
  mutation UpdateModelMetadata(
    $where: ModelWhereInput!
    $data: UpdateModelMetadataInput!
  ) {
    updateModelMetadata(where: $where, data: $data)
  }
`;

export const UPDATE_VIEW_METADATA = gql`
  mutation UpdateViewMetadata(
    $where: ViewWhereUniqueInput!
    $data: UpdateViewMetadataInput!
  ) {
    updateViewMetadata(where: $where, data: $data)
  }
`;
