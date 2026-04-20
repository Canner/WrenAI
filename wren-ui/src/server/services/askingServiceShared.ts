import { IWrenAIAdaptor } from '@server/adaptors/wrenAIAdaptor';
import {
  AskResultStatus,
  RecommendationQuestion,
  RecommendationQuestionStatus,
  RecommendationQuestionsResult,
  WrenAIError,
  ChartAdjustmentOption,
} from '@server/models/adaptor';
import { TrackedAdjustmentResult } from '../backgrounds';
import { IDeployService } from './deployService';
import { IProjectService } from './projectService';
import { IThreadRepository } from '../repositories/threadRepository';
import {
  IThreadResponseRepository,
  ThreadResponse,
} from '../repositories/threadResponseRepository';
import { IAskingTaskTracker, TrackedAskingResult } from './askingTaskTracker';
import { IQueryService, PreviewDataResponse } from './queryService';
import {
  IAskingTaskRepository,
  IKnowledgeBaseRepository,
  IViewRepository,
} from '../repositories';
import { ISkillService } from './skillService';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { getLogger } from '@server/utils';
import {
  PostHogTelemetry,
  TelemetryEvent,
  WrenService,
} from '../telemetry/telemetry';
import { registerShutdownCallback } from '@server/utils/shutdown';
import { toPersistedRuntimeIdentityFromSource } from '@server/utils/persistedRuntimeIdentity';
import { isNil } from 'lodash';

export const logger = getLogger('AskingService');
logger.level = 'debug';

export const CHART_GENERATION_SAMPLE_LIMIT = 200;

export interface Task {
  id: string;
}

export interface AskingPayload {
  threadId?: number;
  runtimeScopeId?: string | null;
  runtimeIdentity?: PersistedRuntimeIdentity | null;
  language: string;
}

export interface AskingTaskInput {
  question: string;
  knowledgeBaseIds?: string[];
  selectedSkillIds?: string[];
}

export interface AskingDetailTaskInput {
  question?: string;
  sql?: string;
  trackedAskingResult?: TrackedAskingResult;
  knowledgeBaseIds?: string[];
  selectedSkillIds?: string[];
}

export interface AskingDetailTaskUpdateInput {
  summary?: string;
}

export enum RecommendQuestionResultStatus {
  NOT_STARTED = 'NOT_STARTED',
  GENERATING = 'GENERATING',
  FINISHED = 'FINISHED',
  FAILED = 'FAILED',
}

export interface ThreadRecommendQuestionResult {
  status: RecommendQuestionResultStatus;
  questions: RecommendationQuestion[];
  error?: WrenAIError;
}

export interface InstantRecommendedQuestionsInput {
  previousQuestions?: string[];
}

export type InstantRecommendedQuestionTask = {
  runtimeIdentity: PersistedRuntimeIdentity;
  createdAt: number;
};

export enum ThreadResponseAnswerStatus {
  NOT_STARTED = 'NOT_STARTED',
  FETCHING_DATA = 'FETCHING_DATA',
  PREPROCESSING = 'PREPROCESSING',
  STREAMING = 'STREAMING',
  FINISHED = 'FINISHED',
  FAILED = 'FAILED',
  INTERRUPTED = 'INTERRUPTED',
}

export interface AdjustmentReasoningInput {
  tables: string[];
  sqlGenerationReasoning: string;
  runtimeIdentity?: PersistedRuntimeIdentity;
}

export interface AdjustmentSqlInput {
  sql: string;
}

export interface AskingServiceConstructorArgs {
  telemetry: PostHogTelemetry;
  wrenAIAdaptor: IWrenAIAdaptor;
  deployService: IDeployService;
  projectService: IProjectService;
  viewRepository: IViewRepository;
  threadRepository: IThreadRepository;
  threadResponseRepository: IThreadResponseRepository;
  askingTaskRepository: IAskingTaskRepository;
  queryService: IQueryService;
  askingTaskTracker: IAskingTaskTracker;
  knowledgeBaseRepository?: Pick<
    IKnowledgeBaseRepository,
    'findOneBy' | 'findAll'
  >;
  skillService?: Pick<ISkillService, 'getSkillDefinitionById'>;
  backgroundTrackerWorkspaceId?: string | null;
}

export interface IAskingService {
  createAskingTask(
    input: AskingTaskInput,
    payload: AskingPayload,
    rerunFromCancelled?: boolean,
    previousTaskId?: number,
    threadResponseId?: number,
  ): Promise<Task>;
  rerunAskingTask(
    threadResponseId: number,
    payload: AskingPayload,
  ): Promise<Task>;
  cancelAskingTask(taskId: string): Promise<void>;
  getAskingTask(taskId: string): Promise<TrackedAskingResult | null>;
  getAskingTaskById(id: number): Promise<TrackedAskingResult | null>;
  createThread(
    input: AskingDetailTaskInput,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<any>;
  updateThreadScoped(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: Partial<AskingDetailTaskUpdateInput>,
  ): Promise<any>;
  deleteThreadScoped(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<void>;
  listThreads(runtimeIdentity: PersistedRuntimeIdentity): Promise<any[]>;
  assertThreadScope(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<any>;
  assertAskingTaskScope(
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<void>;
  assertAskingTaskScopeById(
    taskId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<void>;
  assertResponseScope(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<ThreadResponse>;
  createThreadResponseScoped(
    input: AskingDetailTaskInput,
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<ThreadResponse>;
  updateThreadResponseScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    data: { sql: string },
  ): Promise<ThreadResponse>;
  getResponsesWithThreadScoped(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<ThreadResponse[]>;
  getResponseScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<ThreadResponse>;
  generateThreadResponseBreakdownScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
  ): Promise<ThreadResponse>;
  generateThreadResponseAnswerScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
  ): Promise<ThreadResponse>;
  generateThreadResponseChartScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ): Promise<ThreadResponse>;
  adjustThreadResponseChartScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: ChartAdjustmentOption,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ): Promise<ThreadResponse>;
  adjustThreadResponseWithSQLScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: AdjustmentSqlInput,
  ): Promise<ThreadResponse>;
  adjustThreadResponseAnswerScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: AdjustmentReasoningInput,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ): Promise<ThreadResponse>;
  cancelAdjustThreadResponseAnswer(taskId: string): Promise<void>;
  rerunAdjustThreadResponseAnswer(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ): Promise<{ queryId: string }>;
  getAdjustmentTask(taskId: string): Promise<TrackedAdjustmentResult | null>;
  getAdjustmentTaskById(id: number): Promise<TrackedAdjustmentResult | null>;
  changeThreadResponseAnswerDetailStatusScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    status: ThreadResponseAnswerStatus,
    content?: string,
  ): Promise<ThreadResponse>;
  previewDataScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    limit?: number,
  ): Promise<PreviewDataResponse>;
  previewBreakdownDataScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    stepIndex?: number,
    limit?: number,
  ): Promise<PreviewDataResponse>;
  createInstantRecommendedQuestions(
    input: InstantRecommendedQuestionsInput,
    runtimeIdentity: PersistedRuntimeIdentity,
    runtimeScopeId?: string | null,
  ): Promise<Task>;
  getInstantRecommendedQuestions(
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<RecommendationQuestionsResult>;
  generateThreadRecommendationQuestions(
    threadId: number,
    runtimeScopeId?: string | null,
  ): Promise<void>;
  getThreadRecommendationQuestions(
    threadId: number,
  ): Promise<ThreadRecommendQuestionResult>;
  deleteAllByProjectId(projectId: number): Promise<void>;
}

export const isFinalized = (status: AskResultStatus) =>
  status === AskResultStatus.FAILED ||
  status === AskResultStatus.FINISHED ||
  status === AskResultStatus.STOPPED;

export const isRecommendationQuestionsFinalized = (
  status: RecommendationQuestionStatus,
) =>
  status === RecommendationQuestionStatus.FAILED ||
  status === RecommendationQuestionStatus.FINISHED;

export const constructCteSql = (
  steps: Array<{ cteName: string; summary: string; sql: string }>,
  stepIndex?: number,
): string => {
  if (!isNil(stepIndex) && (stepIndex < 0 || stepIndex >= steps.length)) {
    throw new Error(`Invalid stepIndex: ${stepIndex}`);
  }

  const slicedSteps = isNil(stepIndex) ? steps : steps.slice(0, stepIndex + 1);
  if (slicedSteps.length === 1) {
    return `-- ${slicedSteps[0].summary}\n${slicedSteps[0].sql}`;
  }

  let sql = 'WITH ';
  slicedSteps.forEach((step, index) => {
    if (index === slicedSteps.length - 1) {
      sql += `\n-- ${step.summary}\n`;
      sql += `${step.sql}`;
    } else if (index === slicedSteps.length - 2) {
      sql += `${step.cteName} AS`;
      sql += `\n-- ${step.summary}\n`;
      sql += `(${step.sql})`;
    } else {
      sql += `${step.cteName} AS`;
      sql += `\n-- ${step.summary}\n`;
      sql += `(${step.sql}),`;
    }
  });

  return sql;
};

export class BreakdownBackgroundTracker {
  private tasks: Record<number, ThreadResponse> = {};
  private readonly intervalTime = 1000;
  private readonly runningJobs = new Set<number>();
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  private unregisterShutdown?: () => void;

  constructor(
    private readonly deps: {
      telemetry: PostHogTelemetry;
      wrenAIAdaptor: IWrenAIAdaptor;
      threadResponseRepository: IThreadResponseRepository;
    },
  ) {
    this.start();
  }

  public start() {
    if (this.pollingIntervalId) {
      return;
    }
    logger.info('Background tracker started');
    this.pollingIntervalId = setInterval(() => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          if (this.runningJobs.has(threadResponse.id)) {
            return;
          }

          this.runningJobs.add(threadResponse.id);
          try {
            const breakdownDetail = threadResponse.breakdownDetail;
            if (!breakdownDetail?.queryId) {
              return;
            }

            const result = await this.deps.wrenAIAdaptor.getAskDetailResult(
              breakdownDetail.queryId,
            );
            if (breakdownDetail.status === result.status) {
              logger.debug(
                `Job ${threadResponse.id} status not changed, finished`,
              );
              return;
            }

            const updatedBreakdownDetail = {
              queryId: breakdownDetail.queryId,
              status: result?.status || breakdownDetail.status,
              error: result?.error || undefined,
              description: result?.response?.description,
              steps: result?.response?.steps,
            };
            logger.debug(`Job ${threadResponse.id} status changed, updating`);
            const updatedThreadResponse =
              await this.deps.threadResponseRepository.updateOneByIdWithRuntimeScope(
                threadResponse.id,
                toPersistedRuntimeIdentityFromSource(threadResponse),
                { breakdownDetail: updatedBreakdownDetail },
              );
            if (!updatedThreadResponse) {
              delete this.tasks[threadResponse.id];
              throw new Error(
                `Thread response ${threadResponse.id} no longer matches the tracked runtime scope`,
              );
            }
            this.tasks[threadResponse.id] = updatedThreadResponse;

            if (isFinalized(result.status)) {
              const eventProperties = {
                question: threadResponse.question,
                error: result.error,
              };
              if (result.status === AskResultStatus.FINISHED) {
                this.deps.telemetry.sendEvent(
                  TelemetryEvent.HOME_ANSWER_BREAKDOWN,
                  eventProperties,
                );
              } else {
                this.deps.telemetry.sendEvent(
                  TelemetryEvent.HOME_ANSWER_BREAKDOWN,
                  eventProperties,
                  WrenService.AI,
                  false,
                );
              }
              logger.debug(`Job ${threadResponse.id} is finalized, removing`);
              delete this.tasks[threadResponse.id];
            }
          } finally {
            this.runningJobs.delete(threadResponse.id);
          }
        },
      );

      Promise.allSettled(jobs.map((job) => job())).then((results) => {
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
}
