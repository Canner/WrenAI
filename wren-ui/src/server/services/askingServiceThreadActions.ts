import { isEmpty } from 'lodash';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  IThreadResponseRepository,
  ThreadResponse,
} from '../repositories/threadResponseRepository';
import { Thread } from '../repositories/threadRepository';
import {
  isPersistedRuntimeIdentityMatch,
  toPersistedRuntimeIdentityFromSource,
} from '@server/utils/persistedRuntimeIdentity';
import {
  AskingDetailTaskInput,
  AskingDetailTaskUpdateInput,
} from './askingServiceShared';
import { normalizeRuntimeScope } from './askingServiceRuntimeSupport';
import { buildThreadResponseIntentState } from './threadResponseIntentState';

interface AskingServiceThreadLike {
  threadRepository: Pick<
    any,
    | 'createOne'
    | 'listAllTimeDescOrderByScope'
    | 'findOneByIdWithRuntimeScope'
    | 'findOneBy'
    | 'updateOne'
    | 'deleteOne'
    | 'deleteAllBy'
  >;
  threadResponseRepository: Pick<
    IThreadResponseRepository,
    | 'createOne'
    | 'findOneBy'
    | 'updateOne'
    | 'getResponsesWithThread'
    | 'getResponsesWithThreadByScope'
    | 'findOneByIdWithRuntimeScope'
  >;
  askingTaskTracker: Pick<any, 'bindThreadResponse'>;
  buildPersistedRuntimeIdentityPatch(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): PersistedRuntimeIdentity;
  getResponse(responseId: number): Promise<ThreadResponse | null>;
}

export const createThreadAction = async (
  service: AskingServiceThreadLike,
  input: AskingDetailTaskInput,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<Thread> => {
  const persistedRuntimeIdentity =
    service.buildPersistedRuntimeIdentityPatch(runtimeIdentity);
  const normalizedKnowledgeBaseIds = Array.from(
    new Set(
      [
        ...(input.knowledgeBaseIds || []),
        persistedRuntimeIdentity.knowledgeBaseId || null,
      ].filter(Boolean),
    ),
  ) as string[];
  const hasSelectedSkillIds = Array.isArray(input.selectedSkillIds);
  const normalizedSelectedSkillIds = Array.from(
    new Set((input.selectedSkillIds || []).filter(Boolean)),
  );

  const thread = await service.threadRepository.createOne({
    ...persistedRuntimeIdentity,
    knowledgeBaseIds:
      normalizedKnowledgeBaseIds.length > 0 ? normalizedKnowledgeBaseIds : null,
    selectedSkillIds: hasSelectedSkillIds ? normalizedSelectedSkillIds : null,
    summary: input.question,
  });

  const threadResponseIntentState = buildThreadResponseIntentState({
    askingTaskType: input.trackedAskingResult?.type || null,
    responseKind: input.responseKind || 'ANSWER',
    sourceResponseId: input.sourceResponseId ?? null,
    sql: input.sql,
    threadId: thread.id,
  });

  const threadResponse = await service.threadResponseRepository.createOne({
    ...toPersistedRuntimeIdentityFromSource(thread, persistedRuntimeIdentity),
    threadId: thread.id,
    question: input.question,
    responseKind: input.responseKind || 'ANSWER',
    recommendationDetail: input.recommendationDetail,
    sql: input.sql,
    sourceResponseId: input.sourceResponseId ?? null,
    resolvedIntent: threadResponseIntentState.resolvedIntent,
    artifactLineage: threadResponseIntentState.artifactLineage,
    askingTaskId: input.trackedAskingResult?.taskId,
  });

  if (input.trackedAskingResult?.taskId) {
    await service.askingTaskTracker.bindThreadResponse(
      input.trackedAskingResult.taskId,
      input.trackedAskingResult.queryId,
      thread.id,
      threadResponse.id,
    );
  }

  return thread;
};

export const listThreadsAction = async (
  service: AskingServiceThreadLike,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<Thread[]> => {
  const scopedRuntimeIdentity =
    service.buildPersistedRuntimeIdentityPatch(runtimeIdentity);
  return service.threadRepository.listAllTimeDescOrderByScope({
    projectId: scopedRuntimeIdentity.projectId ?? null,
    workspaceId: scopedRuntimeIdentity.workspaceId,
    knowledgeBaseId: scopedRuntimeIdentity.knowledgeBaseId,
    kbSnapshotId: scopedRuntimeIdentity.kbSnapshotId,
    deployHash: scopedRuntimeIdentity.deployHash,
  });
};

export const assertThreadScopeAction = async (
  service: AskingServiceThreadLike,
  threadId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<Thread> => {
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  const thread = await service.threadRepository.findOneByIdWithRuntimeScope(
    threadId,
    scopedRuntimeIdentity,
  );
  if (!thread) {
    if (!(await service.threadRepository.findOneBy({ id: threadId }))) {
      throw new Error(`Thread ${threadId} not found`);
    }
    throw new Error(
      `Thread ${threadId} does not belong to the current runtime scope`,
    );
  }
  return thread;
};

export const assertAskingTaskScopeAction = async (
  service: any,
  queryId: string,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<void> => {
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  const task = await service.askingTaskRepository.findByQueryIdWithRuntimeScope(
    queryId,
    scopedRuntimeIdentity,
  );
  if (!task) {
    const trackedRuntimeIdentity =
      await service.askingTaskTracker?.getTrackedRuntimeIdentity?.(queryId);
    if (
      trackedRuntimeIdentity &&
      isPersistedRuntimeIdentityMatch(
        normalizeRuntimeScope(trackedRuntimeIdentity) ?? trackedRuntimeIdentity,
        scopedRuntimeIdentity,
      )
    ) {
      return;
    }

    if (!(await service.askingTaskRepository.findByQueryId(queryId))) {
      throw new Error(`Asking task ${queryId} not found`);
    }
    throw new Error(
      `Asking task ${queryId} does not belong to the current runtime scope`,
    );
  }
};

export const assertAskingTaskScopeByIdAction = async (
  service: any,
  taskId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<void> => {
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  const task = await service.askingTaskRepository.findOneByIdWithRuntimeScope(
    taskId,
    scopedRuntimeIdentity,
  );
  if (!task) {
    if (!(await service.askingTaskRepository.findOneBy({ id: taskId }))) {
      throw new Error(`Asking task ${taskId} not found`);
    }
    throw new Error(
      `Asking task ${taskId} does not belong to the current runtime scope`,
    );
  }
};

export const assertResponseScopeAction = async (
  service: AskingServiceThreadLike,
  responseId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<ThreadResponse> => {
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  const response =
    await service.threadResponseRepository.findOneByIdWithRuntimeScope(
      responseId,
      scopedRuntimeIdentity,
    );
  if (!response) {
    if (!(await service.getResponse(responseId))) {
      throw new Error(`Thread response ${responseId} not found`);
    }
    throw new Error(
      `Thread response ${responseId} does not belong to the current runtime scope`,
    );
  }
  return response;
};

export const updateThreadAction = async (
  service: AskingServiceThreadLike,
  threadId: number,
  input: Partial<AskingDetailTaskUpdateInput>,
): Promise<Thread> => {
  if (isEmpty(input)) {
    throw new Error('Update thread input is empty');
  }
  return service.threadRepository.updateOne(threadId, {
    summary: input.summary,
  });
};

export const deleteThreadAction = async (
  service: AskingServiceThreadLike,
  threadId: number,
): Promise<void> => {
  await service.threadRepository.deleteOne(threadId);
};

export const createThreadResponseAction = async (
  service: AskingServiceThreadLike,
  input: AskingDetailTaskInput,
  threadId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
): Promise<ThreadResponse> => {
  const thread = await service.threadRepository.findOneBy({ id: threadId });
  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  let sql = input.sql;
  if (
    !sql &&
    input.sourceResponseId &&
    input.responseKind !== 'RECOMMENDATION_FOLLOWUP'
  ) {
    const sourceResponse = await service.getResponse(input.sourceResponseId);
    if (!sourceResponse) {
      throw new Error(
        `Source thread response ${input.sourceResponseId} not found`,
      );
    }
    sql = sourceResponse.sql;
  }

  const threadResponseIntentState = buildThreadResponseIntentState({
    askingTaskType: input.trackedAskingResult?.type || null,
    responseKind: input.responseKind || 'ANSWER',
    sourceResponseId: input.sourceResponseId ?? null,
    sql,
    threadId: thread.id,
  });

  const threadResponse = await service.threadResponseRepository.createOne({
    ...toPersistedRuntimeIdentityFromSource(thread, runtimeIdentity),
    threadId: thread.id,
    question: input.question,
    responseKind: input.responseKind || 'ANSWER',
    recommendationDetail: input.recommendationDetail,
    sql,
    sourceResponseId: input.sourceResponseId ?? null,
    resolvedIntent: threadResponseIntentState.resolvedIntent,
    artifactLineage: threadResponseIntentState.artifactLineage,
    askingTaskId: input.trackedAskingResult?.taskId,
  });

  if (input.trackedAskingResult?.taskId) {
    await service.askingTaskTracker.bindThreadResponse(
      input.trackedAskingResult.taskId,
      input.trackedAskingResult.queryId,
      thread.id,
      threadResponse.id,
    );
  }

  return (
    (await service.threadResponseRepository.findOneBy({
      id: threadResponse.id,
    })) || threadResponse
  );
};

export const updateThreadResponseAction = async (
  service: AskingServiceThreadLike,
  responseId: number,
  data: { sql: string },
): Promise<ThreadResponse> => {
  const threadResponse = await service.threadResponseRepository.findOneBy({
    id: responseId,
  });
  if (!threadResponse) {
    throw new Error(`Thread response ${responseId} not found`);
  }
  return service.threadResponseRepository.updateOne(responseId, {
    sql: data.sql,
  });
};

export const getResponsesWithThreadAction = (
  service: AskingServiceThreadLike,
  threadId: number,
  runtimeIdentity?: PersistedRuntimeIdentity,
) => {
  if (!runtimeIdentity) {
    return service.threadResponseRepository.getResponsesWithThread(threadId);
  }
  const scopedRuntimeIdentity =
    normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
  return service.threadResponseRepository.getResponsesWithThreadByScope(
    threadId,
    scopedRuntimeIdentity,
  );
};

export const getResponseAction = (
  service: AskingServiceThreadLike,
  responseId: number,
) => service.threadResponseRepository.findOneBy({ id: responseId });

export const changeThreadResponseAnswerDetailStatusAction = async (
  service: AskingServiceThreadLike,
  responseId: number,
  status: any,
  content?: string,
): Promise<ThreadResponse> => {
  const response = await service.threadResponseRepository.findOneBy({
    id: responseId,
  });
  if (!response) {
    throw new Error(`Thread response ${responseId} not found`);
  }
  if (response.answerDetail?.status === status) {
    return response;
  }
  return service.threadResponseRepository.updateOne(responseId, {
    answerDetail: {
      ...response.answerDetail,
      status,
      content,
    },
  });
};

export const deleteAllThreadsByProjectIdAction = async (
  service: AskingServiceThreadLike,
  projectId: number,
): Promise<void> => {
  await service.threadRepository.deleteAllBy({ projectId });
};
