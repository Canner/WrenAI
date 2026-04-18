import { ApiError } from '@/server/utils/apiUtils';
import type { IContext } from '@server/types';
import type { Dashboard, DashboardItem } from '@server/repositories';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';
import {
  OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
  assertLatestExecutableRuntimeScope,
} from '@server/utils/runtimeExecutionContext';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  normalizeCanonicalPersistedRuntimeIdentity,
  resolvePersistedProjectBridgeId,
} from '@server/utils/persistedRuntimeIdentity';
import {
  getDashboardRuntimeBinding,
  resolveDashboardExecutionContext,
  resolveDashboardScheduleBinding,
} from '@server/utils/dashboardRuntime';
import type { SetDashboardCacheData } from '@server/models/dashboard';
import { shapeChartPreviewData } from '@/utils/chartSpecRuntime';
import type { PreviewDataResponse } from '@server/services';
import { DEFAULT_PREVIEW_LIMIT } from '@server/services';

const getCurrentPersistedRuntimeIdentity = (ctx: IContext) =>
  normalizeCanonicalPersistedRuntimeIdentity(
    toPersistedRuntimeIdentity(ctx.runtimeScope!),
  );

const getKnowledgeBaseReadAuthorizationTarget = (ctx: IContext) => {
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

export const assertDashboardExecutableRuntimeScope = async (ctx: IContext) => {
  try {
    await assertLatestExecutableRuntimeScope({
      runtimeScope: ctx.runtimeScope!,
      knowledgeBaseRepository: ctx.knowledgeBaseRepository,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error
        ? error.message
        : OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
      409,
    );
  }
};

export const assertDashboardKnowledgeBaseReadAccess = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
  });
};

export const recordDashboardKnowledgeBaseReadAudit = async (
  ctx: IContext,
  {
    resourceType,
    resourceId,
    payloadJson,
  }: {
    resourceType?: string;
    resourceId?: string | number | null;
    payloadJson?: Record<string, any> | null;
  } = {},
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

export const ensureDashboardForScope = async (
  ctx: IContext,
  dashboardId: number,
): Promise<Dashboard> => {
  const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);
  const dashboard = await ctx.dashboardService.getDashboardForScope(
    dashboardId,
    resolvePersistedProjectBridgeId(runtimeIdentity),
    getDashboardRuntimeBinding(runtimeIdentity),
  );

  if (!dashboard) {
    throw new ApiError('Dashboard not found.', 404);
  }

  return dashboard;
};

export const ensureDashboardItemForScope = async (
  ctx: IContext,
  itemId: number,
): Promise<DashboardItem> => {
  const item = await ctx.dashboardService.getDashboardItem(itemId);
  const dashboard = await ensureDashboardForScope(ctx, item.dashboardId);

  if (item.dashboardId !== dashboard.id) {
    throw new ApiError(`Dashboard item not found. id: ${itemId}`, 404);
  }

  return item;
};

export const buildDashboardPreviewResponse = async ({
  ctx,
  dashboard,
  item,
  limit,
  refresh,
}: {
  ctx: IContext;
  dashboard: Dashboard;
  item: DashboardItem;
  limit?: number | null;
  refresh?: boolean | null;
}) => {
  const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);
  const { project, manifest } = await resolveDashboardExecutionContext({
    dashboard,
    kbSnapshotRepository: ctx.kbSnapshotRepository,
    projectService: ctx.projectService,
    deployService: ctx.deployService,
    requestRuntimeIdentity: runtimeIdentity,
  });

  const rawData = (await ctx.queryService.preview(item.detail.sql, {
    project,
    manifest,
    limit: limit || DEFAULT_PREVIEW_LIMIT,
    cacheEnabled: dashboard.cacheEnabled,
    refresh: Boolean(refresh),
  })) as PreviewDataResponse;

  const shapedChartPreview = shapeChartPreviewData({
    chartDetail: {
      chartSchema: item.detail.chartSchema,
      renderHints: item.detail.renderHints,
      chartDataProfile: item.detail.chartDataProfile,
    },
    previewData: rawData,
  });

  const values = shapedChartPreview.previewData.data.map((row) =>
    shapedChartPreview.previewData.columns.reduce<Record<string, unknown>>(
      (result, column, index) => {
        result[column.name] = row[index];
        return result;
      },
      {},
    ),
  );

  return {
    chartDataProfile:
      shapedChartPreview.chartDataProfile ||
      item.detail.chartDataProfile ||
      null,
    cacheHit: shapedChartPreview.previewData.cacheHit || false,
    cacheCreatedAt: shapedChartPreview.previewData.cacheCreatedAt || null,
    cacheOverrodeAt: shapedChartPreview.previewData.cacheOverrodeAt || null,
    override: shapedChartPreview.previewData.override || false,
    data: values,
  };
};

export const updateDashboardScheduleWithSync = async ({
  ctx,
  dashboardId,
  data,
}: {
  ctx: IContext;
  dashboardId: number;
  data: SetDashboardCacheData;
}) => {
  await assertDashboardExecutableRuntimeScope(ctx);
  const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);
  const dashboard = await ensureDashboardForScope(ctx, dashboardId);
  const actor =
    ctx.authorizationActor ||
    buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope);

  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'dashboard.schedule.manage',
    resource: {
      resourceType: 'dashboard',
      resourceId: dashboard.id,
      workspaceId: ctx.runtimeScope?.workspace?.id || null,
    },
  });

  const updatedDashboard = await ctx.dashboardService.setDashboardSchedule(
    dashboard.id,
    data,
  );
  const scheduleBinding = await resolveDashboardScheduleBinding({
    dashboard: updatedDashboard,
    runtimeIdentity,
    kbSnapshotRepository: ctx.kbSnapshotRepository,
    knowledgeBaseRepository: ctx.knowledgeBaseRepository,
  });

  await ctx.scheduleService.syncDashboardRefreshJob({
    dashboardId: updatedDashboard.id,
    enabled: Boolean(
      updatedDashboard.cacheEnabled && updatedDashboard.scheduleCron,
    ),
    cronExpr: updatedDashboard.scheduleCron,
    timezone: updatedDashboard.scheduleTimezone,
    nextRunAt: updatedDashboard.nextScheduledAt,
    workspaceId: scheduleBinding.workspaceId,
    knowledgeBaseId: scheduleBinding.knowledgeBaseId,
    kbSnapshotId: scheduleBinding.kbSnapshotId,
    deployHash: scheduleBinding.deployHash,
    createdBy: runtimeIdentity.actorUserId || null,
  });

  await recordAuditEvent({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'dashboard.schedule.manage',
    resource: {
      resourceType: 'dashboard',
      resourceId: dashboard.id,
      workspaceId: ctx.runtimeScope?.workspace?.id || null,
    },
    result: 'succeeded',
    beforeJson: dashboard as any,
    afterJson: updatedDashboard as any,
  });

  return updatedDashboard;
};
