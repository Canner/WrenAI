import {
  IDashboardRepository,
  IDashboardItemRepository,
  Dashboard,
  DashboardItem,
  DashboardItemType,
  DashboardItemDetail,
  DashboardItemLayout,
} from '@server/repositories';
import { getLogger } from '@server/utils';
import { IProjectService } from './projectService';

const logger = getLogger('DashboardService');
logger.level = 'debug';

export interface CreateDashboardItemInput {
  dashboardId: number;
  type: DashboardItemType;
  sql: string;
  chartSchema: DashboardItemDetail['chartSchema'];
}

export type UpdateDashboardItemLayouts = (DashboardItemLayout & {
  itemId: number;
})[];

export interface IDashboardService {
  initDashboard(): Promise<Dashboard>;
  getCurrentDashboard(): Promise<Dashboard>;
  getDashboardItem(dashboardItemId: number): Promise<DashboardItem>;
  getDashboardItems(dashboardId: number): Promise<DashboardItem[]>;
  createDashboardItem(input: CreateDashboardItemInput): Promise<DashboardItem>;
  deleteDashboardItem(dashboardItemId: number): Promise<boolean>;
  updateDashboardItemLayouts(
    layouts: UpdateDashboardItemLayouts,
  ): Promise<DashboardItem[]>;
}

export class DashboardService implements IDashboardService {
  private projectService: IProjectService;
  private dashboardItemRepository: IDashboardItemRepository;
  private dashboardRepository: IDashboardRepository;

  constructor({
    projectService,
    dashboardItemRepository,
    dashboardRepository,
  }: {
    projectService: IProjectService;
    dashboardItemRepository: IDashboardItemRepository;
    dashboardRepository: IDashboardRepository;
  }) {
    this.projectService = projectService;
    this.dashboardItemRepository = dashboardItemRepository;
    this.dashboardRepository = dashboardRepository;
  }

  public async initDashboard(): Promise<Dashboard> {
    const project = await this.projectService.getCurrentProject();
    const existingDashboard = await this.dashboardRepository.findOneBy({
      projectId: project.id,
    });
    if (existingDashboard) return existingDashboard;
    // only support one dashboard for oss
    return await this.dashboardRepository.createOne({
      name: 'Dashboard',
      projectId: project.id,
    });
  }

  public async getCurrentDashboard(): Promise<Dashboard> {
    const project = await this.projectService.getCurrentProject();
    const dashboard = await this.dashboardRepository.findOneBy({
      projectId: project.id,
    });
    if (!dashboard) {
      throw new Error('Dashboard not found.');
    }
    return dashboard;
  }

  public async getDashboardItem(
    dashboardItemId: number,
  ): Promise<DashboardItem> {
    const item = await this.dashboardItemRepository.findOneBy({
      id: dashboardItemId,
    });
    if (!item) {
      throw new Error('Dashboard item not found.');
    }
    return item;
  }

  public async getDashboardItems(
    dashboardId: number,
  ): Promise<DashboardItem[]> {
    return await this.dashboardItemRepository.findAllBy({
      dashboardId,
    });
  }

  public async createDashboardItem(
    input: CreateDashboardItemInput,
  ): Promise<DashboardItem> {
    const layout = await this.calculateNewLayout(input.dashboardId);
    return await this.dashboardItemRepository.createOne({
      dashboardId: input.dashboardId,
      type: input.type,
      detail: {
        sql: input.sql,
        chartSchema: input.chartSchema,
      },
      layout,
    });
  }

  public async updateDashboardItemLayouts(
    layouts: UpdateDashboardItemLayouts,
  ): Promise<DashboardItem[]> {
    const updatedItems: DashboardItem[] = [];
    const isValidLayouts = layouts.every(
      (layout) =>
        layout.itemId &&
        layout.x >= 0 &&
        layout.y >= 0 &&
        layout.w > 0 &&
        layout.h > 0,
    );
    if (!isValidLayouts) {
      throw new Error('Invalid layouts boundaries.');
    }
    await Promise.all(
      layouts.map(async (layout) => {
        const updatedItem = await this.dashboardItemRepository.updateOne(
          layout.itemId,
          {
            layout: {
              x: layout.x,
              y: layout.y,
              w: layout.w,
              h: layout.h,
            },
          },
        );
        updatedItems.push(updatedItem);
      }),
    );
    return updatedItems;
  }

  public async deleteDashboardItem(dashboardItemId: number): Promise<boolean> {
    await this.dashboardItemRepository.deleteOne(dashboardItemId);
    return true;
  }

  private async calculateNewLayout(
    dashboardId: number,
  ): Promise<DashboardItemLayout> {
    const dashboardItems = await this.dashboardItemRepository.findAllBy({
      dashboardId,
    });
    const allLayouts = dashboardItems.map((item) => item.layout);
    if (allLayouts.length === 0) return { x: 0, y: 0, w: 3, h: 2 };

    const columnCount = 6;
    const halfLayoutX = columnCount / 2;
    // the current max y is the current row
    const maxY = Math.max(...allLayouts.map((layout) => layout.y));

    const latestLayout = allLayouts.filter((layout) => layout.y === maxY);
    const isNextRow =
      latestLayout.reduce((acc, layout) => acc + layout.x + layout.w, 0) >
      halfLayoutX;

    const x = isNextRow ? 0 : halfLayoutX;
    const y = isNextRow ? maxY + 2 : maxY;
    return { x, y, w: 3, h: 2 };
  }
}
