import { gql } from '@apollo/client';

export const MANIFEST = gql`
  query Manifest {
    manifest
  }
`;

export const SAVE_MDL = gql`
  mutation SaveMDL($data: MDLInput!) {
    saveMDL(data: $data)
  }
`;
