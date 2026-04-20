import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { ThreadResponse } from '../repositories/threadResponseRepository';
import { Project } from '../repositories';
import { Deploy } from '../repositories/deployLogRepository';
import { AskingPayload } from './askingServiceShared';
import {
  assertInstantRecommendedQuestionTaskScope as assertInstantRecommendedQuestionTaskScopeSupport,
  buildAskTaskRuntimeIdentity as buildAskTaskRuntimeIdentitySupport,
  buildManifestBackedProject as buildManifestBackedProjectSupport,
  buildPersistedRuntimeIdentityPatch as buildPersistedRuntimeIdentityPatchSupport,
  ensureTrackedAskingTaskPersisted as ensureTrackedAskingTaskPersistedSupport,
  getDeployId as getDeployIdSupport,
  getExecutionResources as getExecutionResourcesSupport,
  getProjectAndDeployment as getProjectAndDeploymentSupport,
  getThreadById as getThreadByIdSupport,
  getThreadRecommendationQuestionsConfig as getThreadRecommendationQuestionsConfigSupport,
  getThreadResponseRuntimeIdentity as getThreadResponseRuntimeIdentitySupport,
  getThreadRuntimeIdentity as getThreadRuntimeIdentitySupport,
  isLikelyNonChineseQuestions as isLikelyNonChineseQuestionsSupport,
  mapManifestDataSourceToProjectType as mapManifestDataSourceToProjectTypeSupport,
  normalizeRuntimeScope as normalizeRuntimeScopeSupport,
  resolveAskingRuntimeIdentity as resolveAskingRuntimeIdentitySupport,
  resolveRetrievalScopeIds as resolveRetrievalScopeIdsSupport,
  resolveRuntimeIdentityFromKnowledgeSelection as resolveRuntimeIdentityFromKnowledgeSelectionSupport,
  resolveScopedKnowledgeBaseIds as resolveScopedKnowledgeBaseIdsSupport,
  resolveScopedSelectedSkillIds as resolveScopedSelectedSkillIdsSupport,
  shouldForceChineseThreadRecommendation as shouldForceChineseThreadRecommendationSupport,
  toAskRuntimeIdentity as toAskRuntimeIdentitySupport,
  trackInstantRecommendedQuestionTask as trackInstantRecommendedQuestionTaskSupport,
} from './askingServiceRuntimeSupport';

export const applyAskingServiceHelperPrototype = (AskingServiceClass: any) => {
  const proto = AskingServiceClass.prototype;

  proto.getDeployId = async function (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return getDeployIdSupport(this, runtimeIdentity);
  };
  proto.getProjectAndDeployment = async function (
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<{ project: Project; deployment: Deploy }> {
    return getProjectAndDeploymentSupport(this, runtimeIdentity);
  };
  proto.resolveScopedKnowledgeBaseIds = function (
    inputKnowledgeBaseIds?: string[] | null,
    thread?: any,
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ) {
    return resolveScopedKnowledgeBaseIdsSupport(
      inputKnowledgeBaseIds,
      thread,
      runtimeIdentity,
    );
  };
  proto.resolveRuntimeIdentityFromKnowledgeSelection = async function (
    runtimeIdentity: PersistedRuntimeIdentity,
    knowledgeBaseIds: string[],
  ) {
    return resolveRuntimeIdentityFromKnowledgeSelectionSupport(
      this,
      runtimeIdentity,
      knowledgeBaseIds,
    );
  };
  proto.resolveScopedSelectedSkillIds = function (
    inputSelectedSkillIds?: string[] | null,
    thread?: any,
  ) {
    return resolveScopedSelectedSkillIdsSupport(inputSelectedSkillIds, thread);
  };
  proto.resolveRetrievalScopeIds = async function (
    knowledgeBaseIds: string[],
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return resolveRetrievalScopeIdsSupport(
      this,
      knowledgeBaseIds,
      runtimeIdentity,
    );
  };
  proto.resolveAskingRuntimeIdentity = function (
    payload: AskingPayload,
    threadRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) {
    return resolveAskingRuntimeIdentitySupport(payload, threadRuntimeIdentity);
  };
  proto.buildPersistedRuntimeIdentityPatch = function (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return buildPersistedRuntimeIdentityPatchSupport(runtimeIdentity);
  };
  proto.ensureTrackedAskingTaskPersisted = async function (
    queryId: string,
    question: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return ensureTrackedAskingTaskPersistedSupport(
      this,
      queryId,
      question,
      runtimeIdentity,
    );
  };
  proto.getThreadById = async function (threadId: number) {
    return getThreadByIdSupport(this, threadId);
  };
  proto.getThreadRuntimeIdentity = async function (
    threadId: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) {
    return getThreadRuntimeIdentitySupport(
      this,
      threadId,
      fallbackRuntimeIdentity,
    );
  };
  proto.getThreadResponseRuntimeIdentity = async function (
    threadResponse: ThreadResponse,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) {
    return getThreadResponseRuntimeIdentitySupport(
      this,
      threadResponse,
      fallbackRuntimeIdentity,
    );
  };
  proto.getExecutionResources = async function (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return getExecutionResourcesSupport(this, runtimeIdentity);
  };
  proto.getAskingHistory = async function (
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    excludeThreadResponseId?: number,
  ) {
    if (!threadId) {
      return [];
    }
    const scopedRuntimeIdentity =
      this.normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
    let responses =
      await this.threadResponseRepository.getResponsesWithThreadByScope(
        threadId,
        scopedRuntimeIdentity,
        10,
      );
    if (excludeThreadResponseId) {
      responses = responses.filter(
        (response: ThreadResponse) => response.id !== excludeThreadResponseId,
      );
    }
    return responses.filter((response: ThreadResponse) => response.sql);
  };
  proto.getThreadRecommendationQuestionsConfig = function (project: Project) {
    return getThreadRecommendationQuestionsConfigSupport(project);
  };
  proto.isLikelyNonChineseQuestions = function (
    questions: any[] | undefined | null,
  ) {
    return isLikelyNonChineseQuestionsSupport(questions as any);
  };
  proto.shouldForceChineseThreadRecommendation = async function (thread: any) {
    return shouldForceChineseThreadRecommendationSupport(this, thread);
  };
  proto.trackInstantRecommendedQuestionTask = function (
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return trackInstantRecommendedQuestionTaskSupport(
      this,
      queryId,
      runtimeIdentity,
    );
  };
  proto.assertInstantRecommendedQuestionTaskScope = function (
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return assertInstantRecommendedQuestionTaskScopeSupport(
      this,
      queryId,
      runtimeIdentity,
    );
  };
  proto.buildManifestBackedProject = function (deployment: Deploy) {
    return buildManifestBackedProjectSupport(deployment);
  };
  proto.mapManifestDataSourceToProjectType = function (dataSource: any) {
    return mapManifestDataSourceToProjectTypeSupport(dataSource);
  };
  proto.toAskRuntimeIdentity = function (
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ) {
    return toAskRuntimeIdentitySupport(runtimeIdentity);
  };
  proto.buildAskTaskRuntimeIdentity = function (
    runtimeIdentity: PersistedRuntimeIdentity,
    deployHash?: string | null,
  ) {
    return buildAskTaskRuntimeIdentitySupport(runtimeIdentity, deployHash);
  };
  proto.normalizeRuntimeScope = function (
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ) {
    return normalizeRuntimeScopeSupport(runtimeIdentity);
  };
};
