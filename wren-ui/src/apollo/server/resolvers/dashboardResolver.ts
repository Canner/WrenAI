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
import { resolveDashboardRuntime } from '@server/utils/dashboardRuntime';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  SetDashboardCacheData,
  DashboardSchedule,
  PreviewItemResponse,
} from '@server/models/dashboard';

const logger = getLogger('DashboardResolver');
logger.level = 'debug';

export class DashboardResolver {
  constructor() {
    this.getDashboard = this.getDashboard.bind(this);
    this.getDashboardItems = this.getDashboardItems.bind(this);
    this.createDashboardItem = this.createDashboardItem.bind(this);
    this.updateDashboardItem = this.updateDashboardItem.bind(this);
    this.deleteDashboardItem = this.deleteDashboardItem.bind(this);
    this.updateDashboardItemLayouts =
      this.updateDashboardItemLayouts.bind(this);
    this.previewItemSQL = this.previewItemSQL.bind(this);
    this.setDashboardSchedule = this.setDashboardSchedule.bind(this);
  }

  public async getDashboard(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<
    Omit<Dashboard, 'nextScheduledAt'> & {
      schedule: DashboardSchedule;
      items: DashboardItem[];
      nextScheduledAt: string | null;
    }
  > {
    const dashboard = await ctx.dashboardService.getCurrentDashboardForScope(
      ctx.runtimeScope!.project.id,
      this.getRuntimeBinding(ctx),
    );
    if (!dashboard) {
      throw new Error('Dashboard not found.');
    }
    const schedule = ctx.dashboardService.parseCronExpression(dashboard);
    const items = await ctx.dashboardService.getDashboardItems(dashboard.id);
    return {
      ...dashboard,
      nextScheduledAt: dashboard.nextScheduledAt
        ? new Date(dashboard.nextScheduledAt).toISOString()
        : null,
      schedule,
      items,
    };
  }

  public async getDashboardItems(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<DashboardItem[]> {
    const dashboard = await ctx.dashboardService.getCurrentDashboardForScope(
      ctx.runtimeScope!.project.id,
      this.getRuntimeBinding(ctx),
    );
    if (!dashboard) {
      throw new Error('Dashboard not found.');
    }
    return await ctx.dashboardService.getDashboardItems(dashboard.id);
  }

  public async createDashboardItem(
    _root: any,
    args: { data: { itemType: DashboardItemType; responseId: number } },
    ctx: IContext,
  ): Promise<DashboardItem> {
    const { responseId, itemType } = args.data;
    const dashboard = await ctx.dashboardService.getCurrentDashboardForScope(
      ctx.runtimeScope!.project.id,
      this.getRuntimeBinding(ctx),
    );
    await ctx.askingService.assertResponseScope(
      responseId,
      toPersistedRuntimeIdentity(ctx.runtimeScope!),
    );
    const response = await ctx.askingService.getResponseScoped(
      responseId,
      toPersistedRuntimeIdentity(ctx.runtimeScope!),
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

    // query with cache enabled
    const runtime = await resolveDashboardRuntime({
      dashboard,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
    });
    if (!runtime.projectId) {
      throw new Error(`Dashboard ${dashboard.id} is missing a project binding`);
    }
    const project = await ctx.projectService.getProjectById(runtime.projectId);
    const deployment = await ctx.deployService.getDeployment(
      response.projectId || runtime.projectId,
      response.deployHash || runtime.deployHash,
    );
    const mdl = deployment.manifest;
    await ctx.queryService.preview(response.sql, {
      project,
      manifest: mdl,
      limit: DEFAULT_PREVIEW_LIMIT,
      cacheEnabled: true,
      refresh: true,
    });

    return await ctx.dashboardService.createDashboardItem({
      dashboardId: dashboard.id,
      type: itemType,
      sql: response.sql,
      chartSchema: response.chartDetail?.chartSchema,
    });
  }

  public async updateDashboardItem(
    _root: any,
    args: { where: { id: number }; data: { displayName: string } },
    ctx: IContext,
  ): Promise<DashboardItem> {
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
    const { id } = args.where;
    await this.ensureDashboardItemScope(ctx, id);
    return await ctx.dashboardService.deleteDashboardItem(id);
  }

  public async updateDashboardItemLayouts(
    _root: any,
    args: { data: { layouts: UpdateDashboardItemLayouts } },
    ctx: IContext,
  ): Promise<DashboardItem[]> {
    const { layouts } = args.data;
    if (layouts.length === 0) {
      throw new Error('Layouts are required.');
    }
    await Promise.all(
      layouts.map((layout) => this.ensureDashboardItemScope(ctx, layout.itemId)),
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
      const item = await this.ensureDashboardItemScope(ctx, itemId);
      const dashboard = await this.ensureCurrentDashboard(ctx);
      const { cacheEnabled } = dashboard;
      const runtime = await resolveDashboardRuntime({
        dashboard,
        kbSnapshotRepository: ctx.kbSnapshotRepository,
      });
      if (!runtime.projectId) {
        throw new Error(
          `Dashboard ${dashboard.id} is missing a project runtime binding`,
        );
      }
      const project = await ctx.projectService.getProjectById(runtime.projectId);
      const deployment = await ctx.deployService.getDeployment(
        runtime.projectId,
        runtime.deployHash,
      );
      const mdl = deployment.manifest;
      const data = (await ctx.queryService.preview(item.detail.sql, {
        project,
        manifest: mdl,
        limit: limit || DEFAULT_PREVIEW_LIMIT,
        cacheEnabled,
        refresh: refresh || false,
      })) as PreviewDataResponse;

      // handle data to [{ column1: value1, column2: value2, ... }]
      const values = data.data.map((val) => {
        return data.columns.reduce((acc, col, index) => {
          acc[col.name] = val[index];
          return acc;
        }, {});
      });
      return {
        cacheHit: data.cacheHit || false,
        cacheCreatedAt: data.cacheCreatedAt || null,
        cacheOverrodeAt: data.cacheOverrodeAt || null,
        override: data.override || false,
        data: values,
      } as PreviewItemResponse;
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
      const dashboard = await ctx.dashboardService.getCurrentDashboardForScope(
        ctx.runtimeScope!.project.id,
        this.getRuntimeBinding(ctx),
      );
      if (!dashboard) {
        throw new Error('Dashboard not found.');
      }

      const updatedDashboard = await ctx.dashboardService.setDashboardSchedule(
        dashboard.id,
        args.data,
      );
      const scheduleBinding = await this.resolveScheduleBinding(
        ctx,
        updatedDashboard,
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
        createdBy: ctx.runtimeScope?.userId,
      });

      return updatedDashboard;
    } catch (error) {
      logger.error(`Failed to set dashboard schedule: ${error.message}`);
      throw error;
    }
  }

  private async ensureCurrentDashboard(ctx: IContext): Promise<Dashboard> {
    const dashboard = await ctx.dashboardService.getCurrentDashboardForScope(
      ctx.runtimeScope!.project.id,
      this.getRuntimeBinding(ctx),
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

  private getRuntimeBinding(ctx: IContext) {
    return {
      knowledgeBaseId: ctx.runtimeScope?.knowledgeBase?.id || null,
      kbSnapshotId: ctx.runtimeScope?.kbSnapshot?.id || null,
      deployHash: ctx.runtimeScope?.deployHash || null,
      createdBy: ctx.runtimeScope?.userId || null,
    };
  }

  private async resolveScheduleBinding(
    ctx: IContext,
    dashboard: Dashboard,
  ): Promise<{
    workspaceId: string | null;
    knowledgeBaseId: string | null;
    kbSnapshotId: string | null;
    deployHash: string | null;
  }> {
    const knowledgeBaseId =
      dashboard.knowledgeBaseId || ctx.runtimeScope?.knowledgeBase?.id || null;
    const kbSnapshotId =
      dashboard.kbSnapshotId || ctx.runtimeScope?.kbSnapshot?.id || null;
    const deployHash = dashboard.deployHash || ctx.runtimeScope?.deployHash || null;

    let workspaceId = ctx.runtimeScope?.workspace?.id || null;
    if (
      knowledgeBaseId &&
      knowledgeBaseId !== ctx.runtimeScope?.knowledgeBase?.id
    ) {
      const knowledgeBase = await ctx.knowledgeBaseRepository.findOneBy({
        id: knowledgeBaseId,
      });
      workspaceId = knowledgeBase?.workspaceId || workspaceId;
    }

    return {
      workspaceId,
      knowledgeBaseId,
      kbSnapshotId,
      deployHash,
    };
  }
}
