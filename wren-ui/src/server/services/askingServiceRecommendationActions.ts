import { RecommendationQuestionStatus } from '@server/models/adaptor';
import {
  normalizeCanonicalPersistedRuntimeIdentity,
  resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback,
  toPersistedRuntimeIdentityFromSource,
} from '@server/utils/persistedRuntimeIdentity';
import {
  InstantRecommendedQuestionsInput,
  isRecommendationQuestionsFinalized,
  RecommendQuestionResultStatus,
  Task,
  ThreadRecommendQuestionResult,
} from './askingServiceShared';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';

interface AskingRecommendationServiceLike {
  generateThreadRecommendationQuestions(
    threadId: number,
    runtimeScopeId?: string | null,
  ): Promise<void>;
  threadRepository: Pick<any, 'findOneBy' | 'updateOne'>;
  threadResponseRepository: Pick<any, 'findAllBy'>;
  threadRecommendQuestionBackgroundTracker: Pick<any, 'isExist' | 'addTask'>;
  wrenAIAdaptor: Pick<
    any,
    'generateRecommendationQuestions' | 'getRecommendationQuestionsResult'
  >;
  instantRecommendedQuestionTasks: Map<string, any>;
  getExecutionResources(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<any>;
  toAskRuntimeIdentity(runtimeIdentity?: PersistedRuntimeIdentity | null): any;
  getThreadRecommendationQuestionsConfig(project: any): any;
  isLikelyNonChineseQuestions(questions: any[] | undefined | null): boolean;
  shouldForceChineseThreadRecommendation(thread: any): Promise<boolean>;
  trackInstantRecommendedQuestionTask(
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): void;
  assertInstantRecommendedQuestionTaskScope(
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): void;
}

export const getThreadRecommendationQuestionsAction = async (
  service: AskingRecommendationServiceLike,
  threadId: number,
): Promise<ThreadRecommendQuestionResult> => {
  const thread = await service.threadRepository.findOneBy({ id: threadId });
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  const res: ThreadRecommendQuestionResult = {
    status: RecommendQuestionResultStatus.NOT_STARTED,
    questions: [],
    error: undefined,
  };
  if (thread.queryId && thread.questionsStatus) {
    const mappedStatus =
      thread.questionsStatus as keyof typeof RecommendQuestionResultStatus;
    res.status = RecommendQuestionResultStatus[mappedStatus] || res.status;
    res.questions = thread.questions || [];
    res.error = thread.questionsError || undefined;

    const shouldRegenerateInChinese =
      res.status === RecommendQuestionResultStatus.FINISHED &&
      service.isLikelyNonChineseQuestions(res.questions) &&
      (await service.shouldForceChineseThreadRecommendation(thread));

    if (shouldRegenerateInChinese) {
      await service.generateThreadRecommendationQuestions(threadId);
      return {
        status: RecommendQuestionResultStatus.GENERATING,
        questions: [],
        error: undefined,
      };
    }
  }
  return res;
};

export const generateThreadRecommendationQuestionsAction = async (
  service: AskingRecommendationServiceLike,
  threadId: number,
  runtimeScopeId?: string | null,
): Promise<void> => {
  const thread = await service.threadRepository.findOneBy({ id: threadId });
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  if (service.threadRecommendQuestionBackgroundTracker.isExist(thread)) {
    return;
  }

  const runtimeIdentity = toPersistedRuntimeIdentityFromSource(thread);
  const { project, manifest } =
    await service.getExecutionResources(runtimeIdentity);
  const threadResponses = await service.threadResponseRepository.findAllBy({
    threadId,
  });
  const slicedThreadResponses = threadResponses
    .sort((a: any, b: any) => b.id - a.id)
    .slice(0, 5);
  const questions = slicedThreadResponses.map(({ question }: any) => question);
  const recommendQuestionRuntimeIdentity =
    normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);
  const recommendQuestionData = {
    manifest,
    runtimeScopeId:
      runtimeScopeId ||
      resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
        recommendQuestionRuntimeIdentity,
      ) ||
      undefined,
    runtimeIdentity: service.toAskRuntimeIdentity(
      recommendQuestionRuntimeIdentity,
    ),
    previousQuestions: questions,
    ...service.getThreadRecommendationQuestionsConfig(project),
  };

  const result = await service.wrenAIAdaptor.generateRecommendationQuestions(
    recommendQuestionData,
  );
  const updatedThread = await service.threadRepository.updateOne(threadId, {
    queryId: result.queryId,
    questionsStatus: RecommendationQuestionStatus.GENERATING,
    questions: [],
    questionsError: undefined,
  });
  service.threadRecommendQuestionBackgroundTracker.addTask(updatedThread);
};

export const createInstantRecommendedQuestionsAction = async (
  service: AskingRecommendationServiceLike,
  input: InstantRecommendedQuestionsInput,
  runtimeIdentity: PersistedRuntimeIdentity,
  runtimeScopeId?: string | null,
): Promise<Task> => {
  const { project, manifest } =
    await service.getExecutionResources(runtimeIdentity);
  const recommendQuestionRuntimeIdentity =
    normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);
  const response = await service.wrenAIAdaptor.generateRecommendationQuestions({
    manifest,
    runtimeScopeId: runtimeScopeId || undefined,
    runtimeIdentity: service.toAskRuntimeIdentity(
      recommendQuestionRuntimeIdentity,
    ),
    previousQuestions: input.previousQuestions,
    ...service.getThreadRecommendationQuestionsConfig(project),
  });
  service.trackInstantRecommendedQuestionTask(
    response.queryId,
    runtimeIdentity,
  );
  return { id: response.queryId };
};

export const getInstantRecommendedQuestionsAction = async (
  service: AskingRecommendationServiceLike,
  queryId: string,
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  service.assertInstantRecommendedQuestionTaskScope(queryId, runtimeIdentity);
  const response =
    await service.wrenAIAdaptor.getRecommendationQuestionsResult(queryId);
  if (isRecommendationQuestionsFinalized(response.status)) {
    service.instantRecommendedQuestionTasks.delete(queryId);
  }
  return response;
};
