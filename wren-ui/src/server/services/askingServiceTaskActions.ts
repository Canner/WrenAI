import { buildAskRuntimeContext } from '@server/utils/askContext';
import {
  normalizeCanonicalPersistedRuntimeIdentity,
  resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback,
  toPersistedRuntimeIdentityFromSource,
} from '@server/utils/persistedRuntimeIdentity';
import { AskingPayload, AskingTaskInput, Task } from './askingServiceShared';
import { TelemetryEvent } from '../telemetry/telemetry';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';

interface AskingTaskActionServiceLike {
  askingTaskTracker: Pick<
    any,
    | 'createAskingTask'
    | 'cancelAskingTask'
    | 'getAskingResult'
    | 'getAskingResultById'
    | 'bindThreadResponse'
  >;
  threadResponseRepository: Pick<any, 'findOneBy'>;
  skillService?: any;
  getThreadById(threadId: number): Promise<any>;
  resolveAskingRuntimeIdentity(
    payload: AskingPayload,
    threadRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ): PersistedRuntimeIdentity;
  resolveScopedKnowledgeBaseIds(
    inputKnowledgeBaseIds?: string[] | null,
    thread?: any,
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ): string[];
  resolveRuntimeIdentityFromKnowledgeSelection(
    runtimeIdentity: PersistedRuntimeIdentity,
    knowledgeBaseIds: string[],
  ): Promise<PersistedRuntimeIdentity>;
  resolveScopedSelectedSkillIds(
    inputSelectedSkillIds?: string[] | null,
    thread?: any,
  ): string[] | undefined;
  getDeployId(runtimeIdentity: PersistedRuntimeIdentity): Promise<string>;
  resolveRetrievalScopeIds(
    knowledgeBaseIds: string[],
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<string[]>;
  buildAskTaskRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    deployHash?: string | null,
  ): AskTaskRuntimeIdentity;
  getAskingHistory(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    excludeThreadResponseId?: number,
  ): Promise<any[]>;
  toAskRuntimeIdentity(
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ): any | undefined;
  ensureTrackedAskingTaskPersisted(
    queryId: string,
    question: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<void>;
}

type AskTaskRuntimeIdentity = PersistedRuntimeIdentity & {
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
};

export const createAskingTaskAction = async (
  service: AskingTaskActionServiceLike,
  input: AskingTaskInput,
  payload: AskingPayload,
  rerunFromCancelled?: boolean,
  previousTaskId?: number,
  threadResponseId?: number,
): Promise<Task> => {
  const { threadId, language } = payload;
  const thread = threadId ? await service.getThreadById(threadId) : null;
  const threadRuntimeIdentity = thread
    ? toPersistedRuntimeIdentityFromSource(
        thread,
        payload.runtimeIdentity
          ? normalizeCanonicalPersistedRuntimeIdentity({
              ...payload.runtimeIdentity,
              deployHash: null,
            })
          : null,
      )
    : null;
  const runtimeIdentity = service.resolveAskingRuntimeIdentity(
    payload,
    threadRuntimeIdentity as PersistedRuntimeIdentity | null,
  );
  const knowledgeBaseIds = service.resolveScopedKnowledgeBaseIds(
    input.knowledgeBaseIds,
    thread,
    runtimeIdentity,
  );
  const scopedRuntimeIdentity =
    await service.resolveRuntimeIdentityFromKnowledgeSelection(
      runtimeIdentity,
      knowledgeBaseIds,
    );
  const selectedSkillIds = service.resolveScopedSelectedSkillIds(
    input.selectedSkillIds,
    thread,
  );
  const deployId =
    scopedRuntimeIdentity.deployHash ||
    (await service.getDeployId(scopedRuntimeIdentity));
  const retrievalScopeIds = await service.resolveRetrievalScopeIds(
    knowledgeBaseIds,
    {
      ...scopedRuntimeIdentity,
      deployHash: scopedRuntimeIdentity.deployHash || deployId,
    },
  );
  const taskRuntimeIdentity = service.buildAskTaskRuntimeIdentity(
    scopedRuntimeIdentity,
    scopedRuntimeIdentity.deployHash || deployId,
  );

  const histories = threadId
    ? await service.getAskingHistory(
        threadId,
        scopedRuntimeIdentity,
        threadResponseId,
      )
    : undefined;
  const askRuntimeContext = await buildAskRuntimeContext({
    runtimeIdentity: service.toAskRuntimeIdentity(taskRuntimeIdentity),
    knowledgeBaseIds,
    selectedSkillIds,
    skillService: service.skillService,
  });
  const { runtimeIdentity: _runtimeIdentity, ...askContextWithoutIdentity } =
    askRuntimeContext;

  const response = await service.askingTaskTracker.createAskingTask({
    query: input.question,
    histories,
    deployId,
    runtimeScopeId:
      payload.runtimeScopeId ||
      taskRuntimeIdentity.deployHash ||
      resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
        taskRuntimeIdentity,
      ) ||
      undefined,
    configurations: { language },
    rerunFromCancelled,
    previousTaskId,
    threadResponseId,
    runtimeIdentity: taskRuntimeIdentity,
    retrievalScopeIds,
    ...askContextWithoutIdentity,
  });

  if (!rerunFromCancelled) {
    await service.ensureTrackedAskingTaskPersisted(
      response.queryId,
      input.question,
      taskRuntimeIdentity,
    );
  }

  return { id: response.queryId };
};

export const rerunAskingTaskAction = async (
  service: AskingTaskActionServiceLike,
  threadResponseId: number,
  payload: AskingPayload,
): Promise<Task> => {
  const threadResponse = await service.threadResponseRepository.findOneBy({
    id: threadResponseId,
  });
  if (!threadResponse) {
    throw new Error(`Thread response ${threadResponseId} not found`);
  }

  return createAskingTaskAction(
    service,
    { question: threadResponse.question },
    { ...payload, threadId: threadResponse.threadId },
    true,
    threadResponse.askingTaskId,
    threadResponseId,
  );
};

export const cancelAskingTaskAction = async (
  service: AskingTaskActionServiceLike,
  taskId: string,
  telemetry: any,
): Promise<void> => {
  const eventName = TelemetryEvent.HOME_CANCEL_ASK;
  try {
    await service.askingTaskTracker.cancelAskingTask(taskId);
    telemetry.sendEvent(eventName, {});
  } catch (err: any) {
    telemetry.sendEvent(eventName, {}, err.extensions?.service, false);
    throw err;
  }
};

export const getAskingTaskAction = (
  service: AskingTaskActionServiceLike,
  taskId: string,
) => service.askingTaskTracker.getAskingResult(taskId);

export const getAskingTaskByIdAction = (
  service: AskingTaskActionServiceLike,
  id: number,
) => service.askingTaskTracker.getAskingResultById(id);
