import { gql } from '@apollo/client';

export const GET_SETTINGS = gql`
  query GetSettings {
    settings {
      productVersion
      dataSource {
        type
        properties
        sampleDataset
      }
      language
    }
  }
`;

export const RESET_CURRENT_PROJECT = gql`
  mutation ResetCurrentProject {
    resetCurrentProject
  }
`;

export const UPDATE_CURRENT_PROJECT = gql`
  mutation UpdateCurrentProject($data: UpdateCurrentProjectInput!) {
    updateCurrentProject(data: $data)
  }
`;
