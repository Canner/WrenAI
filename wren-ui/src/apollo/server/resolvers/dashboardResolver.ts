import { IContext } from '@server/types';
import { ChartType } from '@server/models/adaptor';
import {
  UpdateDashboardItemLayouts,
  PreviewDataResponse,
  DEFAULT_PREVIEW_LIMIT,
} from '@server/services';
import { DashboardItem, DashboardItemType } from '@server/repositories';
import { getLogger } from '@server/utils';

const logger = getLogger('DashboardResolver');
logger.level = 'debug';

export class DashboardResolver {
  constructor() {
    this.getDashboardItems = this.getDashboardItems.bind(this);
    this.createDashboardItem = this.createDashboardItem.bind(this);
    this.deleteDashboardItem = this.deleteDashboardItem.bind(this);
    this.updateDashboardItemLayouts =
      this.updateDashboardItemLayouts.bind(this);
    this.previewItemSQL = this.previewItemSQL.bind(this);
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

    return await ctx.dashboardService.createDashboardItem({
      dashboardId: dashboard.id,
      type: itemType,
      sql: response.sql,
      chartSchema: response.chartDetail?.chartSchema,
    });
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
    args: { data: { itemId: number; limit?: number } },
    ctx: IContext,
  ): Promise<Record<string, any>[]> {
    const { itemId, limit } = args.data;
    try {
      const item = await ctx.dashboardService.getDashboardItem(itemId);
      const project = await ctx.projectService.getCurrentProject();
      const deployment = await ctx.deployService.getLastDeployment(project.id);
      const mdl = deployment.manifest;
      const data = (await ctx.queryService.preview(item.detail.sql, {
        project,
        manifest: mdl,
        limit: limit || DEFAULT_PREVIEW_LIMIT,
      })) as PreviewDataResponse;

      // handle data to [{ column1: value1, column2: value2, ... }]
      const values = data.data.map((val) => {
        return data.columns.reduce((acc, col, index) => {
          acc[col.name] = val[index];
          return acc;
        }, {});
      });
      return values;
    } catch (error) {
      logger.error(`Error previewing SQL item ${itemId}: ${error}`);
      throw error;
    }
  }
}
