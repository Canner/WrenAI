import { gql } from '@apollo/client';

export const PREVIEW_SQL_STATEMENT = gql`
  mutation PreviewSQL($data: PreviewSQLDataInput!) {
    previewSql(data: $data)
  }
`;
