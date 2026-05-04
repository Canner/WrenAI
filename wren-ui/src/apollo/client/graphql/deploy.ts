import { gql } from '@apollo/client';

export const DEPLOY = gql`
  mutation Deploy {
    deploy
  }
`;

export const GET_DEPLOY_STATUS = gql`
  query DeployStatus {
    modelSync {
      status
    }
  }
`;
