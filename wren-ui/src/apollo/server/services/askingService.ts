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
import { IDeployService } from './deployService';
import { IProjectService } from './projectService';
import { IThreadRepository, Thread } from '../repositories/threadRepository';
import {
  IThreadResponseRepository,
  ThreadResponse,
  ThreadResponseAnswerDetail,
  ThreadResponseAdjustmentType,
} from '../repositories/threadResponseRepository';
import { getLogger } from '@server/utils';
import { isEmpty, isNil } from 'lodash';
import { safeFormatSQL } from '@server/utils/sqlFormat';
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
import { IMDLService } from './mdlService';
import {
  ThreadRecommendQuestionBackgroundTracker,
  ChartBackgroundTracker,
  ChartAdjustmentBackgroundTracker,
  AdjustmentBackgroundTaskTracker,
  TrackedAdjustmentResult,
} from '../backgrounds';
import { getConfig } from '@server/config';
import { buildFastRecommendationQuestions } from '../utils/recommendationQuestions';
import { TextBasedAnswerBackgroundTracker } from '../backgrounds/textBasedAnswerBackgroundTracker';
import { IAskingTaskTracker, TrackedAskingResult } from './askingTaskTracker';

const config = getConfig();

const logger = getLogger('AskingService');
logger.level = 'debug';

// const QUERY_ID_PLACEHOLDER = '0';

export interface Task {
  id: string;
}

export interface AskingPayload {
  threadId?: number;
  language: string;
  projectId?: number;
}

export interface AskingTaskInput {
  question: string;
}

export interface AskingDetailTaskInput {
  question?: string;
  sql?: string;
  trackedAskingResult?: TrackedAskingResult;
  answerDetail?: ThreadResponseAnswerDetail;
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

export enum ThreadResponseAnswerStatus {
  NOT_STARTED = 'NOT_STARTED',
  FETCHING_DATA = 'FETCHING_DATA',
  PREPROCESSING = 'PREPROCESSING',
  STREAMING = 'STREAMING',
  FINISHED = 'FINISHED',
  FAILED = 'FAILED',
  INTERRUPTED = 'INTERRUPTED',
}

const isAnswerGenerationInProgress = (
  status?: ThreadResponseAnswerStatus | string | null,
) =>
  (
    [
      ThreadResponseAnswerStatus.NOT_STARTED,
      ThreadResponseAnswerStatus.FETCHING_DATA,
      ThreadResponseAnswerStatus.PREPROCESSING,
      ThreadResponseAnswerStatus.STREAMING,
    ] as string[]
  ).includes(status || '');

const isChartGenerationInProgress = (status?: ChartStatus | string | null) =>
  ([ChartStatus.FETCHING, ChartStatus.GENERATING] as string[]).includes(
    status || '',
  );

const isContextualFollowUpQuestion = (question?: string) => {
  if (!question) return false;
  return /\b(previous|last|above|earlier|same|that|those|them|it|this)\b/i.test(
    question,
  );
};

// adjustment input
export interface AdjustmentReasoningInput {
  tables: string[];
  sqlGenerationReasoning: string;
  projectId: number;
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
  createThread(input: AskingDetailTaskInput): Promise<Thread>;
  updateThread(
    threadId: number,
    input: Partial<AskingDetailTaskUpdateInput>,
  ): Promise<Thread>;
  deleteThread(threadId: number): Promise<void>;
  listThreads(): Promise<Thread[]>;
  createThreadResponse(
    input: AskingDetailTaskInput,
    threadId: number,
  ): Promise<ThreadResponse>;
  updateThreadResponse(
    responseId: number,
    data: { sql: string },
  ): Promise<ThreadResponse>;
  getResponsesWithThread(threadId: number): Promise<ThreadResponse[]>;
  getResponse(responseId: number): Promise<ThreadResponse>;
  generateThreadResponseBreakdown(
    threadResponseId: number,
    configurations: { language: string },
  ): Promise<ThreadResponse>;
  generateThreadResponseAnswer(
    threadResponseId: number,
    configurations: { language: string },
  ): Promise<ThreadResponse>;
  generateThreadResponseChart(
    threadResponseId: number,
    configurations: { language: string },
  ): Promise<ThreadResponse>;
  adjustThreadResponseChart(
    threadResponseId: number,
    input: ChartAdjustmentOption,
    configurations: { language: string },
  ): Promise<ThreadResponse>;
  adjustThreadResponseWithSQL(
    threadResponseId: number,
    input: AdjustmentSqlInput,
  ): Promise<ThreadResponse>;
  adjustThreadResponseAnswer(
    threadResponseId: number,
    input: AdjustmentReasoningInput,
    configurations: { language: string },
  ): Promise<ThreadResponse>;
  cancelAdjustThreadResponseAnswer(taskId: string): Promise<void>;
  rerunAdjustThreadResponseAnswer(
    threadResponseId: number,
    projectId: number,
    configurations: { language: string },
  ): Promise<{ queryId: string }>;
  getAdjustmentTask(taskId: string): Promise<TrackedAdjustmentResult>;
  getAdjustmentTaskById(id: number): Promise<TrackedAdjustmentResult>;
  changeThreadResponseAnswerDetailStatus(
    responseId: number,
    status: ThreadResponseAnswerStatus,
    content?: string,
  ): Promise<ThreadResponse>;
  previewData(responseId: number, limit?: number): Promise<PreviewDataResponse>;
  previewBreakdownData(
    responseId: number,
    stepIndex?: number,
    limit?: number,
  ): Promise<PreviewDataResponse>;

  /**
   * Recommendation questions
   */
  createInstantRecommendedQuestions(
    input: InstantRecommendedQuestionsInput,
  ): Promise<Task>;
  getInstantRecommendedQuestions(
    queryId: string,
  ): Promise<RecommendationQuestionsResult>;
  generateThreadRecommendationQuestions(threadId: number): Promise<void>;
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
    this.intervalTime = 2000;
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
          threadResponse.breakdownDetail = updatedBreakdownDetail;

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
  private mdlService: IMDLService;
  private askingTaskTracker: IAskingTaskTracker;
  private askingTaskRepository: IAskingTaskRepository;
  private adjustmentBackgroundTracker: AdjustmentBackgroundTaskTracker;
  private instantRecommendationJobs = new Map<string, Promise<Task>>();
  private instantRecommendationResults = new Map<
    string,
    RecommendationQuestionsResult
  >();
  private threadRecommendationJobs = new Map<number, Promise<void>>();
  private initialized = false;

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
    mdlService,
    askingTaskTracker,
    chartBackgroundTracker,
    chartAdjustmentBackgroundTracker,
    threadRecommendQuestionBackgroundTracker,
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
    mdlService: IMDLService;
    askingTaskTracker: IAskingTaskTracker;
    chartBackgroundTracker?: ChartBackgroundTracker;
    chartAdjustmentBackgroundTracker?: ChartAdjustmentBackgroundTracker;
    threadRecommendQuestionBackgroundTracker?: ThreadRecommendQuestionBackgroundTracker;
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
        threadRepository,
        threadResponseRepository,
        projectService,
        deployService,
        queryService,
      });
    this.chartBackgroundTracker =
      chartBackgroundTracker ??
      new ChartBackgroundTracker({
        telemetry,
        wrenAIAdaptor,
        threadResponseRepository,
      });
    this.chartAdjustmentBackgroundTracker =
      chartAdjustmentBackgroundTracker ??
      new ChartAdjustmentBackgroundTracker({
        telemetry,
        wrenAIAdaptor,
        threadResponseRepository,
      });
    this.threadRecommendQuestionBackgroundTracker =
      threadRecommendQuestionBackgroundTracker ??
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
    this.mdlService = mdlService;
    this.askingTaskTracker = askingTaskTracker;
  }

  public dispose(): void {
    this.chartBackgroundTracker.stop();
    this.chartAdjustmentBackgroundTracker.stop();
    this.threadRecommendQuestionBackgroundTracker.stop();
    this.askingTaskTracker.stopPolling();
  }

  public async getThreadRecommendationQuestions(
    threadId: number,
  ): Promise<ThreadRecommendQuestionResult> {
    const thread = await this.ensureThreadInCurrentProject(threadId);

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
  ): Promise<void> {
    const existingJob = this.threadRecommendationJobs.get(threadId);
    if (existingJob) {
      logger.debug(
        `thread "${threadId}" recommended questions are already being requested, reusing in-flight job`,
      );
      return existingJob;
    }

    const job = this.doGenerateThreadRecommendationQuestions(threadId);
    this.threadRecommendationJobs.set(threadId, job);
    try {
      return await job;
    } finally {
      this.threadRecommendationJobs.delete(threadId);
    }
  }

  private async doGenerateThreadRecommendationQuestions(
    threadId: number,
  ): Promise<void> {
    const thread = await this.ensureThreadInCurrentProject(threadId);

    if (this.threadRecommendQuestionBackgroundTracker.isExist(thread)) {
      logger.debug(
        `thread "${threadId}" recommended questions are generating, skip the current request`,
      );
      return;
    }

    const project = await this.projectService.getProjectById(thread.projectId);
    const { manifest } = await this.mdlService.makeModelMDL(project);

    const threadResponses = await this.threadResponseRepository.findAllBy({
      threadId,
    });
    // descending order and get the latest 5
    const slicedThreadResponses = threadResponses
      .sort((a, b) => b.id - a.id)
      .slice(0, 5);
    const questions = slicedThreadResponses.map(({ question }) => question);
    const fastQuestions = await this.filterExecutableRecommendationQuestions(
      buildFastRecommendationQuestions(
        manifest,
        this.getThreadRecommendationQuestionsConfig(project).maxQuestions,
        questions,
      ),
      project,
      manifest,
      this.getThreadRecommendationQuestionsConfig(project).maxQuestions,
    );
    if (fastQuestions.length) {
      await this.threadRepository.updateOne(threadId, {
        queryId: `fast-thread-${threadId}-${Date.now()}`,
        questionsStatus: RecommendationQuestionStatus.FINISHED,
        questions: fastQuestions,
        questionsError: null,
      });
      return;
    }

    const recommendQuestionData: RecommendationQuestionsInput = {
      manifest,
      projectId: project.id.toString(),
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
    if (this.initialized) {
      return;
    }

    if (typeof this.askingTaskTracker?.initialize === 'function') {
      await this.askingTaskTracker.initialize();
    } else {
      logger.warn(
        'Asking task tracker does not expose initialize(); skipping tracker restoration',
      );
    }

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

    this.initialized = true;
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
    const currentProject = await this.projectService.getCurrentProject();
    let projectId = payload.projectId ?? currentProject.id;
    if (threadId) {
      const thread = await this.threadRepository.findOneBy({ id: threadId });
      if (!thread) {
        throw new Error(`Thread ${threadId} not found`);
      }
      if (payload.projectId && payload.projectId !== thread.projectId) {
        throw new Error(
          `Thread ${threadId} does not belong to project ${payload.projectId}`,
        );
      }
      projectId = thread.projectId;
    } else if (projectId !== currentProject.id) {
      throw new Error(`Project ${projectId} is not the active project`);
    }
    const deployId = await this.getDeployId(projectId);

    // if it's a follow-up question, then the input will have a threadId
    // then use the threadId to get the sql and get the steps of last thread response
    // construct it into AskHistory and pass to ask
    const histories = threadId && isContextualFollowUpQuestion(input.question)
      ? await this.getAskingHistory(threadId, threadResponseId)
      : null;
    const response = await this.askingTaskTracker.createAskingTask({
      query: input.question,
      histories,
      deployId,
      projectId: projectId.toString(),
      configurations: { language },
      rerunFromCancelled,
      previousTaskId,
      threadResponseId,
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
  public async createThread(input: AskingDetailTaskInput): Promise<Thread> {
    // 1. create a thread and the first thread response
    const { id } = await this.projectService.getCurrentProject();
    const thread = await this.threadRepository.createOne({
      projectId: id,
      summary: input.question,
    });

    const threadResponse = await this.threadResponseRepository.createOne({
      threadId: thread.id,
      question: input.question,
      sql: input.sql,
      askingTaskId: input.trackedAskingResult?.taskId,
      answerDetail: input.answerDetail,
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

  public async listThreads(): Promise<Thread[]> {
    const { id } = await this.projectService.getCurrentProject();
    return await this.threadRepository.listAllTimeDescOrder(id);
  }

  public async updateThread(
    threadId: number,
    input: Partial<AskingDetailTaskUpdateInput>,
  ): Promise<Thread> {
    // if input is empty, throw error
    if (isEmpty(input)) {
      throw new Error('Update thread input is empty');
    }

    await this.ensureThreadInCurrentProject(threadId);
    return this.threadRepository.updateOne(threadId, {
      summary: input.summary,
    });
  }

  public async deleteThread(threadId: number): Promise<void> {
    await this.ensureThreadInCurrentProject(threadId);
    await this.threadRepository.deleteOne(threadId);
  }

  public async createThreadResponse(
    input: AskingDetailTaskInput,
    threadId: number,
  ): Promise<ThreadResponse> {
    const thread = await this.ensureThreadInCurrentProject(threadId);

    const threadResponse = await this.threadResponseRepository.createOne({
      threadId: thread.id,
      question: input.question,
      sql: input.sql,
      askingTaskId: input.trackedAskingResult?.taskId,
      answerDetail: input.answerDetail,
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

  public async updateThreadResponse(
    responseId: number,
    data: { sql: string },
  ): Promise<ThreadResponse> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: responseId,
    });
    if (!threadResponse) {
      throw new Error(`Thread response ${responseId} not found`);
    }
    await this.ensureThreadInCurrentProject(threadResponse.threadId);

    return await this.threadResponseRepository.updateOne(responseId, {
      sql: data.sql,
      viewId: null,
      answerDetail: null,
      breakdownDetail: null,
      chartDetail: null,
    });
  }

  public async generateThreadResponseBreakdown(
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

  public async generateThreadResponseAnswer(
    threadResponseId: number,
  ): Promise<ThreadResponse> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    if (isAnswerGenerationInProgress(threadResponse.answerDetail?.status)) {
      logger.debug(
        `Thread response ${threadResponseId} answer generation already in progress, skipping duplicate request`,
      );
      return threadResponse;
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

  public async generateThreadResponseChart(
    threadResponseId: number,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    if (isChartGenerationInProgress(threadResponse.chartDetail?.status)) {
      logger.debug(
        `Thread response ${threadResponseId} chart generation already in progress, skipping duplicate request`,
      );
      return threadResponse;
    }

    const project = await this.getProjectForThreadResponse(threadResponse);
    const deployment = await this.deployService.getLastDeployment(project.id);
    let chartData: PreviewDataResponse;
    try {
      chartData = (await this.queryService.preview(threadResponse.sql, {
        project,
        manifest: deployment.manifest,
        modelingOnly: false,
        limit: 100,
        cacheEnabled: false,
      })) as PreviewDataResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Preview failed before chart generation for response ${threadResponse.id}. ${message}`,
      );
      throw error;
    }

    // 1. create a task on AI service to generate the chart
    const response = await this.wrenAIAdaptor.generateChart({
      query: threadResponse.question,
      sql: threadResponse.sql,
      data: chartData,
      projectId: project.id.toString(),
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

  public async adjustThreadResponseChart(
    threadResponseId: number,
    input: ChartAdjustmentOption,
    configurations: { language: string },
  ): Promise<ThreadResponse> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });

    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }

    if (
      isChartGenerationInProgress(threadResponse.chartDetail?.status) &&
      threadResponse.chartDetail?.adjustment
    ) {
      logger.debug(
        `Thread response ${threadResponseId} chart adjustment already in progress, skipping duplicate request`,
      );
      return threadResponse;
    }

    const project = await this.getProjectForThreadResponse(threadResponse);
    const deployment = await this.deployService.getLastDeployment(project.id);
    let chartData: PreviewDataResponse;
    try {
      chartData = (await this.queryService.preview(threadResponse.sql, {
        project,
        manifest: deployment.manifest,
        modelingOnly: false,
        limit: 500,
        cacheEnabled: false,
      })) as PreviewDataResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Preview failed before chart adjustment for response ${threadResponse.id}. ${message}`,
      );
      throw error;
    }

    // 1. create a task on AI service to adjust the chart
    const response = await this.wrenAIAdaptor.adjustChart({
      query: threadResponse.question,
      sql: threadResponse.sql,
      data: chartData,
      projectId: project.id.toString(),
      adjustmentOption: input,
      chartSchema: threadResponse.chartDetail?.chartSchema,
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

  public async getResponsesWithThread(threadId: number) {
    await this.ensureThreadInCurrentProject(threadId);
    return this.threadResponseRepository.getResponsesWithThread(threadId);
  }

  public async getResponse(responseId: number) {
    const response = await this.threadResponseRepository.findOneBy({
      id: responseId,
    });
    if (!response) {
      return null;
    }
    return response;
  }

  public async previewData(responseId: number, limit?: number) {
    const response = await this.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }
    const project = await this.getProjectForThreadResponse(response);
    const deployment = await this.deployService.getLastDeployment(project.id);
    const mdl = deployment.manifest;
    const eventName = TelemetryEvent.HOME_PREVIEW_ANSWER;
    try {
      const data = (await this.queryService.preview(response.sql, {
        project,
        manifest: mdl,
        limit,
        cacheEnabled: false,
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

  /**
   * this function is used to preview the data of a thread response
   * get the target thread response and get the steps
   * construct the CTEs and get the data
   * @param responseId: the id of the thread response
   * @param stepIndex: the step in the response detail
   * @returns Promise<QueryResponse>
   */
  public async previewBreakdownData(
    responseId: number,
    stepIndex?: number,
    limit?: number,
  ): Promise<PreviewDataResponse> {
    const response = await this.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }
    const project = await this.getProjectForThreadResponse(response);
    const deployment = await this.deployService.getLastDeployment(project.id);
    const mdl = deployment.manifest;
    const steps = response?.breakdownDetail?.steps;
    const sql = safeFormatSQL(constructCteSql(steps, stepIndex));
    const eventName = TelemetryEvent.HOME_PREVIEW_ANSWER;
    try {
      const data = (await this.queryService.preview(sql, {
        project,
        manifest: mdl,
        limit,
        cacheEnabled: false,
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

  public async createInstantRecommendedQuestions(
    input: InstantRecommendedQuestionsInput,
  ): Promise<Task> {
    const project = await this.projectService.getCurrentProject();
    const key = JSON.stringify({
      projectId: project.id,
      previousQuestions: input.previousQuestions || [],
    });
    const existingJob = this.instantRecommendationJobs.get(key);
    if (existingJob) {
      logger.debug('instant recommended questions are already being requested');
      return existingJob;
    }

    const job = this.doCreateInstantRecommendedQuestions(input, project);
    this.instantRecommendationJobs.set(key, job);
    try {
      return await job;
    } finally {
      this.instantRecommendationJobs.delete(key);
    }
  }

  private async doCreateInstantRecommendedQuestions(
    input: InstantRecommendedQuestionsInput,
    project?: Project,
  ): Promise<Task> {
    const currentProject =
      project ?? (await this.projectService.getCurrentProject());
    const { manifest } = await this.deployService.getLastDeployment(
      currentProject.id,
    );

    const fastQuestions = await this.filterExecutableRecommendationQuestions(
      buildFastRecommendationQuestions(
        manifest,
        this.getThreadRecommendationQuestionsConfig(currentProject).maxQuestions,
        input.previousQuestions || [],
      ),
      currentProject,
      manifest,
      this.getThreadRecommendationQuestionsConfig(currentProject).maxQuestions,
    );
    if (fastQuestions.length) {
      const queryId = `fast-instant-${currentProject.id}-${Date.now()}`;
      this.instantRecommendationResults.set(queryId, {
        status: RecommendationQuestionStatus.FINISHED,
        type: null,
        response: { questions: fastQuestions },
        error: null,
      });
      setTimeout(
        () => this.instantRecommendationResults.delete(queryId),
        5 * 60 * 1000,
      );
      return { id: queryId };
    }

    const response = await this.wrenAIAdaptor.generateRecommendationQuestions({
      manifest,
      projectId: currentProject.id.toString(),
      previousQuestions: input.previousQuestions,
      ...this.getThreadRecommendationQuestionsConfig(currentProject),
    });
    return { id: response.queryId };
  }

  public async getInstantRecommendedQuestions(
    queryId: string,
  ): Promise<RecommendationQuestionsResult> {
    const localResult = this.instantRecommendationResults.get(queryId);
    if (localResult) {
      return localResult;
    }

    const response =
      await this.wrenAIAdaptor.getRecommendationQuestionsResult(queryId);
    return response;
  }

  private async filterExecutableRecommendationQuestions(
    questions: RecommendationQuestion[],
    project: Project,
    manifest: any,
    maxQuestions: number,
  ): Promise<RecommendationQuestion[]> {
    const validQuestions: RecommendationQuestion[] = [];
    for (const question of questions) {
      try {
        const result = (await this.queryService.preview(question.sql, {
          project,
          manifest,
          modelingOnly: false,
          limit: 1,
          cacheEnabled: false,
        })) as PreviewDataResponse;
        if (result?.data?.length) {
          validQuestions.push(question);
          if (validQuestions.length >= maxQuestions) {
            break;
          }
        }
      } catch (error) {
        logger.warn(
          `Skipping recommended question because SQL preview failed: ${question.question}. ${error}`,
        );
      }
    }
    return validQuestions;
  }

  public async deleteAllByProjectId(projectId: number): Promise<void> {
    // delete all threads
    await this.threadRepository.deleteAllBy({ projectId });
  }

  public async changeThreadResponseAnswerDetailStatus(
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

    if (
      response.answerDetail?.status === status &&
      (!content || response.answerDetail?.content === content)
    ) {
      return response;
    }

    const updatedResponse = await this.threadResponseRepository.updateOne(
      responseId,
      {
        answerDetail: {
          ...response.answerDetail,
          status,
          content: content ?? response.answerDetail?.content,
        },
      },
    );

    return updatedResponse;
  }

  private async getDeployId(projectId?: number) {
    const id = projectId ?? (await this.projectService.getCurrentProject()).id;
    const lastDeploy = await this.deployService.getLastDeployment(id);
    return lastDeploy.hash;
  }

  private async getProjectForThreadResponse(threadResponse: ThreadResponse) {
    const thread = await this.threadRepository.findOneBy({
      id: threadResponse.threadId,
    });
    if (!thread) {
      throw new Error(`Thread ${threadResponse.threadId} not found`);
    }

    return this.projectService.getProjectById(thread.projectId);
  }

  public async adjustThreadResponseWithSQL(
    threadResponseId: number,
    input: AdjustmentSqlInput,
  ): Promise<ThreadResponse> {
    const response = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });
    if (!response) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }
    await this.ensureThreadInCurrentProject(response.threadId);

    return await this.threadResponseRepository.createOne({
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

  public async adjustThreadResponseAnswer(
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
    await this.ensureThreadInCurrentProject(originalThreadResponse.threadId);

    const { createdThreadResponse } =
      await this.adjustmentBackgroundTracker.createAdjustmentTask({
        threadId: originalThreadResponse.threadId,
        tables: input.tables,
        sqlGenerationReasoning: input.sqlGenerationReasoning,
        sql: originalThreadResponse.sql,
        projectId: input.projectId,
        configurations,
        question: originalThreadResponse.question,
        originalThreadResponseId: originalThreadResponse.id,
      });
    return createdThreadResponse;
  }

  public async cancelAdjustThreadResponseAnswer(taskId: string): Promise<void> {
    // call cancelAskFeedback on AI service
    await this.adjustmentBackgroundTracker.cancelAdjustmentTask(taskId);
  }

  public async rerunAdjustThreadResponseAnswer(
    threadResponseId: number,
    projectId: number,
    configurations: { language: string },
  ): Promise<{ queryId: string }> {
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });
    if (!threadResponse) {
      throw new Error(`Thread response ${threadResponseId} not found`);
    }
    await this.ensureThreadInCurrentProject(threadResponse.threadId);

    const { queryId } =
      await this.adjustmentBackgroundTracker.rerunAdjustmentTask({
        threadId: threadResponse.threadId,
        threadResponseId,
        projectId,
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
    excludeThreadResponseId?: number,
  ): Promise<ThreadResponse[]> {
    if (!threadId) {
      return [];
    }
    let responses = await this.threadResponseRepository.getResponsesWithThread(
      threadId,
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
      regenerate: true,
      configuration: {
        language: WrenAILanguage[project.language] || WrenAILanguage.EN,
      },
    };
  }

  private async ensureThreadInCurrentProject(threadId: number): Promise<Thread> {
    const [thread, project] = await Promise.all([
      this.threadRepository.findOneBy({ id: threadId }),
      this.projectService.getCurrentProject(),
    ]);

    if (!thread || thread.projectId !== project.id) {
      throw new Error(`Thread ${threadId} not found in current project`);
    }

    return thread;
  }
}
