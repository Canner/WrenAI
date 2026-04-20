import { IContext } from '@server/types';
import { constructCteSql } from '../services/askingService';
import {
  DetailStep,
  ThreadResponse,
} from '../repositories/threadResponseRepository';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import {
  findScopedView,
  formatAdjustmentTask,
  getCurrentPersistedRuntimeIdentity,
  transformAskingTask,
} from './askingControllerScopeSupport';
import { AdjustmentTask } from './askingControllerTypes';

const resolveDisplayName = (view: {
  properties?: string | null;
  name?: string;
}) => (view.properties ? JSON.parse(view.properties)?.displayName : view.name);

const formatAnswerDetail = (answerDetail: ThreadResponse['answerDetail']) => {
  if (!answerDetail) {
    return null;
  }

  const { content, ...rest } = answerDetail;
  if (!content) {
    return answerDetail;
  }

  return {
    ...rest,
    content: content.replace(/\\n/g, '\n').replace(/\\"/g, '"'),
  };
};

export const createThreadResponseNestedResolver = () => ({
  view: async (parent: ThreadResponse, _args: any, ctx: IContext) => {
    if (!parent.viewId) {
      return null;
    }
    const view = await findScopedView(ctx, parent.viewId);
    if (!view) {
      return null;
    }
    return { ...view, displayName: resolveDisplayName(view) };
  },
  answerDetail: (parent: ThreadResponse) =>
    formatAnswerDetail(parent?.answerDetail),
  sql: (parent: ThreadResponse) => {
    if (parent.breakdownDetail?.steps) {
      return safeFormatSQL(constructCteSql(parent.breakdownDetail.steps));
    }
    return parent.sql ? safeFormatSQL(parent.sql) : null;
  },
  askingTask: async (parent: ThreadResponse, _args: any, ctx: IContext) => {
    if (parent.adjustment || !parent.askingTaskId) {
      return null;
    }
    await ctx.askingService.assertAskingTaskScopeById(
      parent.askingTaskId,
      getCurrentPersistedRuntimeIdentity(ctx),
    );
    const askingTask = await ctx.askingService.getAskingTaskById(
      parent.askingTaskId,
    );
    if (!askingTask) {
      return null;
    }
    return transformAskingTask(askingTask, ctx);
  },
  adjustmentTask: async (
    parent: ThreadResponse,
    _args: any,
    ctx: IContext,
  ): Promise<AdjustmentTask | null> => {
    if (!parent.adjustment || !parent.askingTaskId) {
      return null;
    }
    await ctx.askingService.assertAskingTaskScopeById(
      parent.askingTaskId,
      getCurrentPersistedRuntimeIdentity(ctx),
    );
    const adjustmentTask = await ctx.askingService.getAdjustmentTaskById(
      parent.askingTaskId,
    );
    return adjustmentTask ? formatAdjustmentTask(adjustmentTask) : null;
  },
});

export const createDetailStepNestedResolver = () => ({
  sql: (parent: DetailStep) => safeFormatSQL(parent.sql),
});

export const createResultCandidateNestedResolver = () => ({
  sql: (parent: { sql: string }) => safeFormatSQL(parent.sql),
  view: async (
    parent: { view?: { id?: number; [key: string]: unknown } | null },
    _args: any,
    ctx: IContext,
  ) => {
    const viewId = parent.view?.id;
    if (!viewId) {
      return parent.view;
    }
    const view = await findScopedView(ctx, viewId);
    if (!view) {
      return null;
    }
    return {
      ...parent.view,
      displayName: resolveDisplayName(view),
    };
  },
});
