import { IContext } from '@server/types';
import { ChartType } from '@server/models/adaptor';
import {
  UpdateDashboardItemLayouts,
  PreviewDataResponse,
  DEFAULT_PREVIEW_LIMIT,
} from '@server/services';
import {
  Dashboard,
  DashboardItem,
  DashboardItemType,
} from '@server/repositories';
import { getLogger } from '@server/utils';
import {
  getDashboardRuntimeBinding,
  resolveDashboardExecutionContext,
} from '@server/utils/dashboardRuntime';
import {
  SetDashboardCacheData,
  DashboardSchedule,
  PreviewItemResponse,
} from '@server/models/dashboard';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';
import { resolvePersistedProjectBridgeId } from '@server/utils/persistedRuntimeIdentity';
import { shapeChartPreviewData } from '@/utils/chartSpecRuntime';
import {
  assertDashboardExecutableRuntimeScope,
  assertDashboardKnowledgeBaseReadAccess,
  ensureCurrentDashboardForRequestedScope,
  ensureDashboardForWorkspaceScope,
  ensureDashboardItemInScope,
  getCurrentPersistedDashboardScopeIdentity,
  getCurrentPersistedRuntimeIdentity,
  getCurrentPersistedWorkspaceIdentity,
  getDashboardControllerErrorMessage,
  recordDashboardKnowledgeBaseReadAudit,
  resolveDashboardScheduleRuntimeBinding,
  shouldUseWorkspaceScopedDashboardCreate,
  toDashboardPreviewItemResponse,
  toDashboardResponseRuntimeIdentitySource,
} from './dashboardControllerSupport';

const logger = getLogger('DashboardController');
logger.level = 'debug';

export class DashboardController {
  constructor() {
    this.getDashboards = this.getDashboards.bind(this);
    this.getDashboard = this.getDashboard.bind(this);
    this.getDashboardItems = this.getDashboardItems.bind(this);
    this.createDashboard = this.createDashboard.bind(this);
    this.updateDashboard = this.updateDashboard.bind(this);
    this.deleteDashboard = this.deleteDashboard.bind(this);
    this.createDashboardItem = this.createDashboardItem.bind(this);
    this.updateDashboardItem = this.updateDashboardItem.bind(this);
    this.deleteDashboardItem = this.deleteDashboardItem.bind(this);
    this.updateDashboardItemLayouts =
      this.updateDashboardItemLayouts.bind(this);
    this.previewItemSQL = this.previewItemSQL.bind(this);
    this.setDashboardSchedule = this.setDashboardSchedule.bind(this);
  }

  public async getDashboards(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Dashboard[]> {
    await assertDashboardKnowledgeBaseReadAccess(ctx);
    const runtimeIdentity = getCurrentPersistedDashboardScopeIdentity(ctx);
    const dashboards = await ctx.dashboardService.listDashboardsForScope(
      resolvePersistedProjectBridgeId(runtimeIdentity),
      getDashboardRuntimeBinding(runtimeIdentity),
    );
    await recordDashboardKnowledgeBaseReadAudit(ctx, {
      payloadJson: {
        operation: 'get_dashboards',
      },
    });
    return dashboards;
  }

  public async getDashboard(
    _root: any,
    args: { where?: { id?: number | null } } | null | undefined,
    ctx: IContext,
  ): Promise<
    Omit<Dashboard, 'nextScheduledAt'> & {
      schedule: DashboardSchedule;
      items: DashboardItem[];
      nextScheduledAt: string | null;
    }
  > {
    await assertDashboardKnowledgeBaseReadAccess(ctx);
    const dashboard = await ensureCurrentDashboardForRequestedScope(
      ctx,
      args?.where?.id,
    );
    const schedule = ctx.dashboardService.parseCronExpression(dashboard);
    const items = await ctx.dashboardService.getDashboardItems(dashboard.id);
    const result = {
      ...dashboard,
      nextScheduledAt: dashboard.nextScheduledAt
        ? new Date(dashboard.nextScheduledAt).toISOString()
        : null,
      schedule,
      items,
    };
    await recordDashboardKnowledgeBaseReadAudit(ctx, {
      resourceType: 'dashboard',
      resourceId: dashboard.id,
      payloadJson: {
        operation: 'get_dashboard',
      },
    });
    return result;
  }

  public async getDashboardItems(
    _root: any,
    args: { where?: { id?: number | null } } | null | undefined,
    ctx: IContext,
  ): Promise<DashboardItem[]> {
    await assertDashboardKnowledgeBaseReadAccess(ctx);
    const dashboard = await ensureCurrentDashboardForRequestedScope(
      ctx,
      args?.where?.id,
    );
    const items = await ctx.dashboardService.getDashboardItems(dashboard.id);
    await recordDashboardKnowledgeBaseReadAudit(ctx, {
      resourceType: 'dashboard',
      resourceId: dashboard.id,
      payloadJson: {
        operation: 'get_dashboard_items',
      },
    });
    return items;
  }

  public async createDashboard(
    _root: any,
    args: { data: { name: string } },
    ctx: IContext,
  ): Promise<Dashboard> {
    await assertDashboardKnowledgeBaseReadAccess(ctx);
    const createInWorkspaceScope = shouldUseWorkspaceScopedDashboardCreate(ctx);
    if (!createInWorkspaceScope) {
      await assertDashboardExecutableRuntimeScope(ctx);
    }
    const runtimeIdentity = createInWorkspaceScope
      ? getCurrentPersistedWorkspaceIdentity(ctx)
      : getCurrentPersistedRuntimeIdentity(ctx);
    const name = args.data?.name?.trim();
    if (!name) {
      throw new Error('Dashboard name is required.');
    }

    return await ctx.dashboardService.createDashboardForScope(
      { name },
      resolvePersistedProjectBridgeId(runtimeIdentity),
      getDashboardRuntimeBinding(runtimeIdentity),
    );
  }

  public async updateDashboard(
    _root: any,
    args: {
      where: { id: number };
      data: { isDefault?: boolean; name?: string };
    },
    ctx: IContext,
  ): Promise<Dashboard> {
    await assertDashboardExecutableRuntimeScope(ctx);
    const runtimeIdentity = getCurrentPersistedDashboardScopeIdentity(ctx);
    const normalizedName =
      args.data?.name === undefined ? undefined : String(args.data.name).trim();
    if (normalizedName !== undefined && !normalizedName) {
      throw new Error('Dashboard name is required.');
    }

    return await ctx.dashboardService.updateDashboardForScope(
      args.where.id,
      {
        ...(normalizedName !== undefined ? { name: normalizedName } : {}),
        ...(args.data?.isDefault === true ? { isDefault: true } : {}),
      },
      resolvePersistedProjectBridgeId(runtimeIdentity),
      getDashboardRuntimeBinding(runtimeIdentity),
    );
  }

  public async deleteDashboard(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ): Promise<Dashboard> {
    await assertDashboardExecutableRuntimeScope(ctx);
    const runtimeIdentity = getCurrentPersistedDashboardScopeIdentity(ctx);

    return await ctx.dashboardService.deleteDashboardForScope(
      args.where.id,
      resolvePersistedProjectBridgeId(runtimeIdentity),
      getDashboardRuntimeBinding(runtimeIdentity),
    );
  }

  public async createDashboardItem(
    _root: any,
    args: {
      data: {
        itemType: DashboardItemType;
        responseId: number;
        dashboardId?: number | null;
      };
    },
    ctx: IContext,
  ): Promise<DashboardItem> {
    const { responseId, itemType, dashboardId } = args.data;
    await assertDashboardExecutableRuntimeScope(ctx);
    const dashboard =
      dashboardId != null
        ? await ensureDashboardForWorkspaceScope(ctx, dashboardId)
        : await ensureCurrentDashboardForRequestedScope(ctx, dashboardId);
    const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);
    await ctx.askingService.assertResponseScope(responseId, runtimeIdentity);
    const response = await ctx.askingService.getResponseScoped(
      responseId,
      runtimeIdentity,
    );

    if (!response) {
      throw new Error(`Thread response not found. responseId: ${responseId}`);
    }
    if (!Object.keys(ChartType).includes(itemType)) {
      throw new Error(`Chart type not supported. responseId: ${responseId}`);
    }
    if (!response.chartDetail?.chartSchema) {
      throw new Error(
        `Chart schema not found in thread response. responseId: ${responseId}`,
      );
    }
    const responseSql = response.sql;
    if (!responseSql) {
      throw new Error(
        `SQL not found in thread response. responseId: ${responseId}`,
      );
    }
    const sourceRuntimeIdentity = {
      ...(response.projectId != null ? { projectId: response.projectId } : {}),
      ...(response.workspaceId ? { workspaceId: response.workspaceId } : {}),
      ...(response.knowledgeBaseId
        ? { knowledgeBaseId: response.knowledgeBaseId }
        : {}),
      ...(response.kbSnapshotId ? { kbSnapshotId: response.kbSnapshotId } : {}),
      ...(response.deployHash ? { deployHash: response.deployHash } : {}),
    };

    const { project, manifest } = await resolveDashboardExecutionContext({
      dashboard,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
      projectService: ctx.projectService,
      deployService: ctx.deployService,
      requestRuntimeIdentity: runtimeIdentity,
      runtimeIdentitySource:
        Object.keys(sourceRuntimeIdentity).length > 0
          ? sourceRuntimeIdentity
          : toDashboardResponseRuntimeIdentitySource(response),
    });
    await ctx.queryService.preview(responseSql, {
      project,
      manifest,
      limit: DEFAULT_PREVIEW_LIMIT,
      cacheEnabled: true,
      refresh: true,
    });

    return await ctx.dashboardService.createDashboardItem({
      dashboardId: dashboard.id,
      type: itemType,
      sql: responseSql,
      chartSchema: response.chartDetail?.chartSchema,
      renderHints: response.chartDetail?.renderHints,
      canonicalizationVersion: response.chartDetail?.canonicalizationVersion,
      chartDataProfile: response.chartDetail?.chartDataProfile,
      validationErrors: response.chartDetail?.validationErrors,
      sourceRuntimeIdentity:
        Object.keys(sourceRuntimeIdentity).length > 0
          ? sourceRuntimeIdentity
          : undefined,
      sourceResponseId: response.id,
      sourceThreadId: response.threadId,
      sourceQuestion: response.question,
    });
  }

  public async updateDashboardItem(
    _root: any,
    args: { where: { id: number }; data: { displayName: string } },
    ctx: IContext,
  ): Promise<DashboardItem> {
    await assertDashboardExecutableRuntimeScope(ctx);
    const { id } = args.where;
    const { displayName } = args.data;
    await ensureDashboardItemInScope(ctx, id);
    return await ctx.dashboardService.updateDashboardItem(id, { displayName });
  }

  public async deleteDashboardItem(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ): Promise<boolean> {
    await assertDashboardExecutableRuntimeScope(ctx);
    const { id } = args.where;
    await ensureDashboardItemInScope(ctx, id);
    return await ctx.dashboardService.deleteDashboardItem(id);
  }

  public async updateDashboardItemLayouts(
    _root: any,
    args: { data: { layouts: UpdateDashboardItemLayouts } },
    ctx: IContext,
  ): Promise<DashboardItem[]> {
    await assertDashboardExecutableRuntimeScope(ctx);
    const { layouts } = args.data;
    if (layouts.length === 0) {
      throw new Error('Layouts are required.');
    }
    await Promise.all(
      layouts.map((layout) => ensureDashboardItemInScope(ctx, layout.itemId)),
    );
    return await ctx.dashboardService.updateDashboardItemLayouts(layouts);
  }

  public async previewItemSQL(
    _root: any,
    args: { data: { itemId: number; limit?: number; refresh?: boolean } },
    ctx: IContext,
  ): Promise<PreviewItemResponse> {
    const { itemId, limit, refresh } = args.data;
    try {
      await assertDashboardKnowledgeBaseReadAccess(ctx);
      const { item, dashboard } = await ensureDashboardItemInScope(ctx, itemId);
      if (!item.detail.runtimeIdentity) {
        await assertDashboardExecutableRuntimeScope(ctx);
      }
      const { cacheEnabled } = dashboard;
      const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);
      const { project, manifest } = await resolveDashboardExecutionContext({
        dashboard,
        kbSnapshotRepository: ctx.kbSnapshotRepository,
        projectService: ctx.projectService,
        deployService: ctx.deployService,
        requestRuntimeIdentity: runtimeIdentity,
        responseRuntimeIdentity: item.detail.runtimeIdentity || null,
      });
      const rawData = (await ctx.queryService.preview(item.detail.sql, {
        project,
        manifest,
        limit: limit || DEFAULT_PREVIEW_LIMIT,
        cacheEnabled,
        refresh: refresh || false,
      })) as PreviewDataResponse;
      const shapedChartPreview = shapeChartPreviewData({
        chartDetail: {
          chartSchema: item.detail.chartSchema,
          renderHints: item.detail.renderHints,
          chartDataProfile: item.detail.chartDataProfile,
        },
        previewData: rawData,
      });

      const result = toDashboardPreviewItemResponse({
        item,
        previewData: shapedChartPreview.previewData,
        chartDataProfile: shapedChartPreview.chartDataProfile,
      });
      await recordDashboardKnowledgeBaseReadAudit(ctx, {
        resourceType: 'dashboard_item',
        resourceId: itemId,
        payloadJson: {
          operation: 'preview_item_sql',
        },
      });
      return result;
    } catch (error) {
      logger.error(`Error previewing SQL item ${itemId}: ${error}`);
      throw error;
    }
  }

  public async setDashboardSchedule(
    _root: any,
    args: { data: SetDashboardCacheData },
    ctx: IContext,
  ): Promise<Dashboard> {
    try {
      await assertDashboardExecutableRuntimeScope(ctx);
      const runtimeIdentity = getCurrentPersistedDashboardScopeIdentity(ctx);
      const dashboard = await ensureCurrentDashboardForRequestedScope(ctx);
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
        args.data,
      );
      const scheduleBinding = await resolveDashboardScheduleRuntimeBinding(
        ctx,
        updatedDashboard,
        runtimeIdentity,
      );

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
    } catch (error) {
      logger.error(
        `Failed to set dashboard schedule: ${getDashboardControllerErrorMessage(error)}`,
      );
      throw error;
    }
  }
}
