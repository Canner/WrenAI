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
  resolveDashboardScheduleBinding,
} from '@server/utils/dashboardRuntime';
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
  SetDashboardCacheData,
  DashboardSchedule,
  PreviewItemResponse,
} from '@server/models/dashboard';
import * as Errors from '@server/utils/error';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';
import { shapeChartPreviewData } from '@/utils/chartSpecRuntime';

const logger = getLogger('DashboardResolver');
logger.level = 'debug';

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class DashboardResolver {
  constructor() {
    this.getDashboards = this.getDashboards.bind(this);
    this.getDashboard = this.getDashboard.bind(this);
    this.getDashboardItems = this.getDashboardItems.bind(this);
    this.createDashboard = this.createDashboard.bind(this);
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
    await this.assertKnowledgeBaseReadAccess(ctx);
    const runtimeIdentity = this.getCurrentPersistedRuntimeIdentity(ctx);
    const dashboards = await ctx.dashboardService.listDashboardsForScope(
      resolvePersistedProjectBridgeId(runtimeIdentity),
      getDashboardRuntimeBinding(runtimeIdentity),
    );
    await this.recordKnowledgeBaseReadAudit(ctx, {
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
    await this.assertKnowledgeBaseReadAccess(ctx);
    const dashboard = await this.ensureCurrentDashboard(ctx, args?.where?.id);
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
    await this.recordKnowledgeBaseReadAudit(ctx, {
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
    await this.assertKnowledgeBaseReadAccess(ctx);
    const dashboard = await this.ensureCurrentDashboard(ctx, args?.where?.id);
    const items = await ctx.dashboardService.getDashboardItems(dashboard.id);
    await this.recordKnowledgeBaseReadAudit(ctx, {
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
    await this.assertExecutableRuntimeScope(ctx);
    const runtimeIdentity = this.getCurrentPersistedRuntimeIdentity(ctx);
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
    await this.assertExecutableRuntimeScope(ctx);
    const dashboard = await this.ensureCurrentDashboard(ctx, dashboardId);
    const runtimeIdentity = this.getCurrentPersistedRuntimeIdentity(ctx);
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

    // query with cache enabled
    const { project, manifest } = await resolveDashboardExecutionContext({
      dashboard,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
      projectService: ctx.projectService,
      deployService: ctx.deployService,
      requestRuntimeIdentity: runtimeIdentity,
      responseRuntimeIdentity: this.toResponseRuntimeIdentitySource(response),
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
    await this.assertExecutableRuntimeScope(ctx);
    const { id } = args.where;
    const { displayName } = args.data;
    await this.ensureDashboardItemScope(ctx, id);
    return await ctx.dashboardService.updateDashboardItem(id, { displayName });
  }

  public async deleteDashboardItem(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ): Promise<boolean> {
    await this.assertExecutableRuntimeScope(ctx);
    const { id } = args.where;
    await this.ensureDashboardItemScope(ctx, id);
    return await ctx.dashboardService.deleteDashboardItem(id);
  }

  public async updateDashboardItemLayouts(
    _root: any,
    args: { data: { layouts: UpdateDashboardItemLayouts } },
    ctx: IContext,
  ): Promise<DashboardItem[]> {
    await this.assertExecutableRuntimeScope(ctx);
    const { layouts } = args.data;
    if (layouts.length === 0) {
      throw new Error('Layouts are required.');
    }
    await Promise.all(
      layouts.map((layout) =>
        this.ensureDashboardItemScope(ctx, layout.itemId),
      ),
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
      await this.assertKnowledgeBaseReadAccess(ctx);
      await this.assertExecutableRuntimeScope(ctx);
      const item = await this.ensureDashboardItemScope(ctx, itemId);
      const dashboard = await this.ensureCurrentDashboard(ctx);
      const { cacheEnabled } = dashboard;
      const runtimeIdentity = this.getCurrentPersistedRuntimeIdentity(ctx);
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

      // handle data to [{ column1: value1, column2: value2, ... }]
      const values = shapedChartPreview.previewData.data.map((val) => {
        return shapedChartPreview.previewData.columns.reduce<Record<string, unknown>>(
          (acc, col, index) => {
            acc[col.name] = val[index];
            return acc;
          },
          {},
        );
      });
      const result = {
        chartDataProfile:
          shapedChartPreview.chartDataProfile || item.detail.chartDataProfile || null,
        cacheHit: shapedChartPreview.previewData.cacheHit || false,
        cacheCreatedAt: shapedChartPreview.previewData.cacheCreatedAt || null,
        cacheOverrodeAt: shapedChartPreview.previewData.cacheOverrodeAt || null,
        override: shapedChartPreview.previewData.override || false,
        data: values,
      } as PreviewItemResponse;
      await this.recordKnowledgeBaseReadAudit(ctx, {
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
      await this.assertExecutableRuntimeScope(ctx);
      const runtimeIdentity = this.getCurrentPersistedRuntimeIdentity(ctx);
      const dashboard = await this.ensureCurrentDashboard(ctx);
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
      const scheduleBinding = await this.resolveScheduleBinding(
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
        `Failed to set dashboard schedule: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  private async ensureCurrentDashboard(
    ctx: IContext,
    dashboardId?: number | null,
  ): Promise<Dashboard> {
    const runtimeIdentity = this.getCurrentPersistedRuntimeIdentity(ctx);
    const resolvedProjectBridgeId =
      resolvePersistedProjectBridgeId(runtimeIdentity);
    const binding = getDashboardRuntimeBinding(runtimeIdentity);
    const dashboard =
      dashboardId != null
        ? await ctx.dashboardService.getDashboardForScope(
            dashboardId,
            resolvedProjectBridgeId,
            binding,
          )
        : await ctx.dashboardService.getCurrentDashboardForScope(
            resolvedProjectBridgeId,
            binding,
          );
    if (!dashboard) {
      throw new Error('Dashboard not found.');
    }

    return dashboard;
  }

  private async ensureDashboardItemScope(
    ctx: IContext,
    itemId: number,
  ): Promise<DashboardItem> {
    const item = await ctx.dashboardService.getDashboardItem(itemId);
    const dashboard = await this.ensureCurrentDashboard(ctx);
    if (!item || item.dashboardId !== dashboard.id) {
      throw new Error(`Dashboard item not found. id: ${itemId}`);
    }

    return item;
  }

  private getCurrentPersistedRuntimeIdentity(ctx: IContext) {
    return normalizeCanonicalPersistedRuntimeIdentity(
      toPersistedRuntimeIdentity(ctx.runtimeScope!),
    );
  }

  private async assertExecutableRuntimeScope(ctx: IContext) {
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
  }

  private getKnowledgeBaseReadAuthorizationTarget(ctx: IContext) {
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
  }

  private async assertKnowledgeBaseReadAccess(ctx: IContext) {
    const { actor, resource } =
      this.getKnowledgeBaseReadAuthorizationTarget(ctx);
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.read',
      resource,
    });
  }

  private async recordKnowledgeBaseReadAudit(
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
  ) {
    const { actor, resource } =
      this.getKnowledgeBaseReadAuthorizationTarget(ctx);
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
  }

  private toResponseRuntimeIdentitySource(response: {
    projectId?: number | null;
    deployHash?: string | null;
  }) {
    return {
      projectId: response.projectId ?? null,
      deployHash: response.deployHash ?? null,
    };
  }

  private async resolveScheduleBinding(
    ctx: IContext,
    dashboard: Dashboard,
    runtimeIdentity = this.getCurrentPersistedRuntimeIdentity(ctx),
  ): Promise<{
    workspaceId: string | null;
    knowledgeBaseId: string | null;
    kbSnapshotId: string | null;
    deployHash: string | null;
  }> {
    return resolveDashboardScheduleBinding({
      dashboard,
      runtimeIdentity,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
      knowledgeBaseRepository: ctx.knowledgeBaseRepository,
    });
  }
}
