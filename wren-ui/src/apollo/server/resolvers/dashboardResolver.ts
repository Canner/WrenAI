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
    const dashboard = await ctx.dashboardService.getCurrentDashboard();
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
    const dashboard = await ctx.dashboardService.getCurrentDashboard();
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
    const dashboard = await ctx.dashboardService.getCurrentDashboard();
    const response = await ctx.askingService.getResponse(responseId);

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
    const project = await ctx.projectService.getCurrentProject();
    const deployment = await ctx.deployService.getLastDeployment(project.id);
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
    const item = await ctx.dashboardService.getDashboardItem(id);
    if (!item) {
      throw new Error(`Dashboard item not found. id: ${id}`);
    }
    return await ctx.dashboardService.updateDashboardItem(id, { displayName });
  }

  public async deleteDashboardItem(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ): Promise<boolean> {
    const { id } = args.where;
    const item = await ctx.dashboardService.getDashboardItem(id);
    if (!item) {
      throw new Error(`Dashboard item not found. id: ${id}`);
    }
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
    return await ctx.dashboardService.updateDashboardItemLayouts(layouts);
  }

  public async previewItemSQL(
    _root: any,
    args: { data: { itemId: number; limit?: number; refresh?: boolean } },
    ctx: IContext,
  ): Promise<PreviewItemResponse> {
    const { itemId, limit, refresh } = args.data;
    try {
      const item = await ctx.dashboardService.getDashboardItem(itemId);
      const { cacheEnabled } = await ctx.dashboardService.getCurrentDashboard();
      const project = await ctx.projectService.getCurrentProject();
      const deployment = await ctx.deployService.getLastDeployment(project.id);
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
      const dashboard = await ctx.dashboardService.getCurrentDashboard();
      if (!dashboard) {
        throw new Error('Dashboard not found.');
      }

      return await ctx.dashboardService.setDashboardSchedule(
        dashboard.id,
        args.data,
      );
    } catch (error) {
      logger.error(`Failed to set dashboard schedule: ${error.message}`);
      throw error;
    }
  }
}
