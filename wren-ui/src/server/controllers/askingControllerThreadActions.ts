import { IContext } from '@server/types';
import { ChartAdjustmentOption } from '@server/models/adaptor';
import { Thread } from '../repositories/threadRepository';
import { ThreadResponse } from '../repositories/threadResponseRepository';
import { AskingDetailTaskInput } from '../services/askingService';
import { TelemetryEvent } from '../telemetry/telemetry';
import { DetailedThread } from './askingControllerTypes';
import {
  assertKnowledgeBaseReadAccess,
  ensureAskingTaskScope,
  ensureResponseScope,
  ensureThreadScope,
  getCurrentLanguage,
  getCurrentPersistedRuntimeIdentity,
  getCurrentRuntimeScopeId,
  recordKnowledgeBaseReadAudit,
  toDetailedThread,
} from './askingControllerScopeSupport';

const resolveThreadInput = async (
  data: {
    question?: string;
    taskId?: string;
    sql?: string;
    knowledgeBaseIds?: string[];
    selectedSkillIds?: string[];
  },
  ctx: IContext,
): Promise<AskingDetailTaskInput> => {
  if (!data.taskId) {
    return data;
  }

  await ensureAskingTaskScope(ctx, data.taskId);
  const askingTask = await ctx.askingService.getAskingTask(data.taskId);
  if (!askingTask) {
    throw new Error(`Asking task ${data.taskId} not found`);
  }

  return {
    question: askingTask.question,
    trackedAskingResult: askingTask,
    knowledgeBaseIds: data.knowledgeBaseIds,
    selectedSkillIds: data.selectedSkillIds,
  };
};

const resolveThreadResponseInput = async (
  data: {
    question?: string;
    responseKind?: string;
    taskId?: string;
    sql?: string;
    sourceResponseId?: number;
  },
  ctx: IContext,
): Promise<AskingDetailTaskInput> => {
  if (!data.taskId) {
    return data;
  }

  await ensureAskingTaskScope(ctx, data.taskId);
  const askingTask = await ctx.askingService.getAskingTask(data.taskId);
  if (!askingTask) {
    throw new Error(`Asking task ${data.taskId} not found`);
  }

  return {
    question: askingTask.question,
    responseKind: data.responseKind,
    trackedAskingResult: askingTask,
    sourceResponseId: data.sourceResponseId,
  };
};

export const createThreadAction = async (
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
): Promise<Thread> => {
  await assertKnowledgeBaseReadAccess(ctx);
  const threadInput = await resolveThreadInput(args.data, ctx);
  const eventName = TelemetryEvent.HOME_CREATE_THREAD;

  try {
    const thread = await ctx.askingService.createThread(
      threadInput,
      getCurrentPersistedRuntimeIdentity(ctx),
    );
    ctx.telemetry.sendEvent(eventName, {});
    return {
      ...thread,
      knowledgeBaseIds: thread.knowledgeBaseIds || [],
      selectedSkillIds: thread.selectedSkillIds || [],
    };
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const getThreadAction = async (
  args: { threadId: number },
  ctx: IContext,
): Promise<DetailedThread> => {
  const scopedThread = await ensureThreadScope(ctx, args.threadId);
  const responses = await ctx.askingService.getResponsesWithThreadScoped(
    args.threadId,
    getCurrentPersistedRuntimeIdentity(ctx),
  );
  const result = toDetailedThread(args.threadId, scopedThread, responses);

  await recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'thread',
    resourceId: args.threadId,
    payloadJson: {
      operation: 'get_thread',
    },
  });
  return result;
};

export const updateThreadAction = async (
  args: { where: { id: number }; data: { summary: string } },
  ctx: IContext,
): Promise<Thread> => {
  await ensureThreadScope(ctx, args.where.id);
  const eventName = TelemetryEvent.HOME_UPDATE_THREAD_SUMMARY;

  try {
    const thread = await ctx.askingService.updateThreadScoped(
      args.where.id,
      getCurrentPersistedRuntimeIdentity(ctx),
      args.data,
    );
    ctx.telemetry.sendEvent(eventName, {
      new_summary: args.data.summary,
    });
    return thread;
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      {
        new_summary: args.data.summary,
      },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const deleteThreadAction = async (
  args: { where: { id: number } },
  ctx: IContext,
): Promise<boolean> => {
  await ensureThreadScope(ctx, args.where.id);
  await ctx.askingService.deleteThreadScoped(
    args.where.id,
    getCurrentPersistedRuntimeIdentity(ctx),
  );
  return true;
};

export const listThreadsAction = async (ctx: IContext): Promise<Thread[]> => {
  await assertKnowledgeBaseReadAccess(ctx);
  const threads = await ctx.askingService.listThreads(
    getCurrentPersistedRuntimeIdentity(ctx),
  );
  const result = threads.map((thread) => ({
    ...thread,
    knowledgeBaseIds: thread.knowledgeBaseIds || [],
    selectedSkillIds: thread.selectedSkillIds || [],
  }));
  await recordKnowledgeBaseReadAudit(ctx, {
    payloadJson: {
      operation: 'list_threads',
    },
  });
  return result;
};

export const createThreadResponseAction = async (
  args: {
    threadId: number;
    data: {
      question?: string;
      responseKind?: string;
      taskId?: string;
      sql?: string;
      sourceResponseId?: number;
    };
  },
  ctx: IContext,
): Promise<ThreadResponse> => {
  await ensureThreadScope(ctx, args.threadId);
  const threadResponseInput = await resolveThreadResponseInput(args.data, ctx);
  const eventName = TelemetryEvent.HOME_ASK_FOLLOWUP_QUESTION;

  try {
    const response = await ctx.askingService.createThreadResponseScoped(
      threadResponseInput,
      args.threadId,
      getCurrentPersistedRuntimeIdentity(ctx),
    );
    ctx.telemetry.sendEvent(eventName, { data: args.data });
    return response;
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { data: args.data, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const updateThreadResponseAction = async (
  args: { where: { id: number }; data: { sql: string } },
  ctx: IContext,
): Promise<ThreadResponse> => {
  await ensureResponseScope(ctx, args.where.id);
  return ctx.askingService.updateThreadResponseScoped(
    args.where.id,
    getCurrentPersistedRuntimeIdentity(ctx),
    args.data,
  );
};

export const adjustThreadResponseAction = async (
  args: {
    responseId: number;
    data: {
      tables?: string[];
      sqlGenerationReasoning?: string;
      sql?: string;
    };
  },
  ctx: IContext,
): Promise<ThreadResponse> => {
  await ensureResponseScope(ctx, args.responseId);

  if (args.data.sql) {
    const response = await ctx.askingService.adjustThreadResponseWithSQLScoped(
      args.responseId,
      getCurrentPersistedRuntimeIdentity(ctx),
      { sql: args.data.sql },
    );
    ctx.telemetry.sendEvent(
      TelemetryEvent.HOME_ADJUST_THREAD_RESPONSE_WITH_SQL,
      {
        sql: args.data.sql,
        responseId: args.responseId,
      },
    );
    return response;
  }

  return ctx.askingService.adjustThreadResponseAnswerScoped(
    args.responseId,
    getCurrentPersistedRuntimeIdentity(ctx),
    {
      runtimeIdentity: getCurrentPersistedRuntimeIdentity(ctx),
      tables: args.data.tables || [],
      sqlGenerationReasoning: args.data.sqlGenerationReasoning || '',
    },
    {
      language: await getCurrentLanguage(ctx),
    },
    getCurrentRuntimeScopeId(ctx),
  );
};

export const cancelAdjustThreadResponseAnswerAction = async (
  args: { taskId: string },
  ctx: IContext,
): Promise<boolean> => {
  await ensureAskingTaskScope(ctx, args.taskId);
  await ctx.askingService.cancelAdjustThreadResponseAnswer(args.taskId);
  return true;
};

export const rerunAdjustThreadResponseAnswerAction = async (
  args: { responseId: number },
  ctx: IContext,
): Promise<boolean> => {
  await ensureResponseScope(ctx, args.responseId);
  await ctx.askingService.rerunAdjustThreadResponseAnswer(
    args.responseId,
    getCurrentPersistedRuntimeIdentity(ctx),
    {
      language: await getCurrentLanguage(ctx),
    },
    getCurrentRuntimeScopeId(ctx),
  );
  return true;
};

export const generateThreadResponseBreakdownAction = async (
  args: { responseId: number },
  ctx: IContext,
): Promise<ThreadResponse> => {
  await ensureResponseScope(ctx, args.responseId);
  return ctx.askingService.generateThreadResponseBreakdownScoped(
    args.responseId,
    getCurrentPersistedRuntimeIdentity(ctx),
    { language: await getCurrentLanguage(ctx) },
  );
};

export const generateThreadResponseAnswerAction = async (
  args: { responseId: number },
  ctx: IContext,
): Promise<ThreadResponse> => {
  await ensureResponseScope(ctx, args.responseId);
  return ctx.askingService.generateThreadResponseAnswerScoped(
    args.responseId,
    getCurrentPersistedRuntimeIdentity(ctx),
    {
      language: await getCurrentLanguage(ctx),
    },
  );
};

export const generateThreadResponseChartAction = async (
  args: { responseId: number },
  ctx: IContext,
): Promise<ThreadResponse> => {
  await ensureResponseScope(ctx, args.responseId);
  return ctx.askingService.generateThreadResponseChartScoped(
    args.responseId,
    getCurrentPersistedRuntimeIdentity(ctx),
    {
      language: await getCurrentLanguage(ctx),
    },
    getCurrentRuntimeScopeId(ctx),
  );
};

export const adjustThreadResponseChartAction = async (
  args: { responseId: number; data: ChartAdjustmentOption },
  ctx: IContext,
): Promise<ThreadResponse> => {
  await ensureResponseScope(ctx, args.responseId);
  return ctx.askingService.adjustThreadResponseChartScoped(
    args.responseId,
    getCurrentPersistedRuntimeIdentity(ctx),
    args.data,
    {
      language: await getCurrentLanguage(ctx),
    },
    getCurrentRuntimeScopeId(ctx),
  );
};

export const getResponseAction = async (
  args: { responseId: number },
  ctx: IContext,
): Promise<ThreadResponse> => {
  await ensureResponseScope(ctx, args.responseId);
  const response = await ctx.askingService.getResponseScoped(
    args.responseId,
    getCurrentPersistedRuntimeIdentity(ctx),
  );
  await recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'thread_response',
    resourceId: args.responseId,
    payloadJson: {
      operation: 'get_response',
    },
  });
  return response;
};

export const previewDataAction = async (
  args: { where: { responseId: number; stepIndex?: number; limit?: number } },
  ctx: IContext,
): Promise<any> => {
  const { responseId, limit } = args.where;
  await ensureResponseScope(ctx, responseId);
  const data = await ctx.askingService.previewDataScoped(
    responseId,
    getCurrentPersistedRuntimeIdentity(ctx),
    limit,
  );
  await recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'thread_response',
    resourceId: responseId,
    payloadJson: {
      operation: 'preview_data',
    },
  });
  return data;
};

export const previewBreakdownDataAction = async (
  args: { where: { responseId: number; stepIndex?: number; limit?: number } },
  ctx: IContext,
): Promise<any> => {
  const { responseId, stepIndex, limit } = args.where;
  await ensureResponseScope(ctx, responseId);
  const data = await ctx.askingService.previewBreakdownDataScoped(
    responseId,
    getCurrentPersistedRuntimeIdentity(ctx),
    stepIndex,
    limit,
  );
  await recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'thread_response',
    resourceId: responseId,
    payloadJson: {
      operation: 'preview_breakdown_data',
      stepIndex: stepIndex ?? null,
    },
  });
  return data;
};
