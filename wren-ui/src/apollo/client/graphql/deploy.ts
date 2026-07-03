import { gql } from '@apollo/client';

export const DEPLOY = gql`
  mutation Deploy($force: Boolean) {
    deploy(force: $force)
  }
`;

export const GET_DEPLOY_STATUS = gql`
  query DeployStatus {
    modelSync {
      status
    }
  }
`;
