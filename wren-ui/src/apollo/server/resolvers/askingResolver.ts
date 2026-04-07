import {
  WrenAIError,
  AskResultStatus,
  AskResultType,
  SkillExecutionResult,
  RecommendationQuestionStatus,
  ChartAdjustmentOption,
  AskFeedbackStatus,
} from '@server/models/adaptor';
import { Thread } from '../repositories/threadRepository';
import {
  DetailStep,
  ThreadResponse,
} from '../repositories/threadResponseRepository';
import { reduce } from 'lodash';
import { IContext } from '../types';
import { getLogger } from '@server/utils';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import {
  AskingDetailTaskInput,
  constructCteSql,
  ThreadRecommendQuestionResult,
} from '../services/askingService';
import {
  SuggestedQuestion,
  SampleDatasetName,
  getSampleAskQuestions,
} from '../data';
import { toPersistedRuntimeIdentity } from '../context/runtimeScope';
import { TelemetryEvent, WrenService } from '../telemetry/telemetry';
import { TrackedAskingResult } from '../services';
import {
  resolveProjectLanguage,
  resolveRuntimeProject as resolveScopedRuntimeProject,
} from '../utils/runtimeExecutionContext';

const logger = getLogger('AskingResolver');
logger.level = 'debug';

export interface SuggestedQuestionResponse {
  questions: SuggestedQuestion[];
}

export interface Task {
  id: string;
}

export interface AdjustmentTask {
  queryId: string;
  status: AskFeedbackStatus;
  error: WrenAIError | null;
  sql: string;
  traceId: string;
  invalidSql?: string;
}

export interface AskingTask {
  type: AskResultType | null;
  status: AskResultStatus;
  candidates: Array<{
    sql: string;
  }>;
  skillResult?: SkillExecutionResult | null;
  error: WrenAIError | null;
  rephrasedQuestion?: string;
  intentReasoning?: string;
  sqlGenerationReasoning?: string;
  retrievedTables?: string[];
  invalidSql?: string;
  traceId?: string;
  queryId?: string;
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
    this.rerunAskingTask = this.rerunAskingTask.bind(this);
    this.getAskingTask = this.getAskingTask.bind(this);
    this.createThread = this.createThread.bind(this);
    this.getThread = this.getThread.bind(this);
    this.updateThread = this.updateThread.bind(this);
    this.deleteThread = this.deleteThread.bind(this);
    this.listThreads = this.listThreads.bind(this);
    this.createThreadResponse = this.createThreadResponse.bind(this);
    this.updateThreadResponse = this.updateThreadResponse.bind(this);
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
    this.transformAskingTask = this.transformAskingTask.bind(this);

    this.adjustThreadResponse = this.adjustThreadResponse.bind(this);
    this.cancelAdjustThreadResponseAnswer =
      this.cancelAdjustThreadResponseAnswer.bind(this);
    this.rerunAdjustThreadResponseAnswer =
      this.rerunAdjustThreadResponseAnswer.bind(this);
    this.getAdjustmentTask = this.getAdjustmentTask.bind(this);
  }

  public async generateProjectRecommendationQuestions(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<boolean> {
    const project = await this.getActiveRuntimeProject(ctx);
    await ctx.projectService.generateProjectRecommendationQuestions(
      project.id,
      this.getCurrentRuntimeScopeId(ctx),
    );
    return true;
  }

  public async generateThreadRecommendationQuestions(
    _root: any,
    args: { threadId: number },
    ctx: IContext,
  ): Promise<boolean> {
    const { threadId } = args;
    const askingService = ctx.askingService;
    await this.ensureThreadScope(ctx, threadId);
    await askingService.generateThreadRecommendationQuestions(
      threadId,
      this.getCurrentRuntimeScopeId(ctx),
    );
    return true;
  }

  public async getThreadRecommendationQuestions(
    _root: any,
    args: { threadId: number },
    ctx: IContext,
  ): Promise<ThreadRecommendQuestionResult> {
    const { threadId } = args;
    const askingService = ctx.askingService;
    await this.ensureThreadScope(ctx, threadId);
    return askingService.getThreadRecommendationQuestions(threadId);
  }

  public async getSuggestedQuestions(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<SuggestedQuestionResponse> {
    const project = await this.getActiveRuntimeProject(ctx);
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
    if (threadId) {
      await this.ensureThreadScope(ctx, threadId);
    }

    const askingService = ctx.askingService;
    const data = { question };
    const task = await askingService.createAskingTask(data, {
      runtimeScopeId: this.getCurrentRuntimeScopeId(ctx),
      runtimeIdentity: this.getCurrentPersistedRuntimeIdentity(ctx),
      threadId,
      actorClaims: ctx.runtimeScope?.actorClaims || null,
      language: await this.getCurrentLanguage(ctx),
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
    await this.ensureAskingTaskScope(ctx, taskId);
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
    await this.ensureAskingTaskScope(ctx, taskId);
    const askResult = await askingService.getAskingTask(taskId);

    if (!askResult) {
      return null;
    }

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

    return this.transformAskingTask(askResult, ctx);
  }

  public async createThread(
    _root: any,
    args: {
      data: {
        question?: string;
        taskId?: string;
        // if we use recommendation questions, sql will be provided
        sql?: string;
      };
    },
    ctx: IContext,
  ): Promise<Thread> {
    const { data } = args;

    const askingService = ctx.askingService;

    // if taskId is provided, use the result from the asking task
    // otherwise, use the input data
    let threadInput: AskingDetailTaskInput;
    if (data.taskId) {
      await this.ensureAskingTaskScope(ctx, data.taskId);
      const askingTask = await askingService.getAskingTask(data.taskId);
      if (!askingTask) {
        throw new Error(`Asking task ${data.taskId} not found`);
      }

      threadInput = {
        question: askingTask.question,
        trackedAskingResult: askingTask,
      };
    } else {
      // when we use recommendation questions, there's no task to track
      threadInput = data;
    }

    const eventName = TelemetryEvent.HOME_CREATE_THREAD;
    try {
      const thread = await askingService.createThread(
        threadInput,
        this.getCurrentPersistedRuntimeIdentity(ctx),
      );
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
    await this.ensureThreadScope(ctx, threadId);
    const askingService = ctx.askingService;
    const responses = await askingService.getResponsesWithThreadScoped(
      threadId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
    );
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
          askingTaskId: response.askingTaskId,
          breakdownDetail: response.breakdownDetail,
          answerDetail: response.answerDetail,
          chartDetail: response.chartDetail,
          adjustment: response.adjustment,
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
    await this.ensureThreadScope(ctx, where.id);
    const askingService = ctx.askingService;
    const eventName = TelemetryEvent.HOME_UPDATE_THREAD_SUMMARY;
    const newSummary = data.summary;
    try {
      const thread = await askingService.updateThreadScoped(
        where.id,
        this.getCurrentPersistedRuntimeIdentity(ctx),
        data,
      );
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
    await this.ensureThreadScope(ctx, where.id);
    const askingService = ctx.askingService;
    await askingService.deleteThreadScoped(
      where.id,
      this.getCurrentPersistedRuntimeIdentity(ctx),
    );
    return true;
  }

  public async listThreads(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Thread[]> {
    const threads = await ctx.askingService.listThreads(
      this.getCurrentPersistedRuntimeIdentity(ctx),
    );
    return threads;
  }

  public async createThreadResponse(
    _root: any,
    args: {
      threadId: number;
      data: {
        question?: string;
        taskId?: string;
        // if we use recommendation questions, sql will be provided
        sql?: string;
      };
    },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { threadId, data } = args;
    await this.ensureThreadScope(ctx, threadId);
    const askingService = ctx.askingService;
    const eventName = TelemetryEvent.HOME_ASK_FOLLOWUP_QUESTION;

    // if taskId is provided, use the result from the asking task
    // otherwise, use the input data
    let threadResponseInput: AskingDetailTaskInput;
    if (data.taskId) {
      await this.ensureAskingTaskScope(ctx, data.taskId);
      const askingTask = await askingService.getAskingTask(data.taskId);
      if (!askingTask) {
        throw new Error(`Asking task ${data.taskId} not found`);
      }

      threadResponseInput = {
        question: askingTask.question,
        trackedAskingResult: askingTask,
      };
    } else {
      // when we use recommendation questions, there's no task to track
      threadResponseInput = data;
    }

    try {
      const response = await askingService.createThreadResponseScoped(
        threadResponseInput,
        threadId,
        this.getCurrentPersistedRuntimeIdentity(ctx),
      );
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

  public async updateThreadResponse(
    _root: any,
    args: { where: { id: number }; data: { sql: string } },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { where, data } = args;
    const askingService = ctx.askingService;
    const response = await askingService.updateThreadResponseScoped(
      where.id,
      this.getCurrentPersistedRuntimeIdentity(ctx),
      data,
    );
    return response;
  }

  public async rerunAskingTask(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<Task> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    await this.ensureResponseScope(ctx, responseId);

    const task = await askingService.rerunAskingTask(responseId, {
      runtimeScopeId: this.getCurrentRuntimeScopeId(ctx),
      runtimeIdentity: this.getCurrentPersistedRuntimeIdentity(ctx),
      language: await this.getCurrentLanguage(ctx),
    });
    ctx.telemetry.sendEvent(TelemetryEvent.HOME_RERUN_ASKING_TASK, {
      responseId,
    });
    return task;
  }

  public async adjustThreadResponse(
    _root: any,
    args: {
      responseId: number;
      data: {
        tables?: string[];
        sqlGenerationReasoning?: string;
        sql?: string;
      };
    },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { responseId, data } = args;
    const askingService = ctx.askingService;
    await this.ensureResponseScope(ctx, responseId);

    if (data.sql) {
      const response = await askingService.adjustThreadResponseWithSQLScoped(
        responseId,
        this.getCurrentPersistedRuntimeIdentity(ctx),
        {
          sql: data.sql,
        },
      );
      ctx.telemetry.sendEvent(
        TelemetryEvent.HOME_ADJUST_THREAD_RESPONSE_WITH_SQL,
        {
          sql: data.sql,
          responseId,
        },
      );
      return response;
    }

    return askingService.adjustThreadResponseAnswerScoped(
      responseId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
      {
        runtimeIdentity: this.getCurrentPersistedRuntimeIdentity(ctx),
        tables: data.tables,
        sqlGenerationReasoning: data.sqlGenerationReasoning,
      },
      {
        language: await this.getCurrentLanguage(ctx),
      },
    );
  }

  public async cancelAdjustThreadResponseAnswer(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<boolean> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    await this.ensureAskingTaskScope(ctx, taskId);
    await askingService.cancelAdjustThreadResponseAnswer(taskId);
    return true;
  }

  public async rerunAdjustThreadResponseAnswer(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<boolean> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    await this.ensureResponseScope(ctx, responseId);
    await askingService.rerunAdjustThreadResponseAnswer(
      responseId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
      {
        language: await this.getCurrentLanguage(ctx),
      },
    );
    return true;
  }

  public async getAdjustmentTask(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<AdjustmentTask> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    await this.ensureAskingTaskScope(ctx, taskId);
    const adjustmentTask = await askingService.getAdjustmentTask(taskId);
    return {
      queryId: adjustmentTask?.queryId,
      status: adjustmentTask?.status,
      error: adjustmentTask?.error,
      sql: adjustmentTask?.response?.[0]?.sql,
      traceId: adjustmentTask?.traceId,
      invalidSql: adjustmentTask?.invalidSql
        ? safeFormatSQL(adjustmentTask.invalidSql)
        : null,
    };
  }

  public async generateThreadResponseBreakdown(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    await this.ensureResponseScope(ctx, responseId);
    const breakdownDetail =
      await askingService.generateThreadResponseBreakdownScoped(
        responseId,
        this.getCurrentPersistedRuntimeIdentity(ctx),
        { language: await this.getCurrentLanguage(ctx) },
      );
    return breakdownDetail;
  }

  public async generateThreadResponseAnswer(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    await this.ensureResponseScope(ctx, responseId);
    return askingService.generateThreadResponseAnswerScoped(
      responseId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
      {
        language: await this.getCurrentLanguage(ctx),
      },
    );
  }

  public async generateThreadResponseChart(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    await this.ensureResponseScope(ctx, responseId);
    return askingService.generateThreadResponseChartScoped(
      responseId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
      {
        language: await this.getCurrentLanguage(ctx),
      },
    );
  }

  public async adjustThreadResponseChart(
    _root: any,
    args: { responseId: number; data: ChartAdjustmentOption },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { responseId, data } = args;
    const askingService = ctx.askingService;
    await this.ensureResponseScope(ctx, responseId);
    return askingService.adjustThreadResponseChartScoped(
      responseId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
      data,
      {
        language: await this.getCurrentLanguage(ctx),
      },
    );
  }

  public async getResponse(
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> {
    const { responseId } = args;
    const askingService = ctx.askingService;
    await this.ensureResponseScope(ctx, responseId);
    const response = await askingService.getResponseScoped(
      responseId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
    );

    return response;
  }

  public async previewData(
    _root: any,
    args: { where: { responseId: number; stepIndex?: number; limit?: number } },
    ctx: IContext,
  ): Promise<any> {
    const { responseId, limit } = args.where;
    const askingService = ctx.askingService;
    await this.ensureResponseScope(ctx, responseId);
    const data = await askingService.previewDataScoped(
      responseId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
      limit,
    );
    return data;
  }

  public async previewBreakdownData(
    _root: any,
    args: { where: { responseId: number; stepIndex?: number; limit?: number } },
    ctx: IContext,
  ): Promise<any> {
    const { responseId, stepIndex, limit } = args.where;
    const askingService = ctx.askingService;
    await this.ensureResponseScope(ctx, responseId);
    const data = await askingService.previewBreakdownDataScoped(
      responseId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
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
    return askingService.createInstantRecommendedQuestions(
      data,
      this.getCurrentPersistedRuntimeIdentity(ctx),
      this.getCurrentRuntimeScopeId(ctx),
    );
  }

  public async getInstantRecommendedQuestions(
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<RecommendedQuestionsTask> {
    const { taskId } = args;
    const askingService = ctx.askingService;
    const result = await askingService.getInstantRecommendedQuestions(
      taskId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
    );
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
      const view = await this.findScopedView(ctx, viewId);
      if (!view) return null;
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
        return safeFormatSQL(constructCteSql(parent.breakdownDetail.steps));
      }
      return parent.sql ? safeFormatSQL(parent.sql) : null;
    },
    askingTask: async (parent: ThreadResponse, _args: any, ctx: IContext) => {
      if (parent.adjustment) {
        return null;
      }
      if (!parent.askingTaskId) {
        return null;
      }
      const askingService = ctx.askingService;
      await askingService.assertAskingTaskScopeById(
        parent.askingTaskId,
        this.getCurrentPersistedRuntimeIdentity(ctx),
      );
      const askingTask = await askingService.getAskingTaskById(
        parent.askingTaskId,
      );
      if (!askingTask) return null;
      return this.transformAskingTask(askingTask, ctx);
    },
    adjustmentTask: async (
      parent: ThreadResponse,
      _args: any,
      ctx: IContext,
    ): Promise<AdjustmentTask> => {
      if (!parent.adjustment) {
        return null;
      }
      if (!parent.askingTaskId) {
        return null;
      }
      const askingService = ctx.askingService;
      await askingService.assertAskingTaskScopeById(
        parent.askingTaskId,
        this.getCurrentPersistedRuntimeIdentity(ctx),
      );
      const adjustmentTask = await askingService.getAdjustmentTaskById(
        parent.askingTaskId,
      );
      if (!adjustmentTask) return null;
      return {
        queryId: adjustmentTask?.queryId,
        status: adjustmentTask?.status,
        error: adjustmentTask?.error,
        sql: adjustmentTask?.response?.[0]?.sql,
        traceId: adjustmentTask?.traceId,
        invalidSql: adjustmentTask?.invalidSql
          ? safeFormatSQL(adjustmentTask.invalidSql)
          : null,
      };
    },
  });

  public getDetailStepNestedResolver = () => ({
    sql: (parent: DetailStep, _args: any, _ctx: IContext) => {
      return safeFormatSQL(parent.sql);
    },
  });

  public getResultCandidateNestedResolver = () => ({
    sql: (parent: any, _args: any, _ctx: IContext) => {
      return safeFormatSQL(parent.sql);
    },
    view: async (parent: any, _args: any, ctx: IContext) => {
      const viewId = parent.view?.id;
      if (!viewId) return parent.view;
      const view = await this.findScopedView(ctx, viewId);
      if (!view) return null;

      const displayName = view.properties
        ? JSON.parse(view.properties).displayName
        : view.name;
      return {
        ...parent.view,
        displayName,
      };
    },
  });

  private getCurrentPersistedRuntimeIdentity(ctx: IContext) {
    return toPersistedRuntimeIdentity(ctx.runtimeScope!);
  }

  private getCurrentRuntimeScopeId(ctx: IContext) {
    return ctx.runtimeScope?.selector?.runtimeScopeId || null;
  }

  private async getActiveRuntimeProject(ctx: IContext) {
    const project = await resolveScopedRuntimeProject(
      ctx.runtimeScope!,
      ctx.projectService,
    );
    if (!project) {
      throw new Error('No project found for the active runtime scope');
    }

    return project;
  }

  private async getCurrentLanguage(ctx: IContext) {
    const project = await this.getActiveRuntimeProject(ctx);
    return resolveProjectLanguage(project);
  }

  private async ensureThreadScope(ctx: IContext, threadId: number) {
    await ctx.askingService.assertThreadScope(
      threadId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
    );
  }

  private async ensureResponseScope(ctx: IContext, responseId: number) {
    await ctx.askingService.assertResponseScope(
      responseId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
    );
  }

  private async ensureAskingTaskScope(ctx: IContext, taskId: string) {
    await ctx.askingService.assertAskingTaskScope(
      taskId,
      this.getCurrentPersistedRuntimeIdentity(ctx),
    );
  }

  private async transformAskingTask(
    askingTask: TrackedAskingResult,
    ctx: IContext,
  ): Promise<AskingTask> {
    // construct candidates from response
    const candidates = await Promise.all(
      (askingTask.response || []).map(async (response) => {
        const view = response.viewId
          ? await this.findScopedView(ctx, response.viewId)
          : null;
        const sqlPair = response.sqlpairId
          ? await this.findScopedSqlPair(ctx, response.sqlpairId)
          : null;
        return {
          type: response.type,
          sql: response.sql,
          view,
          sqlPair,
        };
      }),
    );

    // When the task got cancelled, the type is not set
    // we set it to TEXT_TO_SQL as default
    const type =
      askingTask?.status === AskResultStatus.STOPPED && !askingTask.type
        ? AskResultType.TEXT_TO_SQL
        : askingTask.type;
    return {
      type,
      status: askingTask.status,
      error: askingTask.error,
      candidates,
      skillResult: askingTask.skillResult || null,
      queryId: askingTask.queryId,
      rephrasedQuestion: askingTask.rephrasedQuestion,
      intentReasoning: askingTask.intentReasoning,
      sqlGenerationReasoning: askingTask.sqlGenerationReasoning,
      retrievedTables: askingTask.retrievedTables,
      invalidSql: askingTask.invalidSql
        ? safeFormatSQL(askingTask.invalidSql)
        : null,
      traceId: askingTask.traceId,
    };
  }

  private async findScopedView(ctx: IContext, viewId: number) {
    return await ctx.modelService.getViewByRuntimeIdentity(
      this.getCurrentPersistedRuntimeIdentity(ctx),
      viewId,
    );
  }

  private async findScopedSqlPair(ctx: IContext, sqlPairId: number) {
    return await ctx.sqlPairService.getSqlPair(
      toPersistedRuntimeIdentity(ctx.runtimeScope!),
      sqlPairId,
    );
  }
}
