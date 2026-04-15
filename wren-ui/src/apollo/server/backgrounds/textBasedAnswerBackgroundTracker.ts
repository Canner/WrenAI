import { IWrenAIAdaptor } from '../adaptors';
import {
  AskRuntimeIdentity,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
} from '../models/adaptor';
import {
  IKnowledgeBaseRepository,
  IThreadRepository,
  ThreadResponse,
  IThreadResponseRepository,
} from '../repositories';
import {
  IProjectService,
  IDeployService,
  IQueryService,
  ThreadResponseAnswerStatus,
  PreviewDataResponse,
} from '../services';
import { getLogger } from '@server/utils';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback,
  toPersistedRuntimeIdentityFromSource,
} from '@server/utils/persistedRuntimeIdentity';
import { resolveProjectLanguage } from '@server/utils/runtimeExecutionContext';
import { registerShutdownCallback } from '@server/utils/shutdown';

const logger = getLogger('TextBasedAnswerBackgroundTracker');
logger.level = 'debug';

const toAskRuntimeIdentity = (
  runtimeIdentity: PersistedRuntimeIdentity,
): AskRuntimeIdentity => ({
  projectId:
    typeof runtimeIdentity.projectId === 'number'
      ? runtimeIdentity.projectId
      : undefined,
  workspaceId: runtimeIdentity.workspaceId ?? null,
  knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
  kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
  deployHash: runtimeIdentity.deployHash ?? null,
  actorUserId: runtimeIdentity.actorUserId ?? null,
});

const resolveErrorPayload = (error: unknown): Record<string, unknown> => {
  if (error && typeof error === 'object') {
    const extensions = (error as { extensions?: unknown }).extensions;
    if (extensions && typeof extensions === 'object') {
      return extensions as Record<string, unknown>;
    }
    return error as Record<string, unknown>;
  }
  return {
    message: String(error),
  };
};

export class TextBasedAnswerBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, ThreadResponse> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private threadRepository: IThreadRepository;
  private projectService: IProjectService;
  private deployService: IDeployService;
  private queryService: IQueryService;
  private knowledgeBaseRepository?: Pick<IKnowledgeBaseRepository, 'findOneBy'>;
  private runningJobs = new Set<number>();
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  private unregisterShutdown?: () => void;

  constructor({
    wrenAIAdaptor,
    threadResponseRepository,
    threadRepository,
    projectService,
    deployService,
    queryService,
    knowledgeBaseRepository,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
    threadRepository: IThreadRepository;
    projectService: IProjectService;
    deployService: IDeployService;
    queryService: IQueryService;
    knowledgeBaseRepository?: Pick<IKnowledgeBaseRepository, 'findOneBy'>;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.threadRepository = threadRepository;
    this.projectService = projectService;
    this.deployService = deployService;
    this.queryService = queryService;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.intervalTime = 1000;
    this.start();
  }

  private start() {
    if (this.pollingIntervalId) {
      return;
    }
    this.pollingIntervalId = setInterval(async () => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          if (
            this.runningJobs.has(threadResponse.id) ||
            !threadResponse.answerDetail
          ) {
            return;
          }
          this.runningJobs.add(threadResponse.id);
          try {
            // update the status to fetching data
            await this.threadResponseRepository.updateOne(threadResponse.id, {
              answerDetail: {
                ...threadResponse.answerDetail,
                status: ThreadResponseAnswerStatus.FETCHING_DATA,
              },
            });

            // get sql data
            const responseRuntimeIdentity =
              await this.getResponseRuntimeIdentity(threadResponse);
            const runtimeDeployment =
              await this.deployService.getDeploymentByRuntimeIdentity(
                responseRuntimeIdentity,
              );
            if (!runtimeDeployment) {
              throw new Error(
                'No deployment found, please deploy your project first',
              );
            }
            const project = await this.projectService.getProjectById(
              runtimeDeployment.projectId,
            );
            const mdl = runtimeDeployment.manifest;
            const responseSql = threadResponse.sql;
            if (!responseSql) {
              throw new Error(
                `SQL is missing for response ${threadResponse.id}`,
              );
            }
            let data: PreviewDataResponse;
            try {
              data = (await this.queryService.preview(responseSql, {
                project,
                manifest: mdl,
                modelingOnly: false,
                limit: 500,
              })) as PreviewDataResponse;
            } catch (error) {
              logger.error(`Error when query sql data: ${error}`);
              await this.threadResponseRepository.updateOne(threadResponse.id, {
                answerDetail: {
                  ...threadResponse.answerDetail,
                  status: ThreadResponseAnswerStatus.FAILED,
                  error: resolveErrorPayload(error),
                },
              });
              throw error;
            }

            // request AI service
            const response = await this.wrenAIAdaptor.createTextBasedAnswer({
              query: threadResponse.question,
              sql: responseSql,
              sqlData: data,
              threadId: threadResponse.threadId.toString(),
              runtimeScopeId:
                resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
                  responseRuntimeIdentity,
                ) || undefined,
              runtimeIdentity: toAskRuntimeIdentity(responseRuntimeIdentity),
              configurations: {
                language: await this.resolveRuntimeLanguage(
                  responseRuntimeIdentity,
                  project,
                ),
              },
            });
            const responseQueryId = response.queryId;
            if (!responseQueryId) {
              throw new Error('Text-based answer query id is missing');
            }

            // update the status to preprocessing
            await this.threadResponseRepository.updateOne(threadResponse.id, {
              answerDetail: {
                ...threadResponse.answerDetail,
                status: ThreadResponseAnswerStatus.PREPROCESSING,
              },
            });

            // polling query id to check the status
            let result: TextBasedAnswerResult;
            do {
              result =
                await this.wrenAIAdaptor.getTextBasedAnswerResult(
                  responseQueryId,
                );
              if (result.status === TextBasedAnswerStatus.PREPROCESSING) {
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
            } while (result.status === TextBasedAnswerStatus.PREPROCESSING);

            // update the status to final
            const updatedAnswerDetail = {
              queryId: responseQueryId,
              status:
                result.status === TextBasedAnswerStatus.SUCCEEDED
                  ? ThreadResponseAnswerStatus.STREAMING
                  : ThreadResponseAnswerStatus.FAILED,
              numRowsUsedInLLM: result.numRowsUsedInLLM,
              error: result.error,
            };
            await this.threadResponseRepository.updateOne(threadResponse.id, {
              answerDetail: updatedAnswerDetail,
            });

            delete this.tasks[threadResponse.id];
          } finally {
            this.runningJobs.delete(threadResponse.id);
          }
        },
      );

      // Run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // Show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
    this.unregisterShutdown = registerShutdownCallback(() => this.stop());
  }

  public stop() {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
    this.unregisterShutdown?.();
    this.unregisterShutdown = undefined;
  }

  public addTask(threadResponse: ThreadResponse) {
    this.tasks[threadResponse.id] = threadResponse;
  }

  public getTasks() {
    return this.tasks;
  }

  private async getResponseRuntimeIdentity(
    threadResponse: ThreadResponse,
  ): Promise<PersistedRuntimeIdentity> {
    const hasResponseProjectBridge = threadResponse.projectId != null;
    const hasResponseDeployHash = threadResponse.deployHash != null;

    if (hasResponseProjectBridge && hasResponseDeployHash) {
      return toPersistedRuntimeIdentityFromSource(threadResponse);
    }

    const thread = await this.threadRepository.findOneBy({
      id: threadResponse.threadId,
    });
    if (!thread) {
      throw new Error(
        `Thread ${threadResponse.threadId} not found for response ${threadResponse.id}`,
      );
    }

    return toPersistedRuntimeIdentityFromSource(
      threadResponse,
      toPersistedRuntimeIdentityFromSource(thread),
    );
  }

  private async resolveRuntimeLanguage(
    runtimeIdentity: PersistedRuntimeIdentity,
    project?: { language?: string | null } | null,
  ) {
    if (runtimeIdentity.knowledgeBaseId && this.knowledgeBaseRepository) {
      const knowledgeBase = await this.knowledgeBaseRepository.findOneBy({
        id: runtimeIdentity.knowledgeBaseId,
      });
      return resolveProjectLanguage(project as any, knowledgeBase as any);
    }

    return resolveProjectLanguage(project as any);
  }
}
