import { IContext } from '../types';
import { Thread } from '../repositories/threadRepository';
import { ThreadResponse } from '../repositories/threadResponseRepository';
import { ChartAdjustmentOption } from '@server/models/adaptor';
import {
  createDetailStepNestedResolver,
  createResultCandidateNestedResolver,
  createThreadResponseNestedResolver,
} from './askingControllerNestedResolvers';
import {
  createAskingTaskAction,
  createInstantRecommendedQuestionsAction,
  getAdjustmentTaskAction,
  getAskingTaskAction,
  getInstantRecommendedQuestionsAction,
  getSuggestedQuestionsAction,
  rerunAskingTaskAction,
  cancelAskingTaskAction,
} from './askingControllerAskActions';
import {
  adjustThreadResponseAction,
  adjustThreadResponseChartAction,
  cancelAdjustThreadResponseAnswerAction,
  createThreadAction,
  createThreadResponseAction,
  deleteThreadAction,
  generateThreadResponseAnswerAction,
  generateThreadResponseBreakdownAction,
  generateThreadResponseChartAction,
  getResponseAction,
  getThreadAction,
  listThreadsAction,
  previewBreakdownDataAction,
  previewDataAction,
  rerunAdjustThreadResponseAnswerAction,
  updateThreadAction,
  updateThreadResponseAction,
} from './askingControllerThreadActions';

export type {
  SuggestedQuestionResponse,
  Task,
  AdjustmentTask,
  AskingTask,
  DetailedThread,
  RecommendedQuestionsTask,
} from './askingControllerTypes';
import type {
  AdjustmentTask,
  AskingTask,
  DetailedThread,
  RecommendedQuestionsTask,
  SuggestedQuestionResponse,
  Task,
} from './askingControllerTypes';

export class AskingController {
  public getSuggestedQuestions = async (
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<SuggestedQuestionResponse> => getSuggestedQuestionsAction(ctx);

  public createAskingTask = async (
    _root: any,
    args: {
      data: {
        question: string;
        threadId?: number;
        knowledgeBaseIds?: string[];
        selectedSkillIds?: string[];
      };
    },
    ctx: IContext,
  ): Promise<Task> => createAskingTaskAction(args, ctx);

  public cancelAskingTask = async (
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<boolean> => cancelAskingTaskAction(args, ctx);

  public getAskingTask = async (
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<AskingTask | null> => getAskingTaskAction(args, ctx);

  public createThread = async (
    _root: any,
    args: {
      data: {
        question?: string;
        taskId?: string;
        sql?: string;
        knowledgeBaseIds?: string[];
        selectedSkillIds?: string[];
      };
    },
    ctx: IContext,
  ): Promise<Thread> => createThreadAction(args, ctx);

  public getThread = async (
    _root: any,
    args: { threadId: number },
    ctx: IContext,
  ): Promise<DetailedThread> => getThreadAction(args, ctx);

  public updateThread = async (
    _root: any,
    args: { where: { id: number }; data: { summary: string } },
    ctx: IContext,
  ): Promise<Thread> => updateThreadAction(args, ctx);

  public deleteThread = async (
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ): Promise<boolean> => deleteThreadAction(args, ctx);

  public listThreads = async (
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Thread[]> => listThreadsAction(ctx);

  public createThreadResponse = async (
    _root: any,
    args: {
      threadId: number;
      data: {
        question?: string;
        taskId?: string;
        sql?: string;
      };
    },
    ctx: IContext,
  ): Promise<ThreadResponse> => createThreadResponseAction(args, ctx);

  public updateThreadResponse = async (
    _root: any,
    args: { where: { id: number }; data: { sql: string } },
    ctx: IContext,
  ): Promise<ThreadResponse> => updateThreadResponseAction(args, ctx);

  public rerunAskingTask = async (
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<Task> => rerunAskingTaskAction(args, ctx);

  public adjustThreadResponse = async (
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
  ): Promise<ThreadResponse> => adjustThreadResponseAction(args, ctx);

  public cancelAdjustThreadResponseAnswer = async (
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<boolean> => cancelAdjustThreadResponseAnswerAction(args, ctx);

  public rerunAdjustThreadResponseAnswer = async (
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<boolean> => rerunAdjustThreadResponseAnswerAction(args, ctx);

  public getAdjustmentTask = async (
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<AdjustmentTask | null> => getAdjustmentTaskAction(args, ctx);

  public generateThreadResponseBreakdown = async (
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> =>
    generateThreadResponseBreakdownAction(args, ctx);

  public generateThreadResponseAnswer = async (
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> => generateThreadResponseAnswerAction(args, ctx);

  public generateThreadResponseChart = async (
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> => generateThreadResponseChartAction(args, ctx);

  public adjustThreadResponseChart = async (
    _root: any,
    args: { responseId: number; data: ChartAdjustmentOption },
    ctx: IContext,
  ): Promise<ThreadResponse> => adjustThreadResponseChartAction(args, ctx);

  public getResponse = async (
    _root: any,
    args: { responseId: number },
    ctx: IContext,
  ): Promise<ThreadResponse> => getResponseAction(args, ctx);

  public previewData = async (
    _root: any,
    args: {
      where: { responseId: number; stepIndex?: number; limit?: number };
    },
    ctx: IContext,
  ): Promise<any> => previewDataAction(args, ctx);

  public previewBreakdownData = async (
    _root: any,
    args: { where: { responseId: number; stepIndex?: number; limit?: number } },
    ctx: IContext,
  ): Promise<any> => previewBreakdownDataAction(args, ctx);

  public createInstantRecommendedQuestions = async (
    _root: any,
    args: { data: { previousQuestions?: string[] } },
    ctx: IContext,
  ): Promise<Task> => createInstantRecommendedQuestionsAction(args, ctx);

  public getInstantRecommendedQuestions = async (
    _root: any,
    args: { taskId: string },
    ctx: IContext,
  ): Promise<RecommendedQuestionsTask> =>
    getInstantRecommendedQuestionsAction(args, ctx);

  public getThreadResponseNestedResolver = () =>
    createThreadResponseNestedResolver();

  public getDetailStepNestedResolver = () => createDetailStepNestedResolver();

  public getResultCandidateNestedResolver = () =>
    createResultCandidateNestedResolver();
}
