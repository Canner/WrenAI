import { DashboardResolver } from '../dashboardResolver';

describe('DashboardResolver scope guards', () => {
  const createContext = () =>
    ({
      runtimeScope: {
        project: { id: 1 },
      },
      dashboardService: {
        getCurrentDashboard: jest.fn(),
        getDashboardItem: jest.fn(),
        updateDashboardItem: jest.fn(),
        deleteDashboardItem: jest.fn(),
        updateDashboardItemLayouts: jest.fn(),
      },
      queryService: {
        preview: jest.fn(),
      },
      projectService: {
        getProjectById: jest.fn(),
      },
      deployService: {
        getLastDeployment: jest.fn(),
      },
    }) as any;

  it('rejects updateDashboardItem for items outside the active dashboard', async () => {
    const resolver = new DashboardResolver();
    const ctx = createContext();
    ctx.dashboardService.getCurrentDashboard.mockResolvedValue({
      id: 1,
      projectId: 1,
    });
    ctx.dashboardService.getDashboardItem.mockResolvedValue({
      id: 9,
      dashboardId: 2,
    });

    await expect(
      resolver.updateDashboardItem(
        null,
        { where: { id: 9 }, data: { displayName: 'Revenue' } },
        ctx,
      ),
    ).rejects.toThrow('Dashboard item not found. id: 9');

    expect(ctx.dashboardService.updateDashboardItem).not.toHaveBeenCalled();
  });

  it('rejects updateDashboardItemLayouts when any item is outside the active dashboard', async () => {
    const resolver = new DashboardResolver();
    const ctx = createContext();
    ctx.dashboardService.getCurrentDashboard.mockResolvedValue({
      id: 1,
      projectId: 1,
    });
    ctx.dashboardService.getDashboardItem.mockImplementation(async (id: number) =>
      id === 1 ? { id, dashboardId: 1 } : { id, dashboardId: 2 },
    );

    await expect(
      resolver.updateDashboardItemLayouts(
        null,
        {
          data: {
            layouts: [
              { itemId: 1, x: 0, y: 0, w: 4, h: 4 },
              { itemId: 2, x: 4, y: 0, w: 4, h: 4 },
            ],
          },
        },
        ctx,
      ),
    ).rejects.toThrow('Dashboard item not found. id: 2');

    expect(ctx.dashboardService.updateDashboardItemLayouts).not.toHaveBeenCalled();
  });

  it('rejects previewItemSQL for items outside the active dashboard', async () => {
    const resolver = new DashboardResolver();
    const ctx = createContext();
    ctx.dashboardService.getCurrentDashboard.mockResolvedValue({
      id: 1,
      projectId: 1,
      cacheEnabled: true,
    });
    ctx.dashboardService.getDashboardItem.mockResolvedValue({
      id: 5,
      dashboardId: 7,
      detail: { sql: 'select 1' },
    });

    await expect(
      resolver.previewItemSQL(
        null,
        { data: { itemId: 5, limit: 10, refresh: false } },
        ctx,
      ),
    ).rejects.toThrow('Dashboard item not found. id: 5');

    expect(ctx.queryService.preview).not.toHaveBeenCalled();
  });
});
