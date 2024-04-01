import { gql } from '@apollo/client';

const COMMON_ERROR = gql`
  fragment CommonError on Error {
    code
    message
  }
`;

const COMMON_RESPONSE = gql`
  fragment CommonResponse on ThreadResponse {
    id
    question
    status
    detail {
      description
      steps {
        summary
        sql
        cteName
      }
    }
  }
`;

export const ASKING_TASK = gql`
  query AskingTask($taskId: String!) {
    askingTask(taskId: $taskId) {
      status
      candidates {
        sql
        summary
      }
      error {
        ...CommonError
      }
    }
  }
  ${COMMON_ERROR}
`;

export const THREADS = gql`
  query Threads {
    threads {
      id
      sql
      summary
    }
  }
`;

export const THREAD = gql`
  query Thread($threadId: Int!) {
    thread(threadId: $threadId) {
      id
      sql
      summary
      responses {
        ...CommonResponse
        error {
          ...CommonError
        }
      }
    }
  }
  ${COMMON_RESPONSE}
  ${COMMON_ERROR}
`;

export const THREAD_RESPONSE = gql`
  query ThreadResponse($responseId: Int!) {
    threadResponse(responseId: $responseId) {
      ...CommonResponse
      error {
        ...CommonError
      }
    }
  }
  ${COMMON_RESPONSE}
  ${COMMON_ERROR}
`;

export const CREATE_ASKING_TASK = gql`
  mutation CreateAskingTask($data: AskingTaskInput!) {
    createAskingTask(data: $data) {
      id
    }
  }
`;

export const CANCEL_ASKING_TASK = gql`
  mutation CancelAskingTask($taskId: String!) {
    cancelAskingTask(taskId: $taskId)
  }
`;

export const CREATE_THREAD = gql`
  mutation CreateThread($data: CreateThreadInput!) {
    createThread(data: $data) {
      id
      sql
      summary
    }
  }
`;
