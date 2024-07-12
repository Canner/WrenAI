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
  ThreadResponseWithThreadContext,
} from '../repositories/threadResponseRepository';
import { getLogger } from '@server/utils';
import { isEmpty, isNil } from 'lodash';
import { format } from 'sql-formatter';
import { Telemetry } from '../telemetry/telemetry';
import { IViewRepository, View } from '../repositories';
import { IQueryService, PreviewDataResponse } from './queryService';
import { ThreadResponseBackgroundTracker } from '../backgroundTrackers/threadResponseBackgroundTracker';

const logger = getLogger('AskingService');
logger.level = 'debug';

const QUERY_ID_PLACEHOLDER = '0';

export interface Task {
  id: string;
}

export interface AskingTaskInput {
  question: string;
  threadId?: number;
}

export interface AskingDetailTaskInput {
  question?: string;
  sql?: string;
  summary?: string;
  viewId?: number;
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
  ): Promise<ThreadResponseWithThreadContext[]>;
  getResponse(responseId: number): Promise<ThreadResponse>;
  previewData(
    responseId: number,
    stepIndex?: number,
    limit?: number,
  ): Promise<PreviewDataResponse>;
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

export class AskingService implements IAskingService {
  private wrenAIAdaptor: IWrenAIAdaptor;
  private deployService: IDeployService;
  private projectService: IProjectService;
  private viewRepository: IViewRepository;
  private threadRepository: IThreadRepository;
  private threadResponseRepository: IThreadResponseRepository;
  private backgroundTracker: ThreadResponseBackgroundTracker;
  private queryService: IQueryService;
  private telemetry: Telemetry;

  constructor({
    telemetry,
    wrenAIAdaptor,
    deployService,
    projectService,
    viewRepository,
    threadRepository,
    threadResponseRepository,
    queryService,
  }: {
    telemetry: Telemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    deployService: IDeployService;
    projectService: IProjectService;
    viewRepository: IViewRepository;
    threadRepository: IThreadRepository;
    threadResponseRepository: IThreadResponseRepository;
    queryService: IQueryService;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.deployService = deployService;
    this.projectService = projectService;
    this.viewRepository = viewRepository;
    this.threadRepository = threadRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.telemetry = telemetry;
    this.queryService = queryService;
    this.backgroundTracker = new ThreadResponseBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      threadResponseRepository,
    });
  }

  public async initialize() {
    // list thread responses from database
    // filter status not finalized and put them into background tracker
    const threadResponses = await this.threadResponseRepository.findAll();
    const unfinishedThreadResponses = threadResponses.filter(
      (threadResponse) =>
        !isFinalized(threadResponse.status as AskResultStatus),
    );
    logger.info(
      `Initialization: adding unfinished thread responses (total: ${unfinishedThreadResponses.length}) to background tracker`,
    );
    for (const threadResponse of unfinishedThreadResponses) {
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
    this.telemetry.send_event('question_cancelled', {});
    await this.wrenAIAdaptor.cancelAsk(taskId);
  }

  public async getAskingTask(taskId: string): Promise<AskResult> {
    return this.wrenAIAdaptor.getAskResult(taskId);
  }

  /**
   * Asking detail task.
   * The process of creating a thread is as follows:
   * If input contains a viewId, simply create a thread from saved properties of the view.
   * Otherwise, create a task on AI service to generate the detail.
   * 1. create a task on AI service to generate the detail
   * 2. create a thread and the first thread response
   * 3. put the task into background tracker
   */
  public async createThread(input: AskingDetailTaskInput): Promise<Thread> {
    // if input contains a viewId, simply create a thread from saved properties of the view
    if (input.viewId) {
      return this.createThreadFromView(input.viewId);
    }

    // 1. create a task on AI service to generate the detail
    const response = await this.wrenAIAdaptor.generateAskDetail({
      query: input.question,
      sql: input.sql,
      summary: input.summary,
    });

    // 2. create a thread and the first thread response
    const { id } = await this.projectService.getCurrentProject();
    const thread = await this.threadRepository.createOne({
      projectId: id,
      sql: input.sql,
      summary: input.summary,
    });

    // in follow-up questions, we still need to save the summary
    const threadResponse = await this.threadResponseRepository.createOne({
      threadId: thread.id,
      queryId: response.queryId,
      question: input.question,
      summary: input.summary,
      status: AskResultStatus.UNDERSTANDING,
    });

    // 3. put the task into background tracker
    this.backgroundTracker.addTask(threadResponse);

    // return the task id
    return thread;
  }

  public async listThreads(): Promise<Thread[]> {
    const { id } = await this.projectService.getCurrentProject();
    return await this.threadRepository.listAllTimeDescOrder(id);
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

    // if input contains a viewId, simply create a thread from saved properties of the view
    if (input.viewId) {
      const view = await this.viewRepository.findOneBy({ id: input.viewId });

      if (!view) {
        throw new Error(`View ${input.viewId} not found`);
      }

      const res = await this.createThreadResponseFromView(view, thread);
      return res;
    }

    // 1. create a task on AI service to generate the detail
    const response = await this.wrenAIAdaptor.generateAskDetail({
      query: input.question,
      sql: input.sql,
      summary: input.summary,
    });

    // 2. create a thread and the first thread response
    // in follow-up questions, we still need to save the summary
    const threadResponse = await this.threadResponseRepository.createOne({
      threadId: thread.id,
      queryId: response.queryId,
      question: input.question,
      summary: input.summary,
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
    limit?: number,
  ): Promise<PreviewDataResponse> {
    const response = await this.getResponse(responseId);
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }
    const project = await this.projectService.getCurrentProject();
    const deployment = await this.deployService.getLastDeployment(project.id);
    const mdl = deployment.manifest;
    const steps = response.detail.steps;
    const sql = format(constructCteSql(steps, stepIndex));
    const data = (await this.queryService.preview(sql, {
      project,
      manifest: mdl,
      limit,
    })) as PreviewDataResponse;

    this.telemetry.send_event('preview_data', { sql });
    return data;
  }

  public async deleteAllByProjectId(projectId: number): Promise<void> {
    // delete all threads
    await this.threadRepository.deleteAllBy({ projectId });
  }

  private async getDeployId() {
    const { id } = await this.projectService.getCurrentProject();
    const lastDeploy = await this.deployService.getLastDeployment(id);
    return lastDeploy.hash;
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

  private async createThreadFromView(viewId: number) {
    const view = await this.viewRepository.findOneBy({ id: viewId });
    if (!view) {
      throw new Error(`View ${viewId} not found`);
    }

    const properties = JSON.parse(view.properties) || {};
    const { id } = await this.projectService.getCurrentProject();
    const thread = await this.threadRepository.createOne({
      projectId: id,
      sql: view.statement,
      summary: properties.summary,
    });

    await this.createThreadResponseFromView(view, thread);
    return thread;
  }

  private async createThreadResponseFromView(view: View, thread: Thread) {
    const properties = JSON.parse(view.properties) || {};
    return this.threadResponseRepository.createOne({
      threadId: thread.id,
      queryId: QUERY_ID_PLACEHOLDER,
      question: properties.question,
      summary: properties.summary,
      status: AskResultStatus.FINISHED,
      detail: {
        ...properties.detail,
        viewId: view.id,
      },
    });
  }
}
