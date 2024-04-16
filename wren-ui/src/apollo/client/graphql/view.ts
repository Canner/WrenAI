import { gql } from '@apollo/client';

export const CREATE_VIEW = gql`
  mutation CreateView($data: CreateViewInput!) {
    createView(data: $data) {
      id
      name
      statement
    }
  }
`;

export const DELETE_VIEW = gql`
  mutation DeleteView($where: ViewWhereUniqueInput!) {
    deleteView(where: $where)
  }
`;

export const GET_VIEW = gql`
  query GetView($where: ViewWhereUniqueInput!) {
    view(where: $ViewWhereUniqueInput) {
      id
      name
      statement
    }
  }
`;

export const LIST_VIEWS = gql`
  query ListViews {
    listViews {
      id
      name
      statement
    }
  }
`;

export const PREVIEW_VIEW_DATA = gql`
  mutation PreviewViewData($where: ViewWhereUniqueInput!) {
    previewViewData(where: $data)
  }
`;

export const VALIDATE_CREATE_VIEW = gql`
  mutation ValidateView($data: ValidateViewInput!) {
    validateView(data: $data) {
      valid
      message
    }
  }
`;
