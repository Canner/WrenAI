import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { PreviewDataResponse } from './queryService';
import {
  AdjustmentReasoningInput,
  AdjustmentSqlInput,
  AskingDetailTaskInput,
  AskingDetailTaskUpdateInput,
  AskingPayload,
  AskingTaskInput,
  InstantRecommendedQuestionsInput,
  ThreadResponseAnswerStatus,
} from './askingServiceShared';
import {
  cancelAskingTaskAction,
  createAskingTaskAction,
  getAskingTaskAction,
  getAskingTaskByIdAction,
  rerunAskingTaskAction,
} from './askingServiceTaskActions';
import {
  assertAskingTaskScopeAction,
  assertAskingTaskScopeByIdAction,
  assertResponseScopeAction,
  assertThreadScopeAction,
  changeThreadResponseAnswerDetailStatusAction,
  createThreadAction,
  createThreadResponseAction,
  deleteAllThreadsByProjectIdAction,
  deleteThreadAction,
  getResponseAction,
  getResponsesWithThreadAction,
  listThreadsAction,
  updateThreadAction,
  updateThreadResponseAction,
} from './askingServiceThreadActions';
import {
  createInstantRecommendedQuestionsAction,
  generateThreadRecommendationQuestionsAction,
  getInstantRecommendedQuestionsAction,
  getThreadRecommendationQuestionsAction,
} from './askingServiceRecommendationActions';
import {
  adjustThreadResponseAnswerAction,
  adjustThreadResponseChartAction,
  adjustThreadResponseWithSQLAction,
  generateThreadResponseAnswerAction,
  generateThreadResponseBreakdownAction,
  generateThreadResponseChartAction,
  previewBreakdownDataAction,
  previewDataAction,
  rerunAdjustThreadResponseAnswerAction,
} from './askingServiceResponseActions';
import {
  initializeAskingService,
  resolveBreakdownBootstrapWorkspaceId as resolveBreakdownBootstrapWorkspaceIdSupport,
} from './askingServiceInitializationSupport';

export const applyAskingServiceActionPrototype = (AskingServiceClass: any) => {
  const proto = AskingServiceClass.prototype;

  proto.getThreadRecommendationQuestions = async function (threadId: number) {
    return getThreadRecommendationQuestionsAction(this, threadId);
  };
  proto.generateThreadRecommendationQuestions = async function (
    threadId: number,
    runtimeScopeId?: string | null,
  ) {
    return generateThreadRecommendationQuestionsAction(
      this,
      threadId,
      runtimeScopeId,
    );
  };
  proto.initialize = async function () {
    return initializeAskingService(this);
  };
  proto.resolveBreakdownBootstrapWorkspaceId = async function () {
    return resolveBreakdownBootstrapWorkspaceIdSupport(this);
  };
  proto.createAskingTask = async function (
    input: AskingTaskInput,
    payload: AskingPayload,
    rerunFromCancelled?: boolean,
    previousTaskId?: number,
    threadResponseId?: number,
  ) {
    return createAskingTaskAction(
      this,
      input,
      payload,
      rerunFromCancelled,
      previousTaskId,
      threadResponseId,
    );
  };
  proto.rerunAskingTask = async function (
    threadResponseId: number,
    payload: AskingPayload,
  ) {
    return rerunAskingTaskAction(this, threadResponseId, payload);
  };
  proto.cancelAskingTask = async function (taskId: string) {
    return cancelAskingTaskAction(this, taskId, this.telemetry);
  };
  proto.getAskingTask = async function (taskId: string) {
    return getAskingTaskAction(this, taskId);
  };
  proto.getAskingTaskById = async function (id: number) {
    return getAskingTaskByIdAction(this, id);
  };
  proto.createThread = async function (
    input: AskingDetailTaskInput,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return createThreadAction(this, input, runtimeIdentity);
  };
  proto.listThreads = async function (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return listThreadsAction(this, runtimeIdentity);
  };
  proto.assertThreadScope = async function (
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return assertThreadScopeAction(this, threadId, runtimeIdentity);
  };
  proto.assertAskingTaskScope = async function (
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return assertAskingTaskScopeAction(this, queryId, runtimeIdentity);
  };
  proto.assertAskingTaskScopeById = async function (
    taskId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return assertAskingTaskScopeByIdAction(this, taskId, runtimeIdentity);
  };
  proto.assertResponseScope = async function (
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return assertResponseScopeAction(this, responseId, runtimeIdentity);
  };
  proto.updateThread = async function (
    threadId: number,
    input: Partial<AskingDetailTaskUpdateInput>,
  ) {
    return updateThreadAction(this, threadId, input);
  };
  proto.updateThreadScoped = async function (
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: Partial<AskingDetailTaskUpdateInput>,
  ) {
    await this.assertThreadScope(threadId, runtimeIdentity);
    return this.updateThread(threadId, input);
  };
  proto.deleteThread = async function (threadId: number) {
    return deleteThreadAction(this, threadId);
  };
  proto.deleteThreadScoped = async function (
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    await this.assertThreadScope(threadId, runtimeIdentity);
    return this.deleteThread(threadId);
  };
  proto.createThreadResponse = async function (
    input: AskingDetailTaskInput,
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return createThreadResponseAction(this, input, threadId, runtimeIdentity);
  };
  proto.createThreadResponseScoped = async function (
    input: AskingDetailTaskInput,
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    await this.assertThreadScope(threadId, runtimeIdentity);
    return this.createThreadResponse(input, threadId, runtimeIdentity);
  };
  proto.updateThreadResponse = async function (
    responseId: number,
    data: { sql: string },
  ) {
    return updateThreadResponseAction(this, responseId, data);
  };
  proto.updateThreadResponseScoped = async function (
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    data: { sql: string },
  ) {
    await this.assertResponseScope(responseId, runtimeIdentity);
    return this.updateThreadResponse(responseId, data);
  };
  proto.generateThreadResponseBreakdown = async function (
    threadResponseId: number,
    configurations: { language: string },
  ) {
    return generateThreadResponseBreakdownAction(
      this,
      threadResponseId,
      configurations,
    );
  };
  proto.generateThreadResponseBreakdownScoped = async function (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
  ) {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.generateThreadResponseBreakdown(
      threadResponseId,
      configurations,
    );
  };
  proto.generateThreadResponseAnswer = async function (
    threadResponseId: number,
  ) {
    return generateThreadResponseAnswerAction(this, threadResponseId);
  };
  proto.generateThreadResponseAnswerScoped = async function (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
  ) {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.generateThreadResponseAnswer(threadResponseId, configurations);
  };
  proto.generateThreadResponseChart = async function (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ) {
    return generateThreadResponseChartAction(
      this,
      threadResponseId,
      runtimeIdentity,
      configurations,
      runtimeScopeId,
    );
  };
  proto.generateThreadResponseChartScoped = async function (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ) {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.generateThreadResponseChart(
      threadResponseId,
      runtimeIdentity,
      configurations,
      runtimeScopeId,
    );
  };
  proto.adjustThreadResponseChart = async function (
    threadResponseId: number,
    _runtimeIdentity: PersistedRuntimeIdentity,
    input: any,
  ) {
    return adjustThreadResponseChartAction(this, threadResponseId, input);
  };
  proto.adjustThreadResponseChartScoped = async function (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: any,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ) {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.adjustThreadResponseChart(
      threadResponseId,
      runtimeIdentity,
      input,
      configurations,
      runtimeScopeId,
    );
  };
  proto.getResponsesWithThread = async function (
    threadId: number,
    runtimeIdentity?: PersistedRuntimeIdentity,
  ) {
    return getResponsesWithThreadAction(this, threadId, runtimeIdentity);
  };
  proto.getResponsesWithThreadScoped = async function (
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    await this.assertThreadScope(threadId, runtimeIdentity);
    return this.getResponsesWithThread(threadId, runtimeIdentity);
  };
  proto.getResponse = async function (responseId: number) {
    return getResponseAction(this, responseId);
  };
  proto.getResponseScoped = async function (
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return this.assertResponseScope(responseId, runtimeIdentity);
  };
  proto.previewData = async function (
    responseId: number,
    limit?: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) {
    return previewDataAction(this, responseId, limit, fallbackRuntimeIdentity);
  };
  proto.previewDataScoped = async function (
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    limit?: number,
  ): Promise<PreviewDataResponse> {
    await this.assertResponseScope(responseId, runtimeIdentity);
    return this.previewData(responseId, limit, runtimeIdentity);
  };
  proto.previewBreakdownData = async function (
    responseId: number,
    stepIndex?: number,
    limit?: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) {
    return previewBreakdownDataAction(
      this,
      responseId,
      stepIndex,
      limit,
      fallbackRuntimeIdentity,
    );
  };
  proto.previewBreakdownDataScoped = async function (
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    stepIndex?: number,
    limit?: number,
  ) {
    await this.assertResponseScope(responseId, runtimeIdentity);
    return this.previewBreakdownData(
      responseId,
      stepIndex,
      limit,
      runtimeIdentity,
    );
  };
  proto.createInstantRecommendedQuestions = async function (
    input: InstantRecommendedQuestionsInput,
    runtimeIdentity: PersistedRuntimeIdentity,
    runtimeScopeId?: string | null,
  ) {
    return createInstantRecommendedQuestionsAction(
      this,
      input,
      runtimeIdentity,
      runtimeScopeId,
    );
  };
  proto.getInstantRecommendedQuestions = async function (
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return getInstantRecommendedQuestionsAction(this, queryId, runtimeIdentity);
  };
  proto.deleteAllByProjectId = async function (projectId: number) {
    return deleteAllThreadsByProjectIdAction(this, projectId);
  };
  proto.changeThreadResponseAnswerDetailStatus = async function (
    responseId: number,
    status: ThreadResponseAnswerStatus,
    content?: string,
  ) {
    return changeThreadResponseAnswerDetailStatusAction(
      this,
      responseId,
      status,
      content,
    );
  };
  proto.changeThreadResponseAnswerDetailStatusScoped = async function (
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    status: ThreadResponseAnswerStatus,
    content?: string,
  ) {
    await this.assertResponseScope(responseId, runtimeIdentity);
    return this.changeThreadResponseAnswerDetailStatus(
      responseId,
      status,
      content,
    );
  };
  proto.adjustThreadResponseWithSQL = async function (
    threadResponseId: number,
    input: AdjustmentSqlInput,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) {
    return adjustThreadResponseWithSQLAction(
      this,
      threadResponseId,
      input,
      fallbackRuntimeIdentity,
    );
  };
  proto.adjustThreadResponseWithSQLScoped = async function (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: AdjustmentSqlInput,
  ) {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.adjustThreadResponseWithSQL(
      threadResponseId,
      input,
      runtimeIdentity,
    );
  };
  proto.adjustThreadResponseAnswer = async function (
    threadResponseId: number,
    input: AdjustmentReasoningInput,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ) {
    return adjustThreadResponseAnswerAction(
      this,
      threadResponseId,
      input,
      configurations,
      runtimeScopeId,
    );
  };
  proto.adjustThreadResponseAnswerScoped = async function (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: AdjustmentReasoningInput,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ) {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.adjustThreadResponseAnswer(
      threadResponseId,
      input,
      configurations,
      runtimeScopeId,
    );
  };
  proto.cancelAdjustThreadResponseAnswer = async function (taskId: string) {
    return this.adjustmentBackgroundTracker.cancelAdjustmentTask(taskId);
  };
  proto.rerunAdjustThreadResponseAnswer = async function (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ) {
    return rerunAdjustThreadResponseAnswerAction(
      this,
      threadResponseId,
      runtimeIdentity,
      configurations,
      runtimeScopeId,
    );
  };
  proto.getAdjustmentTask = async function (taskId: string) {
    return this.adjustmentBackgroundTracker.getAdjustmentResult(taskId);
  };
  proto.getAdjustmentTaskById = async function (id: number) {
    return this.adjustmentBackgroundTracker.getAdjustmentResultById(id);
  };
};
