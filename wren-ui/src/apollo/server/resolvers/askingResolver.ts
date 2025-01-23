import {
  WrenAIError,
  WrenAILanguage,
  AskResultStatus,
  AskResultType,
  RecommendationQuestionStatus,
  ChartAdjustmentOption,
} from '@server/models/adaptor';
import { Thread } from '../repositories/threadRepository';
import {
  DetailStep,
  ThreadResponse,
} from '../repositories/threadResponseRepository';
import { reduce } from 'lodash';
import { IContext } from '../types';
import { getLogger } from '@server/utils';
import { format } from 'sql-formatter';
import {
  constructCteSql,
  ThreadRecommendQuestionResult,
} from '../services/askingService';
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
  type: AskResultType | null;
  status: AskResultStatus;
  candidates: Array<{
    sql: string;
  }>;
  error: WrenAIError | null;
  intentReasoning?: string;
}

// DetailedThread is a type that represents a detailed thread, which is a thread with responses.
export interface DetailedThread {
  id: number; // ID
  sql: string; // SQL
  responses: ThreadResponse[];
}

export interface RecommendedQuestionsTask {
  questions: {
    question: string;
    category: string;
    sql: string;
  }[];
  status: RecommendationQuestionStatus;
  error: WrenAIError | null;
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
    this.previewData = this.previewData.bind(this);
    this.previewBreakdownData = this.previewBreakdownData.bind(this);
    this.getSuggestedQuestions = this.getSuggestedQuestions.bind(this);
    this.createInstantRecommendedQuestions =
      this.createInstantRecommendedQuestions.bind(this);
    this.getInstantRecommendedQuestions =
      this.getInstantRecommendedQuestions.bind(this);
    this.generateThreadRecommendationQuestions =
      this.generateThreadRecommendationQuestions.bind(this);
    this.generateProjectRecommendationQuestions =
      this.generateProjectRecommendationQuestions.bind(this);

    this.getThreadRecommendationQuestions =
      this.getThreadRecommendationQuestions.bind(this);
    this.generateThreadResponseBreakdown =
      this.generateThreadResponseBreakdown.bind(this);
    this.generateThreadResponseAnswer =
      this.generateThreadResponseAnswer.bind(this);
    this.generateThreadResponseChart =
      this.generateThreadResponseChart.bind(this);
    this.adjustThreadResponseChart = this.adjustThreadResponseChart.bind(this);
  }

  public async generateProjectRecommendationQuestions(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<boolean> {
    await ctx.projectService.generateProjectRecommendationQuestions();
    return true;
  }

  public async generateThreadRecommendationQuestions(
    _root: any,
    args: { threadId: number },
    ctx: IContext,
  ): Promise<boolean> {
    const { threadId } = args;
    const askingService = ctx.askingService;
    await askingService.generateThreadRecommendationQuestions(threadId);
    return true;
  }

  public async getThreadRecommendationQuestions(
    _root: any,
    args: { threadId: number },
    ctx: IContext,
  ): Promise<ThreadRecommendQuestionResult> {
    const { threadId } = args;
    const askingService = ctx.askingService;
    return askingService.getThreadRecommendationQuestions(threadId);
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
    const project = await ctx.projectService.getCurrentProject();

    const askingService = ctx.askingService;
    const data = { question };
    const task = await askingService.createAskingTask(data, {
      threadId,
      language: WrenAILanguage[project.language] || WrenAILanguage.EN,
    });
    ctx.telemetry.sendEvent(TelemetryEvent.HOME_ASK_CANDIDATE, {
      question,
      taskId: task.id,
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
        taskId,
        status: askResult.status,
        candidates: askResult.response,
      });
    }
    if (askResult.status === AskResultStatus.FAILED) {
      ctx.telemetry.sendEvent(
        eventName,
        {
          taskId,
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
          view,
        };
      }),
    );

    return {
      type: askResult.type,
      status: askResult.status,
      error: askResult.error,
      candidates,
      intentReasoning: askResult.intentReasoning,
    };
  }

  public async createThread(
    _root: any,
    args: {
      data: {
        question?: string;
        sql?: string;
        viewId?: number;
      };
    },
    ctx: IContext,
  ): Promise<Thread> {
    const { data } = args;

    const askingService = ctx.askingService;
    const eventName = TelemetryEvent.HOME_CREATE_THREAD;
    try {
      const thread = await askingService.createThread(data);
      ctx.telemetry.sendEvent(eventName, {});
      return thread;
    } catch (err: any) {
      ctx.telemetry.sendEvent(
        eventName,
        { error: err.message },
        err.extensions?.service,
        false,
      );
      throw err;
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
          acc.responses = [];
        }

        acc.responses.push({
          id: response.id,
          viewId: response.viewId,
          threadId: response.threadId,
          question: response.question,
          sql: response.sql,
          breakdownDetail: response.breakdownDetail,
          answerDetail: response.answerDetail,
          chartDetail: response.chartDetail,
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
        viewId?: number;
      };
    },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { threadId, data } = args;

    const askingService = ctx.askingService;
    const eventName = TelemetryEvent.HOME_ASK_FOLLOWUP_QUESTION;
    try {
      const response = await askingService.createThreadResponse(data, threadId);
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

  public async generateThreadResponseBreakdown(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const project = await ctx.projectService.getCurrentProject();
    const { responseId } = args;
    const askingService = ctx.askingService;
    const breakdownDetail = await askingService.generateThreadResponseBreakdown(
      responseId,
      { language: WrenAILanguage[project.language] || WrenAILanguage.EN },
    );
    return breakdownDetail;
  }

  public async generateThreadResponseAnswer(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const project = await ctx.projectService.getCurrentProject();
    const { responseId } = args;
    const askingService = ctx.askingService;
    return askingService.generateThreadResponseAnswer(responseId, {
      language: WrenAILanguage[project.language] || WrenAILanguage.EN,
    });
  }

  public async generateThreadResponseChart(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const project = await ctx.projectService.getCurrentProject();
    const { responseId } = args;
    const askingService = ctx.askingService;
    return askingService.generateThreadResponseChart(responseId, {
      language: WrenAILanguage[project.language] || WrenAILanguage.EN,
    });
  }

  public async adjustThreadResponseChart(
    _root: any,
    args: { responseId: number; data: ChartAdjustmentOption },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const project = await ctx.projectService.getCurrentProject();
    const { responseId, data } = args;
    const askingService = ctx.askingService;
    return askingService.adjustThreadResponseChart(responseId, data, {
      language: WrenAILanguage[project.language] || WrenAILanguage.EN,
    });
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

  public async previewData(
    _root: any,
    args: { where: { responseId: number; stepIndex?: number; limit?: number } },
    ctx: IContext,
  ): Promise<any> {
    const { responseId, limit } = args.where;
    const askingService = ctx.askingService;
    const data = await askingService.previewData(responseId, limit);
    return data;
  }

  public async previewBreakdownData(
    _root: any,
    args: { where: { responseId: number; stepIndex?: number; limit?: number } },
    ctx: IContext,
  ): Promise<any> {
    const { responseId, stepIndex, limit } = args.where;
    const askingService = ctx.askingService;
    const data = await askingService.previewBreakdownData(
      responseId,
      stepIndex,
      limit,
    );
    return data;
  }

  public async createInstantRecommendedQuestions(
    _root: any,
    args: { data: { previousQuestions?: string[] } },
    ctx: IContext,
  ): Promise<Task> {
    const { data } = args;
    const askingService = ctx.askingService;
    return askingService.createInstantRecommendedQuestions(data);
  }

  public async getInstantRecommendedQuestions(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<RecommendedQuestionsTask> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    const result = await askingService.getInstantRecommendedQuestions(taskId);
    return {
      questions: result.response?.questions || [],
      status: result.status,
      error: result.error,
    };
  }

  /**
   * Nested resolvers
   */
  public getThreadResponseNestedResolver = () => ({
    view: async (parent: ThreadResponse, _args: any, ctx: IContext) => {
      const viewId = parent.viewId;
      if (!viewId) return null;
      const view = await ctx.viewRepository.findOneBy({ id: viewId });
      const displayName = view.properties
        ? JSON.parse(view.properties)?.displayName
        : view.name;
      return { ...view, displayName };
    },
    answerDetail: (parent: ThreadResponse, _args: any, _ctx: IContext) => {
      if (!parent?.answerDetail) return null;

      const { content, ...rest } = parent.answerDetail;

      if (!content) return parent.answerDetail;

      const formattedContent = content
        // replace the \\n to \n
        .replace(/\\n/g, '\n')
        // replace the \\\" to \",
        .replace(/\\"/g, '"');

      return {
        ...rest,
        content: formattedContent,
      };
    },
    sql: (parent: ThreadResponse, _args: any, _ctx: IContext) => {
      if (parent.breakdownDetail && parent.breakdownDetail.steps) {
        // construct sql from breakdownDetail
        return format(constructCteSql(parent.breakdownDetail.steps));
      }
      return format(parent.sql);
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
