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
import { Manifest } from '@server/mdl/type';

const logger = getLogger('DashboardResolver');
logger.level = 'debug';
const DASHBOARD_SNAPSHOT_TIMEOUT_MS = 5000;
const DASHBOARD_PREVIEW_TIMEOUT_MS = 15000;

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
    const { responseId } = args.data;
    const itemType = this.normalizeDashboardItemType(args.data.itemType);
    const dashboard = await ctx.dashboardService.getCurrentDashboard();
    const response = await ctx.askingService.getResponse(responseId);

    if (!response) {
      throw new Error(`Thread response not found. responseId: ${responseId}`);
    }
    if (!itemType) {
      throw new Error(`Chart type not supported. responseId: ${responseId}`);
    }
    if (!response.chartDetail?.chartSchema) {
      throw new Error(
        `Chart schema not found in thread response. responseId: ${responseId}`,
      );
    }
    if (!response.sql) {
      throw new Error(`Chart SQL not found in thread response. responseId: ${responseId}`);
    }

    const previewDataSnapshot = await this.capturePreviewSnapshot(
      ctx,
      response.sql,
    );

    const dashboardItem = await ctx.dashboardService.createDashboardItem({
      dashboardId: dashboard.id,
      type: itemType,
      sql: response.sql,
      chartSchema: response.chartDetail?.chartSchema,
      previewDataSnapshot,
    });

    // Warm dashboard cache asynchronously so datasource latency does not block pinning.
    void this.warmDashboardCache(ctx, response.sql, dashboardItem.id);

    return dashboardItem;
  }

  private normalizeDashboardItemType(
    itemType: DashboardItemType | ChartType | string,
  ): DashboardItemType | null {
    const rawValue = String(itemType || '');
    const normalizedKey = rawValue.toUpperCase() as keyof typeof DashboardItemType;
    const normalizedValue = DashboardItemType[normalizedKey];
    if (normalizedValue) {
      return normalizedValue;
    }

    const chartTypeValue = Object.values(ChartType).find(
      (value) => value === rawValue,
    );
    if (!chartTypeValue) {
      return null;
    }

    return (
      DashboardItemType[
        chartTypeValue.toUpperCase() as keyof typeof DashboardItemType
      ] || null
    );
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
      const manifest = await this.getPreviewManifest(ctx, project.id);

      try {
        const data = (await this.withTimeout(
          ctx.queryService.preview(item.detail.sql, {
            project,
            manifest,
            limit: limit || DEFAULT_PREVIEW_LIMIT,
            cacheEnabled,
            refresh: refresh || false,
          }),
          DASHBOARD_PREVIEW_TIMEOUT_MS,
          `Dashboard preview timed out for item ${itemId}`,
        )) as PreviewDataResponse;

        return this.formatPreviewItemResponse(data);
      } catch (error) {
        const snapshot = item.detail.previewDataSnapshot;
        if (snapshot?.length) {
          logger.warn(
            `Using stored dashboard preview snapshot for item ${itemId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return {
            cacheHit: false,
            cacheCreatedAt: null,
            cacheOverrodeAt: null,
            override: false,
            data: snapshot,
          } as PreviewItemResponse;
        }
        throw error;
      }
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

  private async capturePreviewSnapshot(
    ctx: IContext,
    sql: string,
  ): Promise<Record<string, any>[] | undefined> {
    try {
      const project = await ctx.projectService.getCurrentProject();
      const manifest = await this.getPreviewManifest(ctx, project.id);
      const data = (await this.withTimeout(
        ctx.queryService.preview(sql, {
          project,
          manifest,
          limit: DEFAULT_PREVIEW_LIMIT,
          cacheEnabled: false,
          refresh: false,
        }),
        DASHBOARD_SNAPSHOT_TIMEOUT_MS,
        'Dashboard snapshot preview timed out',
      )) as PreviewDataResponse;

      return this.formatPreviewItemResponse(data).data;
    } catch (error) {
      logger.warn(
        `Failed to capture dashboard preview snapshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private async warmDashboardCache(
    ctx: IContext,
    sql: string,
    dashboardItemId: number,
  ): Promise<void> {
    try {
      const project = await ctx.projectService.getCurrentProject();
      const manifest = await this.getPreviewManifest(ctx, project.id);
      await this.withTimeout(
        ctx.queryService.preview(sql, {
          project,
          manifest,
          limit: DEFAULT_PREVIEW_LIMIT,
          cacheEnabled: true,
          refresh: true,
        }),
        DASHBOARD_PREVIEW_TIMEOUT_MS,
        `Dashboard cache warm-up timed out for item ${dashboardItemId}`,
      );
    } catch (error) {
      logger.warn(
        `Dashboard item ${dashboardItemId} was pinned but cache warm-up failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async getPreviewManifest(
    ctx: IContext,
    projectId: number,
  ): Promise<Manifest> {
    const deployment = await ctx.deployService.getLastDeployment(projectId);
    if (deployment?.manifest) {
      return deployment.manifest as Manifest;
    }

    const { manifest } = await ctx.mdlService.makeCurrentModelMDL();
    return manifest;
  }

  private formatPreviewItemResponse(data: PreviewDataResponse): PreviewItemResponse {
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
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(timeoutMessage)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
