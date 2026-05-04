import { gql } from '@apollo/client';

const COMMON_ERROR = gql`
  fragment CommonError on Error {
    code
    shortMessage
    message
    stacktrace
  }
`;

const COMMON_BREAKDOWN_DETAIL = gql`
  fragment CommonBreakdownDetail on ThreadResponseBreakdownDetail {
    queryId
    status
    description
    steps {
      summary
      sql
      cteName
    }
    error {
      ...CommonError
    }
  }

  ${COMMON_ERROR}
`;

const COMMON_ANSWER_DETAIL = gql`
  fragment CommonAnswerDetail on ThreadResponseAnswerDetail {
    queryId
    status
    content
    numRowsUsedInLLM
    error {
      ...CommonError
    }
  }

  ${COMMON_ERROR}
`;

const COMMON_CHART_DETAIL = gql`
  fragment CommonChartDetail on ThreadResponseChartDetail {
    queryId
    status
    description
    chartType
    chartSchema
    error {
      ...CommonError
    }
    adjustment
  }
`;

const COMMON_ASKING_TASK = gql`
  fragment CommonAskingTask on AskingTask {
    status
    type
    candidates {
      sql
      type
      view {
        id
        name
        statement
        displayName
      }
      sqlPair {
        id
        question
        sql
        projectId
      }
    }
    error {
      ...CommonError
    }
    rephrasedQuestion
    intentReasoning
    sqlGenerationReasoning
    retrievedTables
    invalidSql
    traceId
    queryId
  }
  ${COMMON_ERROR}
`;

const COMMON_RESPONSE = gql`
  fragment CommonResponse on ThreadResponse {
    id
    threadId
    question
    sql
    view {
      id
      name
      statement
      displayName
    }
    breakdownDetail {
      ...CommonBreakdownDetail
    }
    answerDetail {
      ...CommonAnswerDetail
    }
    chartDetail {
      ...CommonChartDetail
    }
    askingTask {
      ...CommonAskingTask
    }
    adjustment {
      type
      payload
    }
    adjustmentTask {
      queryId
      status
      error {
        ...CommonError
      }
      sql
      traceId
      invalidSql
    }
  }

  ${COMMON_BREAKDOWN_DETAIL}
  ${COMMON_ANSWER_DETAIL}
  ${COMMON_CHART_DETAIL}
  ${COMMON_ASKING_TASK}
  ${COMMON_ERROR}
`;

const COMMON_RECOMMENDED_QUESTIONS_TASK = gql`
  fragment CommonRecommendedQuestionsTask on RecommendedQuestionsTask {
    status
    questions {
      question
      category
      sql
    }
    error {
      ...CommonError
    }
  }

  ${COMMON_ERROR}
`;

export const SUGGESTED_QUESTIONS = gql`
  query SuggestedQuestions {
    suggestedQuestions {
      questions {
        label
        question
      }
    }
  }
`;

export const ASKING_TASK = gql`
  query AskingTask($taskId: String!) {
    askingTask(taskId: $taskId) {
      ...CommonAskingTask
    }
  }
  ${COMMON_ASKING_TASK}
`;

export const THREADS = gql`
  query Threads {
    threads {
      id
      summary
    }
  }
`;

export const THREAD = gql`
  query Thread($threadId: Int!) {
    thread(threadId: $threadId) {
      id
      responses {
        ...CommonResponse
      }
    }
  }
  ${COMMON_RESPONSE}
`;

export const THREAD_RESPONSE = gql`
  query ThreadResponse($responseId: Int!) {
    threadResponse(responseId: $responseId) {
      ...CommonResponse
    }
  }
  ${COMMON_RESPONSE}
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

export const RERUN_ASKING_TASK = gql`
  mutation RerunAskingTask($responseId: Int!) {
    rerunAskingTask(responseId: $responseId) {
      id
    }
  }
`;

export const CREATE_THREAD = gql`
  mutation CreateThread($data: CreateThreadInput!) {
    createThread(data: $data) {
      id
    }
  }
`;

export const CREATE_THREAD_RESPONSE = gql`
  mutation CreateThreadResponse(
    $threadId: Int!
    $data: CreateThreadResponseInput!
  ) {
    createThreadResponse(threadId: $threadId, data: $data) {
      ...CommonResponse
    }
  }
  ${COMMON_RESPONSE}
`;

export const UPDATE_THREAD = gql`
  mutation UpdateThread(
    $where: ThreadUniqueWhereInput!
    $data: UpdateThreadInput!
  ) {
    updateThread(where: $where, data: $data) {
      id
      summary
    }
  }
`;

export const UPDATE_THREAD_RESPONSE = gql`
  mutation UpdateThreadResponse(
    $where: ThreadResponseUniqueWhereInput!
    $data: UpdateThreadResponseInput!
  ) {
    updateThreadResponse(where: $where, data: $data) {
      ...CommonResponse
    }
  }
  ${COMMON_RESPONSE}
`;

// For adjust reasoning steps or SQL
export const ADJUST_THREAD_RESPONSE = gql`
  mutation AdjustThreadResponse(
    $responseId: Int!
    $data: AdjustThreadResponseInput!
  ) {
    adjustThreadResponse(responseId: $responseId, data: $data) {
      ...CommonResponse
    }
  }
  ${COMMON_RESPONSE}
`;

export const DELETE_THREAD = gql`
  mutation DeleteThread($where: ThreadUniqueWhereInput!) {
    deleteThread(where: $where)
  }
`;

// For text-based answer & chart-based answer
export const PREVIEW_DATA = gql`
  mutation PreviewData($where: PreviewDataInput!) {
    previewData(where: $where)
  }
`;

export const PREVIEW_BREAKDOWN_DATA = gql`
  mutation PreviewBreakdownData($where: PreviewDataInput!) {
    previewBreakdownData(where: $where)
  }
`;

export const GET_NATIVE_SQL = gql`
  query GetNativeSQL($responseId: Int!) {
    nativeSql(responseId: $responseId)
  }
`;

export const CREATE_INSTANT_RECOMMENDED_QUESTIONS = gql`
  mutation CreateInstantRecommendedQuestions(
    $data: InstantRecommendedQuestionsInput!
  ) {
    createInstantRecommendedQuestions(data: $data) {
      id
    }
  }
`;

export const INSTANT_RECOMMENDED_QUESTIONS = gql`
  query InstantRecommendedQuestions($taskId: String!) {
    instantRecommendedQuestions(taskId: $taskId) {
      ...CommonRecommendedQuestionsTask
    }
  }
  ${COMMON_RECOMMENDED_QUESTIONS_TASK}
`;

export const GET_THREAD_RECOMMENDATION_QUESTIONS = gql`
  query GetThreadRecommendationQuestions($threadId: Int!) {
    getThreadRecommendationQuestions(threadId: $threadId) {
      ...CommonRecommendedQuestionsTask
    }
  }

  ${COMMON_RECOMMENDED_QUESTIONS_TASK}
`;

export const GET_PROJECT_RECOMMENDATION_QUESTIONS = gql`
  query GetProjectRecommendationQuestions {
    getProjectRecommendationQuestions {
      ...CommonRecommendedQuestionsTask
    }
  }

  ${COMMON_RECOMMENDED_QUESTIONS_TASK}
`;

export const GENERATE_PROJECT_RECOMMENDATION_QUESTIONS = gql`
  mutation GenerateProjectRecommendationQuestions {
    generateProjectRecommendationQuestions
  }
`;

export const GENERATE_THREAD_RECOMMENDATION_QUESTIONS = gql`
  mutation GenerateThreadRecommendationQuestions($threadId: Int!) {
    generateThreadRecommendationQuestions(threadId: $threadId)
  }
`;

export const GENERATE_THREAD_RESPONSE_ANSWER = gql`
  mutation GenerateThreadResponseAnswer($responseId: Int!) {
    generateThreadResponseAnswer(responseId: $responseId) {
      ...CommonResponse
    }
  }

  ${COMMON_RESPONSE}
`;

export const GENERATE_THREAD_RESPONSE_CHART = gql`
  mutation GenerateThreadResponseChart($responseId: Int!) {
    generateThreadResponseChart(responseId: $responseId) {
      ...CommonResponse
    }
  }
  ${COMMON_RESPONSE}
`;

export const ADJUST_THREAD_RESPONSE_CHART = gql`
  mutation AdjustThreadResponseChart(
    $responseId: Int!
    $data: AdjustThreadResponseChartInput!
  ) {
    adjustThreadResponseChart(responseId: $responseId, data: $data) {
      ...CommonResponse
    }
  }
  ${COMMON_RESPONSE}
`;

export const ADJUSTMENT_TASK = gql`
  query AdjustmentTask($taskId: String!) {
    adjustmentTask(taskId: $taskId) {
      queryId
      status
      error {
        code
        shortMessage
        message
        stacktrace
      }
      sql
      traceId
      invalidSql
    }
  }
`;

export const CANCEL_ADJUSTMENT_TASK = gql`
  mutation CancelAdjustmentTask($taskId: String!) {
    cancelAdjustmentTask(taskId: $taskId)
  }
`;

export const RERUN_ADJUSTMENT_TASK = gql`
  mutation RerunAdjustmentTask($responseId: Int!) {
    rerunAdjustmentTask(responseId: $responseId)
  }
`;
