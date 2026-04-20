import { PreviewSQLData } from '../models';
import { DataSourceName, IContext } from '../types';
import { PreviewDataResponse } from '@server/services';
import { getPreviewColumnsStr } from '../utils/model';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import { resolveRuntimeExecutionContext } from '../utils/runtimeExecutionContext';

interface ModelControllerPreviewDeps {
  assertExecutableRuntimeScope: (
    ctx: IContext,
    runtimeScope?: IContext['runtimeScope'],
  ) => Promise<void>;
  assertKnowledgeBaseReadAccess: (
    ctx: IContext,
    runtimeScope?: IContext['runtimeScope'],
  ) => Promise<void>;
  getRuntimeSelection: (ctx: IContext) => { runtimeIdentity: any };
  ensureViewScope: (
    ctx: IContext,
    viewId: number,
    errorMessage?: string,
  ) => Promise<any>;
  ensureModelScope: (
    ctx: IContext,
    modelId: number,
    errorMessage?: string,
  ) => Promise<any>;
  recordKnowledgeBaseReadAudit: (
    ctx: IContext,
    args: {
      runtimeScope?: IContext['runtimeScope'];
      resourceType?: string | null;
      resourceId?: string | number | null;
      payloadJson?: Record<string, any> | null;
    },
  ) => Promise<void>;
  getResponseExecutionContext: (
    ctx: IContext,
    source?: Record<string, any> | null,
  ) => Promise<any>;
  toExecutionRuntimeIdentitySource: (
    source?: Record<string, any> | null,
  ) => any;
  isInternalAiServicePreviewRequest: (
    ctx: IContext,
    runtimeScopeId?: string | null,
  ) => boolean;
}

export const previewModelDataAction = async ({
  modelId,
  ctx,
  deps,
}: {
  modelId: number;
  ctx: IContext;
  deps: Pick<
    ModelControllerPreviewDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseReadAccess'
    | 'ensureModelScope'
    | 'getRuntimeSelection'
    | 'getResponseExecutionContext'
    | 'toExecutionRuntimeIdentitySource'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const model = await deps.ensureModelScope(ctx, modelId);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  const { project, manifest } = await deps.getResponseExecutionContext(
    ctx,
    deps.toExecutionRuntimeIdentitySource({
      bridgeProjectId: model.projectId ?? null,
      deployHash: model.deployHash ?? runtimeIdentity.deployHash ?? null,
    }),
  );
  const modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds([
    model.id,
  ]);
  const sql = `select ${getPreviewColumnsStr(modelColumns)} from "${model.referenceName}"`;
  const data = (await ctx.queryService.preview(sql, {
    project,
    modelingOnly: false,
    manifest,
  })) as PreviewDataResponse;
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'model',
    resourceId: model.id,
    payloadJson: { operation: 'preview_model_data' },
  });
  return data;
};

export const previewViewDataAction = async ({
  viewId,
  limit,
  ctx,
  deps,
}: {
  viewId: number;
  limit?: number;
  ctx: IContext;
  deps: Pick<
    ModelControllerPreviewDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseReadAccess'
    | 'ensureViewScope'
    | 'getRuntimeSelection'
    | 'getResponseExecutionContext'
    | 'toExecutionRuntimeIdentitySource'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertExecutableRuntimeScope(ctx);
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const view = await deps.ensureViewScope(ctx, viewId);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  const { project, manifest } = await deps.getResponseExecutionContext(
    ctx,
    deps.toExecutionRuntimeIdentitySource({
      bridgeProjectId: view.projectId ?? null,
      deployHash: view.deployHash ?? runtimeIdentity.deployHash ?? null,
    }),
  );

  const data = (await ctx.queryService.preview(view.statement, {
    project,
    limit,
    manifest,
    modelingOnly: false,
  })) as PreviewDataResponse;
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'view',
    resourceId: view.id,
    payloadJson: { operation: 'preview_view_data' },
  });
  return data;
};

export const previewSqlAction = async ({
  data,
  ctx,
  deps,
}: {
  data: PreviewSQLData;
  ctx: IContext;
  deps: Pick<
    ModelControllerPreviewDeps,
    | 'assertExecutableRuntimeScope'
    | 'assertKnowledgeBaseReadAccess'
    | 'isInternalAiServicePreviewRequest'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  const { sql, limit, dryRun, runtimeScopeId } = data;
  const runtimeScope = runtimeScopeId
    ? await ctx.runtimeScopeResolver.resolveRuntimeScopeId(runtimeScopeId)
    : ctx.runtimeScope!;
  await deps.assertExecutableRuntimeScope(ctx, runtimeScope);
  if (!deps.isInternalAiServicePreviewRequest(ctx, runtimeScopeId)) {
    await deps.assertKnowledgeBaseReadAccess(ctx, runtimeScope);
  }
  const executionContext = await resolveRuntimeExecutionContext({
    runtimeScope,
    projectService: ctx.projectService,
  });
  if (!executionContext) {
    throw new Error('No deployment found, please deploy your project first');
  }
  const result = await ctx.queryService.preview(sql, {
    project: executionContext.project,
    limit,
    modelingOnly: false,
    manifest: executionContext.manifest,
    dryRun,
  });
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    runtimeScope,
    payloadJson: { operation: 'preview_sql' },
  });
  return result;
};

export const getNativeSqlAction = async ({
  responseId,
  ctx,
  deps,
}: {
  responseId: number;
  ctx: IContext;
  deps: Pick<
    ModelControllerPreviewDeps,
    | 'assertKnowledgeBaseReadAccess'
    | 'getRuntimeSelection'
    | 'getResponseExecutionContext'
    | 'toExecutionRuntimeIdentitySource'
    | 'recordKnowledgeBaseReadAudit'
  >;
}) => {
  await deps.assertKnowledgeBaseReadAccess(ctx);
  const { runtimeIdentity } = deps.getRuntimeSelection(ctx);
  await ctx.askingService.assertResponseScope(responseId, runtimeIdentity);
  const response = await ctx.askingService.getResponseScoped(
    responseId,
    runtimeIdentity,
  );
  if (!response) {
    throw new Error(`Thread response ${responseId} not found`);
  }
  if (!response.sql) {
    throw new Error(`Thread response ${responseId} has no SQL`);
  }
  const { project, manifest } = await deps.getResponseExecutionContext(
    ctx,
    deps.toExecutionRuntimeIdentitySource({
      bridgeProjectId: response.projectId ?? null,
      deployHash: response.deployHash ?? null,
    }),
  );
  if (project.sampleDataset) {
    throw new Error(`Doesn't support Native SQL`);
  }

  const nativeSql =
    project.type === DataSourceName.DUCKDB
      ? await ctx.wrenEngineAdaptor.getNativeSQL(response.sql, {
          manifest,
          modelingOnly: false,
        })
      : await ctx.ibisServerAdaptor.getNativeSql({
          dataSource: project.type,
          sql: response.sql,
          mdl: manifest,
        });
  const language = project.type === DataSourceName.MSSQL ? 'tsql' : undefined;
  await deps.recordKnowledgeBaseReadAudit(ctx, {
    resourceType: 'thread_response',
    resourceId: responseId,
    payloadJson: { operation: 'get_native_sql' },
  });
  return safeFormatSQL(nativeSql, { language });
};
