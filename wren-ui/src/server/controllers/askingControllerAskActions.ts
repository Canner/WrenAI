import { IContext } from '@server/types';
import { getSampleAskQuestions, SampleDatasetName } from '../data';
import { TelemetryEvent, WrenService } from '../telemetry/telemetry';
import {
  resolveRuntimeSampleDataset,
  resolveRuntimeProject as resolveScopedRuntimeProject,
} from '../utils/runtimeExecutionContext';
import {
  AskingTask,
  RecommendedQuestionsTask,
  SuggestedQuestionResponse,
  Task,
} from './askingControllerTypes';
import {
  assertExecutableRuntimeScope,
  assertKnowledgeBaseReadAccess,
  ensureAskingTaskScope,
  ensureResponseScope,
  ensureThreadScope,
  formatAdjustmentTask,
  getCurrentLanguage,
  getCurrentPersistedRuntimeIdentity,
  getCurrentRuntimeScopeId,
  recordKnowledgeBaseReadAudit,
  transformAskingTask,
} from './askingControllerScopeSupport';

export const getSuggestedQuestionsAction = async (
  ctx: IContext,
): Promise<SuggestedQuestionResponse> => {
  await assertKnowledgeBaseReadAccess(ctx);
  const project = ctx.runtimeScope
    ? await resolveScopedRuntimeProject(ctx.runtimeScope, ctx.projectService)
    : null;
  const sampleDataset = resolveRuntimeSampleDataset(
    project,
    ctx.runtimeScope?.knowledgeBase,
  );
  const result = sampleDataset
    ? {
        questions:
          getSampleAskQuestions(sampleDataset as SampleDatasetName) || [],
      }
    : { questions: [] };

  await recordKnowledgeBaseReadAudit(ctx, {
    payloadJson: {
      operation: 'get_suggested_questions',
    },
  });
  return result;
};

export const createAskingTaskAction = async (
  args: {
    data: {
      question: string;
      threadId?: number;
      knowledgeBaseIds?: string[];
      selectedSkillIds?: string[];
    };
  },
  ctx: IContext,
): Promise<Task> => {
  await assertKnowledgeBaseReadAccess(ctx);
  const { question, threadId, knowledgeBaseIds, selectedSkillIds } = args.data;
  if (threadId) {
    await ensureThreadScope(ctx, threadId);
  }
  await assertExecutableRuntimeScope(ctx);

  const task = await ctx.askingService.createAskingTask(
    { question, knowledgeBaseIds, selectedSkillIds },
    {
      runtimeScopeId: getCurrentRuntimeScopeId(ctx),
      runtimeIdentity: getCurrentPersistedRuntimeIdentity(ctx),
      threadId,
      language: await getCurrentLanguage(ctx),
    },
  );

  ctx.telemetry.sendEvent(TelemetryEvent.HOME_ASK_CANDIDATE, {
    question,
    taskId: task.id,
  });
  return task;
};

export const cancelAskingTaskAction = async (
  args: { taskId: string },
  ctx: IContext,
): Promise<boolean> => {
  await ensureAskingTaskScope(ctx, args.taskId);
  await ctx.askingService.cancelAskingTask(args.taskId);
  return true;
};

export const getAskingTaskAction = async (
  args: { taskId: string },
  ctx: IContext,
): Promise<AskingTask | null> => {
  await ensureAskingTaskScope(ctx, args.taskId);
  const askResult = await ctx.askingService.getAskingTask(args.taskId);
  if (!askResult) {
    return null;
  }

  const eventName = TelemetryEvent.HOME_ASK_CANDIDATE;
  if (askResult.status === 'FINISHED') {
    ctx.telemetry.sendEvent(eventName, {
      taskId: args.taskId,
      status: askResult.status,
      candidates: askResult.response,
    });
  }
  if (askResult.status === 'FAILED') {
    ctx.telemetry.sendEvent(
      eventName,
      {
        taskId: args.taskId,
        status: askResult.status,
        error: askResult.error,
      },
      WrenService.AI,
      false,
    );
  }

  const result = await transformAskingTask(askResult, ctx);
  await recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'asking_task',
    resourceId: args.taskId,
    payloadJson: {
      operation: 'get_asking_task',
    },
  });
  return result;
};

export const rerunAskingTaskAction = async (
  args: { responseId: number },
  ctx: IContext,
): Promise<Task> => {
  await ensureResponseScope(ctx, args.responseId);
  const task = await ctx.askingService.rerunAskingTask(args.responseId, {
    runtimeScopeId: getCurrentRuntimeScopeId(ctx),
    runtimeIdentity: getCurrentPersistedRuntimeIdentity(ctx),
    language: await getCurrentLanguage(ctx),
  });
  ctx.telemetry.sendEvent(TelemetryEvent.HOME_RERUN_ASKING_TASK, {
    responseId: args.responseId,
  });
  return task;
};

export const createInstantRecommendedQuestionsAction = async (
  args: { data: { previousQuestions?: string[] } },
  ctx: IContext,
): Promise<Task> => {
  await assertKnowledgeBaseReadAccess(ctx);
  return ctx.askingService.createInstantRecommendedQuestions(
    args.data,
    getCurrentPersistedRuntimeIdentity(ctx),
    getCurrentRuntimeScopeId(ctx),
  );
};

export const getInstantRecommendedQuestionsAction = async (
  args: { taskId: string },
  ctx: IContext,
): Promise<RecommendedQuestionsTask> => {
  await assertKnowledgeBaseReadAccess(ctx);
  const result = await ctx.askingService.getInstantRecommendedQuestions(
    args.taskId,
    getCurrentPersistedRuntimeIdentity(ctx),
  );
  const task = {
    questions: result.response?.questions || [],
    status: result.status,
    error: result.error,
  };
  await recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'asking_task',
    resourceId: args.taskId,
    payloadJson: {
      operation: 'get_instant_recommended_questions',
    },
  });
  return task;
};

export const getAdjustmentTaskAction = async (
  args: { taskId: string },
  ctx: IContext,
) => {
  await ensureAskingTaskScope(ctx, args.taskId);
  const adjustmentTask = await ctx.askingService.getAdjustmentTask(args.taskId);
  if (!adjustmentTask) {
    return null;
  }

  const result = formatAdjustmentTask(adjustmentTask);
  await recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'asking_task',
    resourceId: args.taskId,
    payloadJson: {
      operation: 'get_adjustment_task',
    },
  });
  return result;
};
