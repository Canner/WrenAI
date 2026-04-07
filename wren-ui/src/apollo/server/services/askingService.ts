import { IWrenAIAdaptor } from '@server/adaptors/wrenAIAdaptor';
import {
  AskResultStatus,
  RecommendationQuestionsResult,
  RecommendationQuestionsInput,
  RecommendationQuestion,
  WrenAIError,
  RecommendationQuestionStatus,
  ChartStatus,
  ChartAdjustmentOption,
  WrenAILanguage,
} from '@server/models/adaptor';
import { buildAskRuntimeContext } from '@server/utils/askContext';
import { IDeployService } from './deployService';
import { IProjectService } from './projectService';
import { IThreadRepository, Thread } from '../repositories/threadRepository';
import {
  IThreadResponseRepository,
  ThreadResponse,
  ThreadResponseAdjustmentType,
} from '../repositories/threadResponseRepository';
import { getLogger } from '@server/utils';
import { isEmpty, isNil } from 'lodash';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import { DataSourceName } from '@server/types';
import {
  PostHogTelemetry,
  TelemetryEvent,
  WrenService,
} from '../telemetry/telemetry';
import {
  IAskingTaskRepository,
  IViewRepository,
  Project,
} from '../repositories';
import { IQueryService, PreviewDataResponse } from './queryService';
import {
  ThreadRecommendQuestionBackgroundTracker,
  ChartBackgroundTracker,
  ChartAdjustmentBackgroundTracker,
  AdjustmentBackgroundTaskTracker,
  TrackedAdjustmentResult,
} from '../backgrounds';
import { getConfig } from '@server/config';
import { TextBasedAnswerBackgroundTracker } from '../backgrounds/textBasedAnswerBackgroundTracker';
import { IAskingTaskTracker, TrackedAskingResult } from './askingTaskTracker';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { ActorClaims } from './authService';
import { IConnectorService } from './connectorService';
import { ISkillService } from './skillService';
import { Deploy } from '../repositories/deployLogRepository';
import {
  isPersistedRuntimeIdentityMatch,
  normalizeCanonicalPersistedRuntimeIdentity,
  toPersistedRuntimeIdentityFromSource,
} from '@server/utils/persistedRuntimeIdentity';
import { Manifest, WrenEngineDataSourceType } from '../mdl/type';

const config = getConfig();

const logger = getLogger('AskingService');
logger.level = 'debug';

// const QUERY_ID_PLACEHOLDER = '0';

export interface Task {
  id: string;
}

export interface AskingPayload {
  threadId?: number;
  runtimeScopeId?: string | null;
  runtimeIdentity?: PersistedRuntimeIdentity | null;
  actorClaims?: ActorClaims | null;
  language: string;
}

export interface AskingTaskInput {
  question: string;
}

export interface AskingDetailTaskInput {
  question?: string;
  sql?: string;
  trackedAskingResult?: TrackedAskingResult;
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

type InstantRecommendedQuestionTask = {
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

// adjustment input
export interface AdjustmentReasoningInput {
  tables: string[];
  sqlGenerationReasoning: string;
  runtimeIdentity?: PersistedRuntimeIdentity;
}

export interface AdjustmentSqlInput {
  sql: string;
}

export interface IAskingService {
  /**
   * Asking task.
   */
  createAskingTask(
    input: AskingTaskInput,
    payload: AskingPayload,
    // if the asking task is rerun from a cancelled thread response
    rerunFromCancelled?: boolean,
    // if the asking task is rerun from a cancelled thread response,
    // the previous task id is the task id of the cancelled thread response
    previousTaskId?: number,
    // if the asking task is rerun from a thread response
    // the thread response id is the id of the cancelled thread response
    threadResponseId?: number,
  ): Promise<Task>;
  rerunAskingTask(
    threadResponseId: number,
    payload: AskingPayload,
  ): Promise<Task>;
  cancelAskingTask(taskId: string): Promise<void>;
  getAskingTask(taskId: string): Promise<TrackedAskingResult>;
  getAskingTaskById(id: number): Promise<TrackedAskingResult>;

  /**
   * Asking detail task.
   */
  createThread(
    input: AskingDetailTaskInput,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Thread>;
  updateThreadScoped(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: Partial<AskingDetailTaskUpdateInput>,
  ): Promise<Thread>;
  deleteThreadScoped(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<void>;
  listThreads(runtimeIdentity: PersistedRuntimeIdentity): Promise<Thread[]>;
  assertThreadScope(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Thread>;
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
  ): Promise<ThreadResponse>;
  adjustThreadResponseChartScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: ChartAdjustmentOption,
    configurations: { language: string },
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
  ): Promise<ThreadResponse>;
  cancelAdjustThreadResponseAnswer(taskId: string): Promise<void>;
  rerunAdjustThreadResponseAnswer(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
  ): Promise<{ queryId: string }>;
  getAdjustmentTask(taskId: string): Promise<TrackedAdjustmentResult>;
  getAdjustmentTaskById(id: number): Promise<TrackedAdjustmentResult>;
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

  /**
   * Recommendation questions
   */
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

/**
 * utility function to check if the status is finalized
 */
const isFinalized = (status: AskResultStatus) => {
  return (
    status === AskResultStatus.FAILED ||
    status === AskResultStatus.FINISHED ||
    status === AskResultStatus.STOPPED
  );
};

const isRecommendationQuestionsFinalized = (
  status: RecommendationQuestionStatus,
) => {
  return (
    status === RecommendationQuestionStatus.FAILED ||
    status === RecommendationQuestionStatus.FINISHED
  );
};

/**
 * Given a list of steps, construct the SQL statement with CTEs
 * If stepIndex is provided, only construct the SQL from top to that step
 * @param steps
 * @param stepIndex
 * @returns string
 */
export const constructCteSql = (
  steps: Array<{ cteName: string; summary: string; sql: string }>,
  stepIndex?: number,
): string => {
  // validate stepIndex
  if (!isNil(stepIndex) && (stepIndex < 0 || stepIndex >= steps.length)) {
    throw new Error(`Invalid stepIndex: ${stepIndex}`);
  }

  const slicedSteps = isNil(stepIndex) ? steps : steps.slice(0, stepIndex + 1);

  // if there's only one step, return the sql directly
  if (slicedSteps.length === 1) {
    return `-- ${slicedSteps[0].summary}\n${slicedSteps[0].sql}`;
  }

  let sql = 'WITH ';
  slicedSteps.forEach((step, index) => {
    if (index === slicedSteps.length - 1) {
      // if it's the last step, remove the trailing comma.
      // no need to wrap with WITH
      sql += `\n-- ${step.summary}\n`;
      sql += `${step.sql}`;
    } else if (index === slicedSteps.length - 2) {
      // if it's the last two steps, remove the trailing comma.
      // wrap with CTE
      sql += `${step.cteName} AS`;
      sql += `\n-- ${step.summary}\n`;
      sql += `(${step.sql})`;
    } else {
      // if it's not the last step, wrap with CTE
      sql += `${step.cteName} AS`;
      sql += `\n-- ${step.summary}\n`;
      sql += `(${step.sql}),`;
    }
  });

  return sql;
};

/**
 * Background tracker to track the status of the asking breakdown task
 */
class BreakdownBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, ThreadResponse> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private runningJobs = new Set();
  private telemetry: PostHogTelemetry;

  constructor({
    telemetry,
    wrenAIAdaptor,
    threadResponseRepository,
  }: {
    telemetry: PostHogTelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
  }) {
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.intervalTime = 1000;
    this.start();
  }

  public start() {
    logger.info('Background tracker started');
    setInterval(() => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          // check if same job is running
          if (this.runningJobs.has(threadResponse.id)) {
            return;
          }

          // mark the job as running
          this.runningJobs.add(threadResponse.id);

          // get the answer detail
          const breakdownDetail = threadResponse.breakdownDetail;

          // get the latest result from AI service
          const result = await this.wrenAIAdaptor.getAskDetailResult(
            breakdownDetail.queryId,
          );

          // check if status change
          if (breakdownDetail.status === result.status) {
            // mark the job as finished
            logger.debug(
              `Job ${threadResponse.id} status not changed, finished`,
            );
            this.runningJobs.delete(threadResponse.id);
            return;
          }

          // update database
          const updatedBreakdownDetail = {
            queryId: breakdownDetail.queryId,
            status: result?.status,
            error: result?.error,
            description: result?.response?.description,
            steps: result?.response?.steps,
          };
          logger.debug(`Job ${threadResponse.id} status changed, updating`);
          await this.threadResponseRepository.updateOne(threadResponse.id, {
            breakdownDetail: updatedBreakdownDetail,
          });

          // remove the task from tracker if it is finalized
          if (isFinalized(result.status)) {
            const eventProperties = {
              question: threadResponse.question,
              error: result.error,
            };
            if (result.status === AskResultStatus.FINISHED) {
              this.telemetry.sendEvent(
                TelemetryEvent.HOME_ANSWER_BREAKDOWN,
                eventProperties,
              );
            } else {
              this.telemetry.sendEvent(
                TelemetryEvent.HOME_ANSWER_BREAKDOWN,
                eventProperties,
                WrenService.AI,
                false,
              );
            }
            logger.debug(`Job ${threadResponse.id} is finalized, removing`);
            delete this.tasks[threadResponse.id];
          }

          // mark the job as finished
          this.runningJobs.delete(threadResponse.id);
        },
      );

      // run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(threadResponse: ThreadResponse) {
    this.tasks[threadResponse.id] = threadResponse;
  }

  public getTasks() {
    return this.tasks;
  }
}

export class AskingService implements IAskingService {
  private instantRecommendedQuestionTasks = new Map<
    string,
    InstantRecommendedQuestionTask
  >();
  private wrenAIAdaptor: IWrenAIAdaptor;
  private deployService: IDeployService;
  private projectService: IProjectService;
  private viewRepository: IViewRepository;
  private threadRepository: IThreadRepository;
  private threadResponseRepository: IThreadResponseRepository;
  private breakdownBackgroundTracker: BreakdownBackgroundTracker;
  private textBasedAnswerBackgroundTracker: TextBasedAnswerBackgroundTracker;
  private chartBackgroundTracker: ChartBackgroundTracker;
  private chartAdjustmentBackgroundTracker: ChartAdjustmentBackgroundTracker;
  private threadRecommendQuestionBackgroundTracker: ThreadRecommendQuestionBackgroundTracker;
  private queryService: IQueryService;
  private telemetry: PostHogTelemetry;
  private askingTaskTracker: IAskingTaskTracker;
  private askingTaskRepository: IAskingTaskRepository;
  private adjustmentBackgroundTracker: AdjustmentBackgroundTaskTracker;
  private skillService?: Pick<
    ISkillService,
    'listSkillBindingsByKnowledgeBase' | 'getSkillDefinitionById'
  >;
  private connectorService?: Pick<IConnectorService, 'getResolvedConnector'>;

  constructor({
    telemetry,
    wrenAIAdaptor,
    deployService,
    projectService,
    viewRepository,
    threadRepository,
    threadResponseRepository,
    askingTaskRepository,
    queryService,
    askingTaskTracker,
    skillService,
    connectorService,
  }: {
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
    skillService?: Pick<
      ISkillService,
      'listSkillBindingsByKnowledgeBase' | 'getSkillDefinitionById'
    >;
    connectorService?: Pick<IConnectorService, 'getResolvedConnector'>;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.deployService = deployService;
    this.projectService = projectService;
    this.viewRepository = viewRepository;
    this.threadRepository = threadRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.telemetry = telemetry;
    this.queryService = queryService;
    this.breakdownBackgroundTracker = new BreakdownBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      threadResponseRepository,
    });
    this.textBasedAnswerBackgroundTracker =
      new TextBasedAnswerBackgroundTracker({
        wrenAIAdaptor,
        threadResponseRepository,
        threadRepository,
        projectService,
        deployService,
        queryService,
      });
    this.chartBackgroundTracker = new ChartBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      threadResponseRepository,
    });
    this.chartAdjustmentBackgroundTracker =
      new ChartAdjustmentBackgroundTracker({
        telemetry,
        wrenAIAdaptor,
        threadResponseRepository,
      });
    this.threadRecommendQuestionBackgroundTracker =
      new ThreadRecommendQuestionBackgroundTracker({
        telemetry,
        wrenAIAdaptor,
        threadRepository,
      });
    this.adjustmentBackgroundTracker = new AdjustmentBackgroundTaskTracker({
      telemetry,
      wrenAIAdaptor,
      askingTaskRepository,
      threadResponseRepository,
    });

    this.askingTaskRepository = askingTaskRepository;
    this.askingTaskTracker = askingTaskTracker;
    this.skillService = skillService;
    this.connectorService = connectorService;
  }

  public async getThreadRecommendationQuestions(
    threadId: number,
  ): Promise<ThreadRecommendQuestionResult> {
    const thread = await this.threadRepository.findOneBy({ id: threadId });
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    // handle not started
    const res: ThreadRecommendQuestionResult = {
      status: RecommendQuestionResultStatus.NOT_STARTED,
      questions: [],
      error: null,
    };
    if (thread.queryId && thread.questionsStatus) {
      res.status = RecommendQuestionResultStatus[thread.questionsStatus]
        ? RecommendQuestionResultStatus[thread.questionsStatus]
        : res.status;
      res.questions = thread.questions || [];
      res.error = thread.questionsError as WrenAIError;
    }
    return res;
  }

  public async generateThreadRecommendationQuestions(
    threadId: number,
    runtimeScopeId?: string | null,
  ): Promise<void> {
    const thread = await this.threadRepository.findOneBy({ id: threadId });
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    if (this.threadRecommendQuestionBackgroundTracker.isExist(thread)) {
      logger.debug(
        `thread "${threadId}" recommended questions are generating, skip the current request`,
      );
      return;
    }

    const runtimeIdentity = toPersistedRuntimeIdentityFromSource(thread);
    const { project, manifest } =
      await this.getExecutionResources(runtimeIdentity);

    const threadResponses = await this.threadResponseRepository.findAllBy({
      threadId,
    });
    // descending order and get the latest 5
    const slicedThreadResponses = threadResponses
      .sort((a, b) => b.id - a.id)
      .slice(0, 5);
    const questions = slicedThreadResponses.map(({ question }) => question);
    const recommendQuestionRuntimeIdentity =
      normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);
    const recommendQuestionData: RecommendationQuestionsInput = {
      manifest,
      runtimeScopeId: runtimeScopeId || undefined,
      runtimeIdentity: recommendQuestionRuntimeIdentity,
      previousQuestions: questions,
      ...this.getThreadRecommendationQuestionsConfig(project),
    };

    const result = await this.wrenAIAdaptor.generateRecommendationQuestions(
      recommendQuestionData,
    );
    // reset thread recommended questions
    const updatedThread = await this.threadRepository.updateOne(threadId, {
      queryId: result.queryId,
      questionsStatus: RecommendationQuestionStatus.GENERATING,
      questions: [],
      questionsError: null,
    });
    this.threadRecommendQuestionBackgroundTracker.addTask(updatedThread);
    return;
  }

  public async initialize() {
    // list thread responses from database
    // filter status not finalized and put them into background tracker
    const threadResponses = await this.threadResponseRepository.findAll();
    const unfininshedBreakdownThreadResponses = threadResponses.filter(
      (threadResponse) =>
        threadResponse?.breakdownDetail?.status &&
        !isFinalized(
          threadResponse?.breakdownDetail?.status as AskResultStatus,
        ),
    );
    logger.info(
      `Initialization: adding unfininshed breakdown thread responses (total: ${unfininshedBreakdownThreadResponses.length}) to background tracker`,
    );
    for (const threadResponse of unfininshedBreakdownThreadResponses) {
      this.breakdownBackgroundTracker.addTask(threadResponse);
    }
  }

  /**
   * Asking task.
   */
  public async createAskingTask(
    input: AskingTaskInput,
    payload: AskingPayload,
    rerunFromCancelled?: boolean,
    previousTaskId?: number,
    threadResponseId?: number,
  ): Promise<Task> {
    const { threadId, language } = payload;
    const threadRuntimeIdentity = threadId
      ? await this.getThreadRuntimeIdentity(threadId, payload.runtimeIdentity)
      : null;
    const runtimeIdentity = this.resolveAskingRuntimeIdentity(
      payload,
      threadRuntimeIdentity,
    );
    const deployId =
      runtimeIdentity.deployHash || (await this.getDeployId(runtimeIdentity));

    // if it's a follow-up question, then the input will have a threadId
    // then use the threadId to get the sql and get the steps of last thread response
    // construct it into AskHistory and pass to ask
    const histories = threadId
      ? await this.getAskingHistory(threadId, runtimeIdentity, threadResponseId)
      : null;
    const askRuntimeContext = await buildAskRuntimeContext({
      runtimeIdentity: {
        ...runtimeIdentity,
        deployHash: runtimeIdentity.deployHash || deployId,
      },
      actorClaims: payload.actorClaims,
      skillService: this.skillService,
      connectorService: this.connectorService,
    });
    const { runtimeIdentity: _runtimeIdentity, ...askContextWithoutIdentity } =
      askRuntimeContext;
    const response = await this.askingTaskTracker.createAskingTask({
      query: input.question,
      histories,
      deployId,
      runtimeScopeId: payload.runtimeScopeId || undefined,
      configurations: { language },
      rerunFromCancelled,
      previousTaskId,
      threadResponseId,
      runtimeIdentity: {
        ...runtimeIdentity,
        deployHash: runtimeIdentity.deployHash || deployId,
      },
      ...askContextWithoutIdentity,
    });
    return {
      id: response.queryId,
    };
  }

  public async rerunAskingTask(
    threadResponseId: number,
    payload: AskingPayload,
  ): Promise<Task> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    // get the original question and ask again
    const question = threadResponse.question;
    const input = {
      question,
    };
    const askingPayload = {
      ...payload,
      // it's possible that the threadId is not provided in the payload
      // so we'll just use the threadId from the thread response
      threadId: threadResponse.threadId,
    };
    const task = await this.createAskingTask(
      input,
      askingPayload,
      true,
      threadResponse.askingTaskId,
      threadResponseId,
    );
    return task;
  }

  public async cancelAskingTask(taskId: string): Promise<void> {
    const eventName = TelemetryEvent.HOME_CANCEL_ASK;
    try {
      await this.askingTaskTracker.cancelAskingTask(taskId);
      this.telemetry.sendEvent(eventName, {});
    } catch (err: any) {
      this.telemetry.sendEvent(eventName, {}, err.extensions?.service, false);
      throw err;
    }
  }

  public async getAskingTask(
    taskId: string,
  ): Promise<TrackedAskingResult | null> {
    return this.askingTaskTracker.getAskingResult(taskId);
  }

  public async getAskingTaskById(
    id: number,
  ): Promise<TrackedAskingResult | null> {
    return this.askingTaskTracker.getAskingResultById(id);
  }

  /**
   * Asking detail task.
   * The process of creating a thread is as follows:
   * 1. create a thread and the first thread response
   * 2. create a task on AI service to generate the detail
   * 3. update the thread response with the task id
   */
  public async createThread(
    input: AskingDetailTaskInput,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Thread> {
    const persistedRuntimeIdentity =
      this.buildPersistedRuntimeIdentityPatch(runtimeIdentity);
    // 1. create a thread and the first thread response
    const thread = await this.threadRepository.createOne({
      ...persistedRuntimeIdentity,
      summary: input.question,
    });

    const threadResponse = await this.threadResponseRepository.createOne({
      ...toPersistedRuntimeIdentityFromSource(thread, persistedRuntimeIdentity),
      threadId: thread.id,
      question: input.question,
      sql: input.sql,
      askingTaskId: input.trackedAskingResult?.taskId,
      skillResult: input.trackedAskingResult?.skillResult || null,
    });

    // if queryId is provided, update asking task
    if (input.trackedAskingResult?.taskId) {
      await this.askingTaskTracker.bindThreadResponse(
        input.trackedAskingResult.taskId,
        input.trackedAskingResult.queryId,
        thread.id,
        threadResponse.id,
      );
    }

    // return the task id
    return thread;
  }

  public async listThreads(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Thread[]> {
    const scopedRuntimeIdentity =
      this.buildPersistedRuntimeIdentityPatch(runtimeIdentity);
    return this.threadRepository.listAllTimeDescOrderByScope({
      projectId: scopedRuntimeIdentity.projectId ?? null,
      workspaceId: scopedRuntimeIdentity.workspaceId,
      knowledgeBaseId: scopedRuntimeIdentity.knowledgeBaseId,
      kbSnapshotId: scopedRuntimeIdentity.kbSnapshotId,
      deployHash: scopedRuntimeIdentity.deployHash,
    });
  }

  public async assertThreadScope(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<Thread> {
    const scopedRuntimeIdentity =
      this.normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
    const thread = await this.threadRepository.findOneByIdWithRuntimeScope(
      threadId,
      scopedRuntimeIdentity,
    );
    if (!thread) {
      if (!(await this.threadRepository.findOneBy({ id: threadId }))) {
        throw new Error(`Thread ${threadId} not found`);
      }
      throw new Error(
        `Thread ${threadId} does not belong to the current runtime scope`,
      );
    }

    return thread;
  }

  public async assertAskingTaskScope(
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<void> {
    const scopedRuntimeIdentity =
      this.normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
    const task = await this.askingTaskRepository.findByQueryIdWithRuntimeScope(
      queryId,
      scopedRuntimeIdentity,
    );
    if (!task) {
      if (!(await this.askingTaskRepository.findByQueryId(queryId))) {
        throw new Error(`Asking task ${queryId} not found`);
      }
      throw new Error(
        `Asking task ${queryId} does not belong to the current runtime scope`,
      );
    }
  }

  public async assertAskingTaskScopeById(
    taskId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<void> {
    const scopedRuntimeIdentity =
      this.normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
    const task = await this.askingTaskRepository.findOneByIdWithRuntimeScope(
      taskId,
      scopedRuntimeIdentity,
    );
    if (!task) {
      if (!(await this.askingTaskRepository.findOneBy({ id: taskId }))) {
        throw new Error(`Asking task ${taskId} not found`);
      }
      throw new Error(
        `Asking task ${taskId} does not belong to the current runtime scope`,
      );
    }
  }

  public async assertResponseScope(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<ThreadResponse> {
    const scopedRuntimeIdentity =
      this.normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
    const response =
      await this.threadResponseRepository.findOneByIdWithRuntimeScope(
        responseId,
        scopedRuntimeIdentity,
      );
    if (!response) {
      if (!(await this.getResponse(responseId))) {
        throw new Error(`Thread response ${responseId} not found`);
      }
      throw new Error(
        `Thread response ${responseId} does not belong to the current runtime scope`,
      );
    }

    return response;
  }

  private async updateThread(
    threadId: number,
    input: Partial<AskingDetailTaskUpdateInput>,
  ): Promise<Thread> {
    // if input is empty, throw error
    if (isEmpty(input)) {
      throw new Error('Update thread input is empty');
    }

    return this.threadRepository.updateOne(threadId, {
      summary: input.summary,
    });
  }

  public async updateThreadScoped(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: Partial<AskingDetailTaskUpdateInput>,
  ): Promise<Thread> {
    await this.assertThreadScope(threadId, runtimeIdentity);
    return this.updateThread(threadId, input);
  }

  private async deleteThread(threadId: number): Promise<void> {
    await this.threadRepository.deleteOne(threadId);
  }

  public async deleteThreadScoped(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<void> {
    await this.assertThreadScope(threadId, runtimeIdentity);
    await this.deleteThread(threadId);
  }

  private async createThreadResponse(
    input: AskingDetailTaskInput,
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<ThreadResponse> {
    const thread = await this.threadRepository.findOneBy({
      id: threadId,
    });

    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const threadResponse = await this.threadResponseRepository.createOne({
      ...toPersistedRuntimeIdentityFromSource(thread, runtimeIdentity),
      threadId: thread.id,
      question: input.question,
      sql: input.sql,
      askingTaskId: input.trackedAskingResult?.taskId,
      skillResult: input.trackedAskingResult?.skillResult || null,
    });

    // if queryId is provided, update asking task
    if (input.trackedAskingResult?.taskId) {
      await this.askingTaskTracker.bindThreadResponse(
        input.trackedAskingResult.taskId,
        input.trackedAskingResult.queryId,
        thread.id,
        threadResponse.id,
      );
    }

    return threadResponse;
  }

  public async createThreadResponseScoped(
    input: AskingDetailTaskInput,
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<ThreadResponse> {
    await this.assertThreadScope(threadId, runtimeIdentity);
    return this.createThreadResponse(input, threadId, runtimeIdentity);
  }

  private async updateThreadResponse(
    responseId: number,
    data: { sql: string },
  ): Promise<ThreadResponse> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: responseId,
    });
    if (!threadResponse) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    return await this.threadResponseRepository.updateOne(responseId, {
      sql: data.sql,
    });
  }

  public async updateThreadResponseScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    data: { sql: string },
  ): Promise<ThreadResponse> {
    await this.assertResponseScope(responseId, runtimeIdentity);
    return this.updateThreadResponse(responseId, data);
  }

  private async generateThreadResponseBreakdown(
    threadResponseId: number,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    const { language } = configurations;
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    // 1. create a task on AI service to generate the detail
    const response = await this.wrenAIAdaptor.generateAskDetail({
      query: threadResponse.question,
      sql: threadResponse.sql,
      configurations: { language },
    });

    // 2. update the thread response with breakdown detail
    const updatedThreadResponse = await this.threadResponseRepository.updateOne(
      threadResponse.id,
      {
        breakdownDetail: {
          queryId: response.queryId,
          status: AskResultStatus.UNDERSTANDING,
        },
      },
    );

    // 3. put the task into background tracker
    this.breakdownBackgroundTracker.addTask(updatedThreadResponse);

    // return the task id
    return updatedThreadResponse;
  }

  public async generateThreadResponseBreakdownScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.generateThreadResponseBreakdown(
      threadResponseId,
      configurations,
    );
  }

  private async generateThreadResponseAnswer(
    threadResponseId: number,
    _configurations?: { language: string },
  ): Promise<ThreadResponse> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    // update with initial status
    const updatedThreadResponse = await this.threadResponseRepository.updateOne(
      threadResponse.id,
      {
        answerDetail: {
          status: ThreadResponseAnswerStatus.NOT_STARTED,
        },
      },
    );

    // put the task into background tracker
    this.textBasedAnswerBackgroundTracker.addTask(updatedThreadResponse);

    return updatedThreadResponse;
  }

  public async generateThreadResponseAnswerScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.generateThreadResponseAnswer(threadResponseId, configurations);
  }

  private async generateThreadResponseChart(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    // 1. create a task on AI service to generate the chart
    const response = await this.wrenAIAdaptor.generateChart({
      query: threadResponse.question,
      sql: threadResponse.sql,
      runtimeIdentity,
      configurations,
    });

    // 2. update the thread response with chart detail
    const updatedThreadResponse = await this.threadResponseRepository.updateOne(
      threadResponse.id,
      {
        chartDetail: {
          queryId: response.queryId,
          status: ChartStatus.FETCHING,
        },
      },
    );

    // 3. put the task into background tracker
    this.chartBackgroundTracker.addTask(updatedThreadResponse);

    return updatedThreadResponse;
  }

  public async generateThreadResponseChartScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.generateThreadResponseChart(
      threadResponseId,
      runtimeIdentity,
      configurations,
    );
  }

  private async adjustThreadResponseChart(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: ChartAdjustmentOption,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    // 1. create a task on AI service to adjust the chart
    const response = await this.wrenAIAdaptor.adjustChart({
      query: threadResponse.question,
      sql: threadResponse.sql,
      adjustmentOption: input,
      chartSchema: threadResponse.chartDetail?.chartSchema,
      runtimeIdentity,
      configurations,
    });

    // 2. update the thread response with chart detail
    const updatedThreadResponse = await this.threadResponseRepository.updateOne(
      threadResponse.id,
      {
        chartDetail: {
          queryId: response.queryId,
          status: ChartStatus.FETCHING,
          adjustment: true,
        },
      },
    );

    // 3. put the task into background tracker
    this.chartAdjustmentBackgroundTracker.addTask(updatedThreadResponse);

    return updatedThreadResponse;
  }

  public async adjustThreadResponseChartScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: ChartAdjustmentOption,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.adjustThreadResponseChart(
      threadResponseId,
      runtimeIdentity,
      input,
      configurations,
    );
  }

  private async getResponsesWithThread(
    threadId: number,
    runtimeIdentity?: PersistedRuntimeIdentity,
  ) {
    if (!runtimeIdentity) {
      return this.threadResponseRepository.getResponsesWithThread(threadId);
    }

    const scopedRuntimeIdentity =
      this.normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
    return this.threadResponseRepository.getResponsesWithThreadByScope(
      threadId,
      scopedRuntimeIdentity,
    );
  }

  public async getResponsesWithThreadScoped(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    await this.assertThreadScope(threadId, runtimeIdentity);
    return this.getResponsesWithThread(threadId, runtimeIdentity);
  }

  private async getResponse(responseId: number) {
    return this.threadResponseRepository.findOneBy({ id: responseId });
  }

  public async getResponseScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    return this.assertResponseScope(responseId, runtimeIdentity);
  }

  private async previewData(
    responseId: number,
    limit?: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) {
    const response = await this.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }
    const runtimeIdentity = await this.getThreadResponseRuntimeIdentity(
      response,
      fallbackRuntimeIdentity,
    );
    const { project, manifest } =
      await this.getExecutionResources(runtimeIdentity);
    const eventName = TelemetryEvent.HOME_PREVIEW_ANSWER;
    try {
      const data = (await this.queryService.preview(response.sql, {
        project,
        manifest,
        limit,
      })) as PreviewDataResponse;
      this.telemetry.sendEvent(eventName, { sql: response.sql });
      return data;
    } catch (err: any) {
      this.telemetry.sendEvent(
        eventName,
        { sql: response.sql, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async previewDataScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    limit?: number,
  ): Promise<PreviewDataResponse> {
    await this.assertResponseScope(responseId, runtimeIdentity);
    return this.previewData(responseId, limit, runtimeIdentity);
  }

  /**
   * this function is used to preview the data of a thread response
   * get the target thread response and get the steps
   * construct the CTEs and get the data
   * @param responseId: the id of the thread response
   * @param stepIndex: the step in the response detail
   * @returns Promise<QueryResponse>
   */
  private async previewBreakdownData(
    responseId: number,
    stepIndex?: number,
    limit?: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ): Promise<PreviewDataResponse> {
    const response = await this.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }
    const runtimeIdentity = await this.getThreadResponseRuntimeIdentity(
      response,
      fallbackRuntimeIdentity,
    );
    const { project, manifest } =
      await this.getExecutionResources(runtimeIdentity);
    const steps = response?.breakdownDetail?.steps;
    const sql = safeFormatSQL(constructCteSql(steps, stepIndex));
    const eventName = TelemetryEvent.HOME_PREVIEW_ANSWER;
    try {
      const data = (await this.queryService.preview(sql, {
        project,
        manifest,
        limit,
      })) as PreviewDataResponse;
      this.telemetry.sendEvent(eventName, { sql });
      return data;
    } catch (err: any) {
      this.telemetry.sendEvent(
        eventName,
        { sql, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async previewBreakdownDataScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    stepIndex?: number,
    limit?: number,
  ): Promise<PreviewDataResponse> {
    await this.assertResponseScope(responseId, runtimeIdentity);
    return this.previewBreakdownData(
      responseId,
      stepIndex,
      limit,
      runtimeIdentity,
    );
  }

  public async createInstantRecommendedQuestions(
    input: InstantRecommendedQuestionsInput,
    runtimeIdentity: PersistedRuntimeIdentity,
    runtimeScopeId?: string | null,
  ): Promise<Task> {
    const { project, manifest } =
      await this.getExecutionResources(runtimeIdentity);

    const recommendQuestionRuntimeIdentity =
      normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);
    const response = await this.wrenAIAdaptor.generateRecommendationQuestions({
      manifest,
      runtimeScopeId: runtimeScopeId || undefined,
      runtimeIdentity: recommendQuestionRuntimeIdentity,
      previousQuestions: input.previousQuestions,
      ...this.getThreadRecommendationQuestionsConfig(project),
    });
    this.trackInstantRecommendedQuestionTask(response.queryId, runtimeIdentity);
    return { id: response.queryId };
  }

  public async getInstantRecommendedQuestions(
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<RecommendationQuestionsResult> {
    this.assertInstantRecommendedQuestionTaskScope(queryId, runtimeIdentity);
    const response =
      await this.wrenAIAdaptor.getRecommendationQuestionsResult(queryId);
    if (isRecommendationQuestionsFinalized(response.status)) {
      this.instantRecommendedQuestionTasks.delete(queryId);
    }
    return response;
  }

  public async deleteAllByProjectId(projectId: number): Promise<void> {
    // delete all threads
    await this.threadRepository.deleteAllBy({ projectId });
  }

  private async changeThreadResponseAnswerDetailStatus(
    responseId: number,
    status: ThreadResponseAnswerStatus,
    content?: string,
  ): Promise<ThreadResponse> {
    const response = await this.threadResponseRepository.findOneBy({
      id: responseId,
    });
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    if (response.answerDetail?.status === status) {
      return;
    }

    const updatedResponse = await this.threadResponseRepository.updateOne(
      responseId,
      {
        answerDetail: {
          ...response.answerDetail,
          status,
          content,
        },
      },
    );

    return updatedResponse;
  }

  public async changeThreadResponseAnswerDetailStatusScoped(
    responseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    status: ThreadResponseAnswerStatus,
    content?: string,
  ): Promise<ThreadResponse> {
    await this.assertResponseScope(responseId, runtimeIdentity);
    return this.changeThreadResponseAnswerDetailStatus(
      responseId,
      status,
      content,
    );
  }

  private async getDeployId(runtimeIdentity: PersistedRuntimeIdentity) {
    const deploymentLookupIdentity =
      this.buildPersistedRuntimeIdentityPatch(runtimeIdentity);
    const lastDeploy =
      await this.deployService.getLastDeploymentByRuntimeIdentity(
        deploymentLookupIdentity,
      );
    if (!lastDeploy) {
      throw new Error('No deployment found, please deploy your project first');
    }
    return lastDeploy.hash;
  }

  private async getProjectAndDeployment(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<{ project: Project; deployment: Deploy }> {
    const deploymentLookupIdentity = runtimeIdentity.deployHash
      ? this.buildPersistedRuntimeIdentityPatch(runtimeIdentity)
      : runtimeIdentity;
    const deployment = await this.deployService.getDeploymentByRuntimeIdentity(
      deploymentLookupIdentity,
    );

    if (!deployment) {
      throw new Error('No deployment found, please deploy your project first');
    }

    const project =
      (await this.projectService.getProjectById(deployment.projectId)) ||
      this.buildManifestBackedProject(deployment);
    if (!project) {
      throw new Error(`Project ${deployment.projectId} not found`);
    }

    return { project, deployment };
  }

  private resolveAskingRuntimeIdentity(
    payload: AskingPayload,
    threadRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ): PersistedRuntimeIdentity {
    if (threadRuntimeIdentity) {
      return threadRuntimeIdentity;
    }

    if (!payload.runtimeIdentity) {
      throw new Error(
        'createAskingTask requires runtime identity when threadId is absent',
      );
    }

    return normalizeCanonicalPersistedRuntimeIdentity(
      toPersistedRuntimeIdentityFromSource(payload.runtimeIdentity),
    );
  }

  private buildPersistedRuntimeIdentityPatch(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): PersistedRuntimeIdentity {
    return normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);
  }

  private async getThreadById(threadId: number): Promise<Thread> {
    const thread = await this.threadRepository.findOneBy({ id: threadId });
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    return thread;
  }

  private async getThreadRuntimeIdentity(
    threadId: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ): Promise<PersistedRuntimeIdentity> {
    const runtimeIdentityFallback = fallbackRuntimeIdentity
      ? normalizeCanonicalPersistedRuntimeIdentity({
          ...fallbackRuntimeIdentity,
          deployHash: null,
        })
      : null;

    return toPersistedRuntimeIdentityFromSource(
      await this.getThreadById(threadId),
      runtimeIdentityFallback,
    );
  }

  private async getThreadResponseRuntimeIdentity(
    threadResponse: ThreadResponse,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ): Promise<PersistedRuntimeIdentity> {
    const threadIdentity = await this.getThreadRuntimeIdentity(
      threadResponse.threadId,
      fallbackRuntimeIdentity,
    );

    return toPersistedRuntimeIdentityFromSource(threadResponse, threadIdentity);
  }

  private async getExecutionResources(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<{
    project: Project;
    deployment: Deploy;
    manifest: Deploy['manifest'];
  }> {
    const { project, deployment } =
      await this.getProjectAndDeployment(runtimeIdentity);
    return {
      project,
      deployment,
      manifest: deployment.manifest,
    };
  }

  private async adjustThreadResponseWithSQL(
    threadResponseId: number,
    input: AdjustmentSqlInput,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ): Promise<ThreadResponse> {
    const response = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });
    if (!response) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }
    const runtimeIdentity = await this.getThreadResponseRuntimeIdentity(
      response,
      fallbackRuntimeIdentity,
    );

    return await this.threadResponseRepository.createOne({
      ...runtimeIdentity,
      sql: input.sql,
      threadId: response.threadId,
      question: response.question,
      adjustment: {
        type: ThreadResponseAdjustmentType.APPLY_SQL,
        payload: {
          originalThreadResponseId: response.id,
          sql: input.sql,
        },
      },
    });
  }

  public async adjustThreadResponseWithSQLScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: AdjustmentSqlInput,
  ): Promise<ThreadResponse> {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.adjustThreadResponseWithSQL(
      threadResponseId,
      input,
      runtimeIdentity,
    );
  }

  private async adjustThreadResponseAnswer(
    threadResponseId: number,
    input: AdjustmentReasoningInput,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    const originalThreadResponse =
      await this.threadResponseRepository.findOneBy({
        id: threadResponseId,
      });
    if (!originalThreadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    const { createdThreadResponse } =
      await this.adjustmentBackgroundTracker.createAdjustmentTask({
        threadId: originalThreadResponse.threadId,
        tables: input.tables,
        sqlGenerationReasoning: input.sqlGenerationReasoning,
        sql: originalThreadResponse.sql,
        runtimeIdentity: input.runtimeIdentity,
        configurations,
        question: originalThreadResponse.question,
        originalThreadResponseId: originalThreadResponse.id,
      });
    return createdThreadResponse;
  }

  public async adjustThreadResponseAnswerScoped(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: AdjustmentReasoningInput,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    await this.assertResponseScope(threadResponseId, runtimeIdentity);
    return this.adjustThreadResponseAnswer(
      threadResponseId,
      input,
      configurations,
    );
  }

  public async cancelAdjustThreadResponseAnswer(taskId: string): Promise<void> {
    // call cancelAskFeedback on AI service
    await this.adjustmentBackgroundTracker.cancelAdjustmentTask(taskId);
  }

  public async rerunAdjustThreadResponseAnswer(
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
  ): Promise<{ queryId: string }> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });
    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    const { queryId } =
      await this.adjustmentBackgroundTracker.rerunAdjustmentTask({
        threadId: threadResponse.threadId,
        threadResponseId,
        runtimeIdentity,
        configurations,
      });
    return { queryId };
  }

  public async getAdjustmentTask(
    taskId: string,
  ): Promise<TrackedAdjustmentResult | null> {
    return this.adjustmentBackgroundTracker.getAdjustmentResult(taskId);
  }

  public async getAdjustmentTaskById(
    id: number,
  ): Promise<TrackedAdjustmentResult | null> {
    return this.adjustmentBackgroundTracker.getAdjustmentResultById(id);
  }

  /**
   * Get the thread response of a thread for asking
   * @param threadId
   * @returns Promise<ThreadResponse[]>
   */
  private async getAskingHistory(
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    excludeThreadResponseId?: number,
  ): Promise<ThreadResponse[]> {
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

    // exclude the thread response if the excludeThreadResponseId is provided
    // it's used when rerun the asking task, we don't want include the cancelled thread response
    if (excludeThreadResponseId) {
      responses = responses.filter(
        (response) => response.id !== excludeThreadResponseId,
      );
    }

    // filter out the thread response with empty sql
    return responses.filter((response) => response.sql);
  }

  private getThreadRecommendationQuestionsConfig(project: Project) {
    return {
      maxCategories: config.threadRecommendationQuestionMaxCategories,
      maxQuestions: config.threadRecommendationQuestionsMaxQuestions,
      configuration: {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    };
  }

  private trackInstantRecommendedQuestionTask(
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    this.instantRecommendedQuestionTasks.set(queryId, {
      runtimeIdentity:
        this.normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity,
      createdAt: Date.now(),
    });
  }

  private assertInstantRecommendedQuestionTaskScope(
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) {
    const task = this.instantRecommendedQuestionTasks.get(queryId);
    const scopedRuntimeIdentity =
      this.normalizeRuntimeScope(runtimeIdentity) ?? runtimeIdentity;
    if (
      !task ||
      !isPersistedRuntimeIdentityMatch(
        task.runtimeIdentity,
        scopedRuntimeIdentity,
      )
    ) {
      throw new Error('Instant recommended questions task not found');
    }
  }

  private buildManifestBackedProject(deployment: Deploy): Project | null {
    if (!deployment?.manifest) {
      return null;
    }

    const manifest = deployment.manifest as Manifest;
    if (!manifest.catalog || !manifest.schema || !manifest.dataSource) {
      return null;
    }

    const type = this.mapManifestDataSourceToProjectType(manifest.dataSource);
    if (!type) {
      return null;
    }

    return {
      id: deployment.projectId,
      type,
      version: '',
      displayName: '',
      catalog: manifest.catalog,
      schema: manifest.schema,
      sampleDataset: null as any,
      connectionInfo: {} as any,
      language: undefined,
      queryId: undefined,
      questions: [],
      questionsStatus: undefined,
      questionsError: undefined,
    };
  }

  private mapManifestDataSourceToProjectType(
    dataSource: WrenEngineDataSourceType,
  ): DataSourceName | null {
    switch (dataSource) {
      case WrenEngineDataSourceType.ATHENA:
        return DataSourceName.ATHENA;
      case WrenEngineDataSourceType.BIGQUERY:
        return DataSourceName.BIG_QUERY;
      case WrenEngineDataSourceType.CLICKHOUSE:
        return DataSourceName.CLICK_HOUSE;
      case WrenEngineDataSourceType.MSSQL:
        return DataSourceName.MSSQL;
      case WrenEngineDataSourceType.ORACLE:
        return DataSourceName.ORACLE;
      case WrenEngineDataSourceType.MYSQL:
        return DataSourceName.MYSQL;
      case WrenEngineDataSourceType.POSTGRES:
        return DataSourceName.POSTGRES;
      case WrenEngineDataSourceType.SNOWFLAKE:
        return DataSourceName.SNOWFLAKE;
      case WrenEngineDataSourceType.TRINO:
        return DataSourceName.TRINO;
      case WrenEngineDataSourceType.DUCKDB:
        return DataSourceName.DUCKDB;
      case WrenEngineDataSourceType.DATABRICKS:
        return DataSourceName.DATABRICKS;
      case WrenEngineDataSourceType.REDSHIFT:
        return DataSourceName.REDSHIFT;
      default:
        return null;
    }
  }

  private normalizeRuntimeScope(
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ): PersistedRuntimeIdentity | null {
    if (!runtimeIdentity) {
      return null;
    }

    return this.buildPersistedRuntimeIdentityPatch(runtimeIdentity);
  }
}
