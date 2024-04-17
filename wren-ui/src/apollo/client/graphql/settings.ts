import { gql } from '@apollo/client';

export const GET_SETTINGS = gql`
  query GetSettings {
    settings {
      dataSource {
        type
        properties
        sampleDataset
      }
    }
  }
`;

export const RESET_CURRENT_PROJECT = gql`
  mutation ResetCurrentProject {
    resetCurrentProject
  }
`;
