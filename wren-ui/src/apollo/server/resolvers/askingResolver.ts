import { WrenAIError, AskResultStatus } from '../adaptors/wrenAIAdaptor';
import { Thread } from '../repositories/threadRepository';
import {
  DetailStep,
  ThreadResponse,
} from '../repositories/threadResponseRepository';
import { reduce } from 'lodash';
import { IContext } from '../types';
import { getLogger } from '@server/utils';
import { format } from 'sql-formatter';
import { constructCteSql } from '../services/askingService';
import {
  SuggestedQuestion,
  SampleDatasetName,
  getSampleAskQuestions,
} from '../data';
import { Order } from '../repositories';

const logger = getLogger('AskingResolver');
logger.level = 'debug';

export interface SuggestedQuestionResponse {
  questions: SuggestedQuestion[];
}

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
    this.updateThread = this.updateThread.bind(this);
    this.deleteThread = this.deleteThread.bind(this);
    this.listThreads = this.listThreads.bind(this);
    this.createThreadResponse = this.createThreadResponse.bind(this);
    this.createCorrectedThreadResponse =
      this.createCorrectedThreadResponse.bind(this);
    this.getResponse = this.getResponse.bind(this);
    this.getSuggestedQuestions = this.getSuggestedQuestions.bind(this);
    this.createThreadResponseExplain =
      this.createThreadResponseExplain.bind(this);
  }

  public async getSuggestedQuestions(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<SuggestedQuestionResponse> {
    const project = await ctx.projectService.getCurrentProject();
    const { sampleDataset } = project;
    if (!sampleDataset) {
      return { questions: [] };
    }
    const questions = getSampleAskQuestions(sampleDataset as SampleDatasetName);
    return { questions };
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
    const candidates = await Promise.all(
      (askResult.response || []).map(async (response) => {
        const view = response.viewId
          ? await ctx.viewRepository.findOneBy({ id: response.viewId })
          : null;
        return {
          type: response.type,
          sql: response.sql,
          summary: response.summary,
          view,
        };
      }),
    );

    return {
      status: askResult.status,
      error: askResult.error,
      candidates,
    };
  }

  public async createThread(
    _root: any,
    args: {
      data: {
        question?: string;
        sql?: string;
        summary?: string;
        viewId?: number;
      };
    },
    ctx: IContext,
  ): Promise<Thread> {
    const { question, sql, summary, viewId } = args.data;

    const askingService = ctx.askingService;
    const thread = await askingService.createThread({
      question,
      sql,
      summary,
      viewId,
    });
    // telemetry
    ctx.telemetry.send_event('ask_question', {});
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
    const explains = await askingService.getExplainDetailsByThread(threadId);
    // reduce responses to group by thread id
    const thread = reduce(
      responses,
      (acc, response) => {
        if (!acc.id) {
          acc.id = response.threadId;
          acc.sql = response.sql;
          acc.summary = response.threadSummary;
          acc.responses = [];
        }
        const explain = explains.find(
          (e) => e.threadResponseId === response.id,
        );
        acc.responses.push({
          id: response.id,
          question: response.question,

          // we added summary in version 0.3.0.
          // if summary is not available, we use description and question instead.
          summary:
            response.summary ||
            response.detail?.description ||
            response.question,
          status: response.status,
          detail: response.detail,
          error: response.error,
          corrections: response.corrections,
          explain: {
            queryId: explain?.queryId || null,
            status: explain?.status || null,
            error: explain?.error || null,
          },
        });

        return acc;
      },
      {} as any,
    );

    return thread;
  }

  public async updateThread(
    _root: any,
    args: { where: { id: number }; data: { summary: string } },
    ctx: IContext,
  ): Promise<Thread> {
    const { where, data } = args;

    const askingService = ctx.askingService;
    const thread = await askingService.updateThread(where.id, data);

    // telemetry
    ctx.telemetry.send_event('update_thread_summary', {
      new_summary: data.summary,
    });
    return thread;
  }

  public async deleteThread(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ): Promise<boolean> {
    const { where } = args;

    const askingService = ctx.askingService;
    await askingService.deleteThread(where.id);
    return true;
  }

  public async listThreads(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Thread[]> {
    const threads = await ctx.askingService.listThreads();
    return threads;
  }

  public async createThreadResponse(
    _root: any,
    args: {
      threadId: number;
      data: {
        question?: string;
        sql?: string;
        summary?: string;
        viewId?: number;
      };
    },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { threadId, data } = args;

    const askingService = ctx.askingService;
    const response = await askingService.createThreadResponse(threadId, data);
    ctx.telemetry.send_event('ask_followup_question', {});
    return response;
  }

  public async createCorrectedThreadResponse(
    _root: any,
    args: {
      threadId: number;
      data: {
        responseId: number;
        corrections: {
          id: number;
          type: string;
          referenceNum: number;
          stepIndex: number;
          reference: string;
          correction: string;
        }[];
      };
    },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { threadId, data } = args;

    const askingService = ctx.askingService;
    const response = await askingService.createCorrectedThreadResponse(
      threadId,
      data,
    );
    ctx.telemetry.send_event('regenerate_asked_question', {});
    return response;
  }

  public async getResponse(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<
    ThreadResponse & {
      explain: {
        queryId: string | null;
        status: string | null;
        error: object | null;
      };
    }
  > {
    const { responseId } = args;
    const askingService = ctx.askingService;
    const response = await askingService.getResponse(responseId);
    const explain = await ctx.threadResponseExplainRepository.findAllBy(
      {
        threadResponseId: responseId,
      },
      { orderBy: [{ column: 'created_at', order: Order.DESC }], limit: 1 },
    );
    const hasExplain = !!explain.length;

    // we added summary in version 0.3.0.
    // if summary is not available, we use description and question instead.
    return {
      ...response,
      summary:
        response.summary || response.detail?.description || response.question,
      explain: {
        queryId: hasExplain ? explain[0].queryId : null,
        status: hasExplain ? explain[0].status : null,
        error: hasExplain ? explain[0].error : null,
      },
    };
  }

  public async previewData(
    _root: any,
    args: { where: { responseId: number; stepIndex?: number; limit?: number } },
    ctx: IContext,
  ): Promise<any> {
    const { responseId, stepIndex, limit } = args.where;
    const askingService = ctx.askingService;
    const data = await askingService.previewData(responseId, stepIndex, limit);
    return data;
  }

  public async createThreadResponseExplain(
    _root: any,
    args: { where: { responseId: number } },
    ctx: IContext,
  ) {
    return await ctx.askingService.createThreadResponseExplain(
      args.where.responseId,
    );
  }

  /**
   * Nested resolvers
   */
  public getThreadResponseNestedResolver = () => ({
    detail: async (parent: ThreadResponse, _args: any, ctx: IContext) => {
      if (!parent.detail) {
        return null;
      }
      // extend view & sql to detail

      // handle sql
      const sql = format(constructCteSql(parent.detail.steps));

      // handle view
      let view = null;
      const viewId = parent?.detail?.viewId;
      if (viewId) {
        view = await ctx.viewRepository.findOneBy({ id: viewId });
        const displayName = view.properties
          ? JSON.parse(view.properties)?.displayName
          : view.name;
        view = { ...view, displayName };
      }
      return { ...parent.detail, sql, view };
    },
  });

  public getDetailStepNestedResolver = () => ({
    sql: (parent: DetailStep, _args: any, _ctx: IContext) => {
      return format(parent.sql);
    },
  });

  public getResultCandidateNestedResolver = () => ({
    sql: (parent: any, _args: any, _ctx: IContext) => {
      return format(parent.sql);
    },
    view: async (parent: any, _args: any, ctx: IContext) => {
      const viewId = parent.view?.id;
      if (!viewId) return parent.view;
      const view = await ctx.viewRepository.findOneBy({ id: viewId });

      const displayName = view.properties
        ? JSON.parse(view.properties).displayName
        : view.name;
      return {
        ...parent.view,
        displayName,
      };
    },
  });
}
