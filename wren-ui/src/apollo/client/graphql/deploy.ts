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

export const CONNECTION_INFO = gql`
  query ConnectionInfo {
    connectionInfo {
      database
      schema
      port
      username
      password
    }
  }
`;
