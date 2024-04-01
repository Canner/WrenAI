import {
  AskResult,
  IWrenAIAdaptor,
  AskResultStatus,
  AskHistory,
} from '@server/adaptors/wrenAIAdaptor';
import { IDeployService } from './deployService';
import { IProjectService } from './projectService';
import { IThreadRepository, Thread } from '../repositories/threadRepository';
import {
  IThreadResponseRepository,
  ThreadResponse,
  ThreadResponseWithThreadSummary,
} from '../repositories/threadResponseRepository';
import { getLogger } from '@server/utils';
import { isEmpty, isNil } from 'lodash';
import {
  IWrenEngineAdaptor,
  QueryResponse,
} from '../adaptors/wrenEngineAdaptor';
import { format } from 'sql-formatter';

const logger = getLogger('AskingService');
logger.level = 'debug';

export interface Task {
  id: string;
}

export interface AskingTaskInput {
  question: string;
  threadId?: number;
}

export interface AskingDetailTaskInput {
  question: string;
  sql: string;
  summary: string;
}

export interface IAskingService {
  /**
   * Asking task.
   */
  createAskingTask(input: AskingTaskInput): Promise<Task>;
  cancelAskingTask(taskId: string): Promise<void>;
  getAskingTask(taskId: string): Promise<AskResult>;

  /**
   * Asking detail task.
   */
  createThread(input: AskingDetailTaskInput): Promise<Thread>;
  updateThread(
    threadId: number,
    input: Partial<AskingDetailTaskInput>,
  ): Promise<Thread>;
  deleteThread(threadId: number): Promise<void>;
  listThreads(): Promise<Thread[]>;
  createThreadResponse(
    threadId: number,
    input: AskingDetailTaskInput,
  ): Promise<ThreadResponse>;
  getResponsesWithThread(
    threadId: number,
  ): Promise<ThreadResponseWithThreadSummary[]>;
  getResponse(responseId: number): Promise<ThreadResponse>;
  previewData(responseId: number, stepIndex?: number): Promise<QueryResponse>;
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
 * Background tracker to track the status of the asking detail task
 */
class BackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, ThreadResponse> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private runningJobs = new Set();

  constructor({
    wrenAIAdaptor,
    threadResponseRepository,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
  }) {
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

          // get the latest result from AI service
          const result = await this.wrenAIAdaptor.getAskDetailResult(
            threadResponse.queryId,
          );

          // check if status change
          if (threadResponse.status === result.status) {
            // mark the job as finished
            logger.debug(
              `Job ${threadResponse.id} status not changed, finished`,
            );
            this.runningJobs.delete(threadResponse.id);
            return;
          }

          // update database
          logger.debug(`Job ${threadResponse.id} status changed, updating`);
          await this.threadResponseRepository.updateOne(threadResponse.id, {
            status: result.status,
            detail: result.response,
            error: result.error,
          });

          // remove the task from tracker if it is finalized
          if (isFinalized(result.status)) {
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
  private wrenEngineAdaptor: IWrenEngineAdaptor;
  private deployService: IDeployService;
  private projectService: IProjectService;
  private threadRepository: IThreadRepository;
  private threadResponseRepository: IThreadResponseRepository;
  private backgroundTracker: BackgroundTracker;

  constructor({
    wrenAIAdaptor,
    wrenEngineAdaptor,
    deployService,
    projectService,
    threadRepository,
    threadResponseRepository,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    wrenEngineAdaptor: IWrenEngineAdaptor;
    deployService: IDeployService;
    projectService: IProjectService;
    threadRepository: IThreadRepository;
    threadResponseRepository: IThreadResponseRepository;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.wrenEngineAdaptor = wrenEngineAdaptor;
    this.deployService = deployService;
    this.projectService = projectService;
    this.threadRepository = threadRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.backgroundTracker = new BackgroundTracker({
      wrenAIAdaptor,
      threadResponseRepository,
    });
  }

  public async initialize() {
    // list thread responses from database
    // filter status not finalized and put them into background tracker
    const threadResponses = await this.threadResponseRepository.findAll();
    const unfininshedThreadResponses = threadResponses.filter(
      (threadResponse) =>
        !isFinalized(threadResponse.status as AskResultStatus),
    );
    logger.info(
      `Initialization: adding unfininshed thread responses (total: ${unfininshedThreadResponses.length}) to background tracker`,
    );
    for (const threadResponse of unfininshedThreadResponses) {
      this.backgroundTracker.addTask(threadResponse);
    }
  }

  /**
   * Asking task.
   */
  public async createAskingTask(input: AskingTaskInput): Promise<Task> {
    const deployId = await this.getDeployId();

    // if it's a follow-up question, then the input will have a threadId
    // then use the threadId to get the sql, summary and get the steps of last thread response
    // construct it into AskHistory and pass to ask
    const history: AskHistory = input.threadId
      ? await this.getHistory(input.threadId)
      : null;
    const response = await this.wrenAIAdaptor.ask({
      query: input.question,
      history,
      deployId,
    });
    return {
      id: response.queryId,
    };
  }

  public async cancelAskingTask(taskId: string): Promise<void> {
    await this.wrenAIAdaptor.cancelAsk(taskId);
  }

  public async getAskingTask(taskId: string): Promise<AskResult> {
    return this.wrenAIAdaptor.getAskResult(taskId);
  }

  /**
   * Asking detail task.
   * 1. create a task on AI service to generate the detail
   * 2. create a thread and the first thread response
   * 3. put the task into background tracker
   */
  public async createThread(input: AskingDetailTaskInput): Promise<Thread> {
    // 1. create a task on AI service to generate the detail
    const response = await this.wrenAIAdaptor.generateAskDetail({
      query: input.question,
      sql: input.sql,
      summary: input.summary,
    });

    // 2. create a thread and the first thread response
    const project = await this.projectService.getCurrentProject();
    const thread = await this.threadRepository.createOne({
      projectId: project.id,
      sql: input.sql,
      summary: input.summary,
    });
    const threadResponse = await this.threadResponseRepository.createOne({
      threadId: thread.id,
      queryId: response.queryId,
      question: input.question,
      status: AskResultStatus.UNDERSTANDING,
    });

    // 3. put the task into background tracker
    this.backgroundTracker.addTask(threadResponse);

    // return the task id
    return thread;
  }

  public async listThreads(): Promise<Thread[]> {
    return this.threadRepository.findAll();
  }

  public async updateThread(
    threadId: number,
    input: Partial<AskingDetailTaskInput>,
  ): Promise<Thread> {
    // if input is empty, throw error
    if (isEmpty(input)) {
      throw new Error('Update thread input is empty');
    }

    return this.threadRepository.updateOne(threadId, {
      summary: input.summary,
    });
  }

  public async deleteThread(threadId: number): Promise<void> {
    await this.threadRepository.deleteOne(threadId);
  }

  public async createThreadResponse(
    threadId: number,
    input: AskingDetailTaskInput,
  ): Promise<ThreadResponse> {
    const thread = await this.threadRepository.findOneBy({
      id: threadId,
    });

    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    // 1. create a task on AI service to generate the detail
    const response = await this.wrenAIAdaptor.generateAskDetail({
      query: input.question,
      sql: input.sql,
      summary: input.summary,
    });

    // 2. create a thread and the first thread response
    const threadResponse = await this.threadResponseRepository.createOne({
      threadId: thread.id,
      queryId: response.queryId,
      question: input.question,
      status: AskResultStatus.UNDERSTANDING,
    });

    // 3. put the task into background tracker
    this.backgroundTracker.addTask(threadResponse);

    // return the task id
    return threadResponse;
  }

  public async getResponsesWithThread(threadId: number) {
    return this.threadResponseRepository.getResponsesWithThread(threadId);
  }

  public async getResponse(responseId: number) {
    return this.threadResponseRepository.findOneBy({ id: responseId });
  }

  /**
   * this function is used to preview the data of a thread response
   * get the target thread response and get the steps
   * construct the CTEs and get the data
   * @param responseId
   * @param stepIndex
   * @returns Promise<QueryResponse>
   */
  public async previewData(
    responseId: number,
    stepIndex?: number,
  ): Promise<QueryResponse> {
    const response = await this.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    const steps = response.detail.steps;
    const sql = format(constructCteSql(steps, stepIndex));
    return this.wrenEngineAdaptor.previewData(sql);
  }

  private async getDeployId() {
    const project = await this.projectService.getCurrentProject();
    const lastDeploy = await this.deployService.getLastDeployment(project.id);
    return lastDeploy;
  }

  /**
   * Get the thread with threadId & latest thread response of a thread
   * transform the response into AskHistory
   * @param threadId
   * @returns Promise<AskHistory>
   */
  private async getHistory(threadId: number): Promise<AskHistory> {
    const responses =
      await this.threadResponseRepository.getResponsesWithThread(threadId, 1);
    if (!responses.length) {
      return null;
    }

    const latestResponse = responses[0];
    return {
      sql: latestResponse.sql,
      summary: latestResponse.summary,
      steps: latestResponse.detail.steps,
    };
  }
}
