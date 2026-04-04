import { gql } from '@apollo/client';

export const API_HISTORY = gql`
  query ApiHistory(
    $filter: ApiHistoryFilterInput
    $pagination: ApiHistoryPaginationInput!
  ) {
    apiHistory(filter: $filter, pagination: $pagination) {
      items {
        id
        projectId
        apiType
        threadId
        headers
        requestPayload
        responsePayload
        statusCode
        durationMs
        createdAt
        updatedAt
      }
      total
      hasMore
    }
  }
`;

export const ASK_SHADOW_COMPARE_STATS = gql`
  query AskShadowCompareStats($filter: ApiHistoryFilterInput) {
    askShadowCompareStats(filter: $filter) {
      total
      withDiagnostics
      enabled
      executed
      comparable
      matched
      mismatched
      errorCount
      byAskPath {
        key
        count
      }
      byShadowErrorType {
        key
        count
      }
      trends {
        date
        total
        executed
        comparable
        matched
        mismatched
        errorCount
      }
    }
  }
`;
