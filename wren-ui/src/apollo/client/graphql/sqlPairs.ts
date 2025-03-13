import { gql } from '@apollo/client';

const SQL_PAIR = gql`
  fragment SqlPair on SqlPair {
    id
    projectId
    sql
    question
  }
`;

export const LIST_SQL_PAIRS = gql`
  query SqlPairs {
    sqlPairs {
      ...SqlPair
    }
  }

  ${SQL_PAIR}
`;

export const CREATE_SQL_PAIR = gql`
  mutation CreateSqlPair($data: CreateSqlPairInput!) {
    createSqlPair(data: $data) {
      ...SqlPair
    }
  }

  ${SQL_PAIR}
`;

export const UPDATE_SQL_PAIR = gql`
  mutation UpdateSqlPair(
    $where: SqlPairWhereUniqueInput!
    $data: UpdateSqlPairInput!
  ) {
    updateSqlPair(where: $where, data: $data) {
      ...SqlPair
    }
  }

  ${SQL_PAIR}
`;

export const DELETE_SQL_PAIR = gql`
  mutation DeleteSqlPair($where: SqlPairWhereUniqueInput!) {
    deleteSqlPair(where: $where)
  }
`;
