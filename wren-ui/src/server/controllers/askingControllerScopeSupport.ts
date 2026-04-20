import { IContext } from '@server/types';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
  assertLatestExecutableRuntimeScope,
  resolveProjectLanguage,
  resolveRuntimeProject as resolveScopedRuntimeProject,
} from '@server/utils/runtimeExecutionContext';
import * as Errors from '@server/utils/error';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';
import { AskResultStatus, AskResultType } from '@server/models/adaptor';
import { ThreadResponse } from '../repositories/threadResponseRepository';
import { TrackedAskingResult } from '../services';
import {
  AdjustmentTask,
  AskingTask,
  DetailedThread,
} from './askingControllerTypes';

export const getCurrentPersistedRuntimeIdentity = (ctx: IContext) =>
  toPersistedRuntimeIdentity(ctx.runtimeScope!);

export const getCurrentRuntimeScopeId = (ctx: IContext) =>
  ctx.runtimeScope?.selector?.runtimeScopeId || null;

export const getActiveRuntimeProject = async (ctx: IContext) => {
  const project = await resolveScopedRuntimeProject(
    ctx.runtimeScope!,
    ctx.projectService,
  );
  if (!project) {
    throw new Error('No project found for the active runtime scope');
  }

  return project;
};

export const getCurrentLanguage = async (ctx: IContext) => {
  const project = ctx.runtimeScope
    ? await resolveScopedRuntimeProject(ctx.runtimeScope, ctx.projectService)
    : null;
  return resolveProjectLanguage(project, ctx.runtimeScope?.knowledgeBase);
};

export const assertExecutableRuntimeScope = async (ctx: IContext) => {
  try {
    await assertLatestExecutableRuntimeScope({
      runtimeScope: ctx.runtimeScope!,
      knowledgeBaseRepository: ctx.knowledgeBaseRepository,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
    });
  } catch (error) {
    throw Errors.create(Errors.GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT, {
      customMessage:
        error instanceof Error
          ? error.message
          : OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
    });
  }
};

export const getKnowledgeBaseReadAuthorizationTarget = (ctx: IContext) => {
  const workspaceId = ctx.runtimeScope?.workspace?.id || null;
  const knowledgeBase = ctx.runtimeScope?.knowledgeBase;

  return {
    actor:
      ctx.authorizationActor ||
      buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope),
    resource: {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || workspaceId,
      workspaceId,
      attributes: {
        workspaceKind: ctx.runtimeScope?.workspace?.kind || null,
        knowledgeBaseKind: knowledgeBase?.kind || null,
      },
    },
  };
};

export const assertKnowledgeBaseReadAccess = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
  });
};

export const recordKnowledgeBaseReadAudit = async (
  ctx: IContext,
  {
    resourceType,
    resourceId,
    payloadJson,
  }: {
    resourceType?: string;
    resourceId?: string | number | null;
    payloadJson?: Record<string, any> | null;
  },
) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(ctx);
  await recordAuditEvent({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource: {
      ...resource,
      resourceType: resourceType || resource.resourceType,
      resourceId: resourceId ?? resource.resourceId ?? null,
    },
    result: 'allowed',
    payloadJson: payloadJson || undefined,
  });
};

export const ensureThreadScope = async (ctx: IContext, threadId: number) => {
  await assertKnowledgeBaseReadAccess(ctx);
  return ctx.askingService.assertThreadScope(
    threadId,
    getCurrentPersistedRuntimeIdentity(ctx),
  );
};

export const ensureResponseScope = async (
  ctx: IContext,
  responseId: number,
) => {
  await assertKnowledgeBaseReadAccess(ctx);
  await ctx.askingService.assertResponseScope(
    responseId,
    getCurrentPersistedRuntimeIdentity(ctx),
  );
};

export const ensureAskingTaskScope = async (ctx: IContext, taskId: string) => {
  await assertKnowledgeBaseReadAccess(ctx);
  await ctx.askingService.assertAskingTaskScope(
    taskId,
    getCurrentPersistedRuntimeIdentity(ctx),
  );
};

export const toDetailedThread = (
  threadId: number,
  scopedThread: {
    summary?: string | null;
    workspaceId?: string | null;
    knowledgeBaseId?: string | null;
    kbSnapshotId?: string | null;
    deployHash?: string | null;
    knowledgeBaseIds?: string[] | null;
    selectedSkillIds?: string[] | null;
  },
  responses: ThreadResponse[],
): DetailedThread => {
  const [firstResponse] = responses;

  return {
    id: firstResponse?.threadId || threadId,
    sql: firstResponse?.sql || '',
    summary: scopedThread.summary || undefined,
    workspaceId: scopedThread.workspaceId || null,
    knowledgeBaseId: scopedThread.knowledgeBaseId || null,
    kbSnapshotId: scopedThread.kbSnapshotId || null,
    deployHash: scopedThread.deployHash || null,
    knowledgeBaseIds: scopedThread.knowledgeBaseIds || [],
    selectedSkillIds: scopedThread.selectedSkillIds || [],
    responses: responses.map((response) => ({
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
    })),
  };
};

export const formatAdjustmentTask = (adjustmentTask: {
  queryId?: string | null;
  status: AdjustmentTask['status'];
  error?: AdjustmentTask['error'];
  response?: Array<{ sql?: string | null }> | null;
  traceId?: string | null;
  invalidSql?: string | null;
}): AdjustmentTask => ({
  queryId: adjustmentTask.queryId || '',
  status: adjustmentTask.status,
  error: adjustmentTask.error || null,
  sql: adjustmentTask.response?.[0]?.sql || '',
  traceId: adjustmentTask.traceId || '',
  invalidSql: adjustmentTask.invalidSql
    ? safeFormatSQL(adjustmentTask.invalidSql)
    : undefined,
});

export const findScopedView = async (ctx: IContext, viewId: number) =>
  ctx.modelService.getViewByRuntimeIdentity(
    getCurrentPersistedRuntimeIdentity(ctx),
    viewId,
  );

export const findScopedSqlPair = async (ctx: IContext, sqlPairId: number) =>
  ctx.sqlPairService.getSqlPair(
    getCurrentPersistedRuntimeIdentity(ctx),
    sqlPairId,
  );

export const transformAskingTask = async (
  askingTask: TrackedAskingResult,
  ctx: IContext,
): Promise<AskingTask> => {
  const candidates = await Promise.all(
    (askingTask.response || []).map(async (response) => {
      const view = response.viewId
        ? await findScopedView(ctx, response.viewId)
        : null;
      const sqlPair = response.sqlpairId
        ? await findScopedSqlPair(ctx, response.sqlpairId)
        : null;
      return {
        type: response.type,
        sql: response.sql,
        view,
        sqlPair,
      };
    }),
  );

  const type =
    askingTask?.status === AskResultStatus.STOPPED && !askingTask.type
      ? AskResultType.TEXT_TO_SQL
      : askingTask.type;

  return {
    type,
    status: askingTask.status,
    error: askingTask.error,
    candidates,
    queryId: askingTask.queryId,
    rephrasedQuestion: askingTask.rephrasedQuestion,
    intentReasoning: askingTask.intentReasoning,
    sqlGenerationReasoning: askingTask.sqlGenerationReasoning,
    retrievedTables: askingTask.retrievedTables,
    invalidSql: askingTask.invalidSql
      ? safeFormatSQL(askingTask.invalidSql)
      : undefined,
    traceId: askingTask.traceId,
  };
};
