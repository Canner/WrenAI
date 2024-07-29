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
import { TelemetryEvent, WrenService } from '../telemetry/telemetry';

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
    this.getResponse = this.getResponse.bind(this);
    this.getSuggestedQuestions = this.getSuggestedQuestions.bind(this);
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

    // telemetry
    const eventName = TelemetryEvent.HOME_ASK_CANDIDATE;
    if (askResult.status === AskResultStatus.FINISHED) {
      ctx.telemetry.sendEvent(eventName, {
        status: askResult.status,
        candidates: askResult.response,
      });
    }
    if (askResult.status === AskResultStatus.FAILED) {
      ctx.telemetry.sendEvent(
        eventName,
        {
          status: askResult.status,
          error: askResult.error,
        },
        WrenService.AI,
        false,
      );
    }

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
    const eventName = TelemetryEvent.HOME_CREATE_THREAD;
    try {
      const thread = await askingService.createThread({
        question,
        sql,
        summary,
        viewId,
      });
      ctx.telemetry.sendEvent(eventName, {});
      return thread;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error: err.message },
        err.extensions?.service,
        false,
      );
    }
    // telemetry
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
          acc.summary = response.threadSummary;
          acc.responses = [];
        }

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
    const eventName = TelemetryEvent.HOME_UPDATE_THREAD_SUMMARY;
    const newSummary = data.summary;
    try {
      const thread = await askingService.updateThread(where.id, data);
      // telemetry
      ctx.telemetry.sendEvent(eventName, {
        new_summary: newSummary,
      });
      return thread;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        {
          new_summary: newSummary,
        },
        err.extensions?.service,
        false,
      );
      throw err;
    }
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
    const eventName = TelemetryEvent.HOME_ASK_FOLLOWUP_QUESTION;
    try {
      const response = await askingService.createThreadResponse(threadId, data);
      ctx.telemetry.sendEvent(eventName, { data });
      return response;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { data, error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
    }
  }

  public async getResponse(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    const response = await askingService.getResponse(responseId);

    // we added summary in version 0.3.0.
    // if summary is not available, we use description and question instead.
    return {
      ...response,
      summary:
        response.summary || response.detail?.description || response.question,
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
