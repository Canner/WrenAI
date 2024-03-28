import { WrenAIError, AskResultStatus } from '../adaptors/wrenAIAdaptor';
import { Thread } from '../repositories/threadRepository';
import { ThreadResponse } from '../repositories/threadResponseRepository';
import { reduce } from 'lodash';
import { IContext } from '../types';
import { getLogger } from '@server/utils';

const logger = getLogger('AskingResolver');
logger.level = 'debug';

export interface Task {
  id: string;
}

export interface AskingTask {
  status: AskResultStatus;
  candidates: Array<{
    sql: string;
    summary: string;
  }>;
  error: WrenAIError | null;
}

// DetailedThread is a type that represents a detailed thread, which is a thread with responses.
export interface DetailedThread {
  id: number; // ID
  sql: string; // SQL
  summary: string; // Thread summary
  responses: ThreadResponse[];
}

export class AskingResolver {
  constructor() {
    this.createAskingTask = this.createAskingTask.bind(this);
    this.cancelAskingTask = this.cancelAskingTask.bind(this);
    this.getAskingTask = this.getAskingTask.bind(this);
    this.createThread = this.createThread.bind(this);
    this.getThread = this.getThread.bind(this);
    this.listThreads = this.listThreads.bind(this);
    this.getResponse = this.getResponse.bind(this);
  }

  public async createAskingTask(
    _root: any,
    args: { data: { question: string; threadId?: number } },
    ctx: IContext,
  ): Promise<Task> {
    const { question, threadId } = args.data;

    const askingService = ctx.askingService;
    const task = await askingService.createAskingTask({
      question,
      threadId,
    });
    return task;
  }

  public async cancelAskingTask(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<boolean> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    await askingService.cancelAskingTask(taskId);
    return true;
  }

  public async getAskingTask(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<AskingTask> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    const askResult = await askingService.getAskingTask(taskId);

    // construct candidates from response
    const candidates = (askResult.response || []).map((response) => {
      return {
        sql: response.sql,
        summary: response.summary,
      };
    });

    return {
      status: askResult.status,
      error: askResult.error,
      candidates,
    };
  }

  public async createThread(
    _root: any,
    args: { data: { question: string; sql: string; summary: string } },
    ctx: IContext,
  ): Promise<Thread> {
    const { question, sql, summary } = args.data;

    const askingService = ctx.askingService;
    const thread = await askingService.createThread({
      question,
      sql,
      summary,
    });
    return thread;
  }

  public async getThread(
    _root: any,
    args: { threadId: number },
    ctx: IContext,
  ): Promise<DetailedThread> {
    const { threadId } = args;

    const askingService = ctx.askingService;
    const responses = await askingService.getResponsesWithThread(threadId);

    // reduce responses to group by thread id
    const thread = reduce(
      responses,
      (acc, response) => {
        if (!acc.id) {
          acc.id = response.threadId;
          acc.sql = response.sql;
          acc.summary = response.summary;
          acc.responses = [];
        }

        acc.responses.push({
          id: response.id,
          question: response.question,
          status: response.status,
          detail: response.detail,
          error: response.error,
        });

        return acc;
      },
      {} as any,
    );

    return thread;
  }

  public async listThreads(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Thread[]> {
    const askingService = ctx.askingService;
    const threads = await askingService.listThreads();
    return threads;
  }

  public async createThreadResponse(
    _root: any,
    args: {
      threadId: number;
      data: { question: string; sql: string; summary: string };
    },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { threadId, data } = args;

    const askingService = ctx.askingService;
    const response = await askingService.createThreadResponse(threadId, data);
    return response;
  }

  public async getResponse(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    const response = await askingService.getResponse(responseId);
    return response;
  }
}
