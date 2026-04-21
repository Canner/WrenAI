import {
  createDashboardServiceHarness,
  TestDashboardService,
} from './dashboardService.testSupport';

describe('DashboardService', () => {
  let dashboardService: TestDashboardService;
  let mockDashboardItemRepository: ReturnType<
    typeof createDashboardServiceHarness
  >['mockDashboardItemRepository'];

  beforeEach(() => {
    ({ dashboardService, mockDashboardItemRepository } =
      createDashboardServiceHarness());
  });

  it('returns existing dashboard item when the same source response is pinned twice', async () => {
    mockDashboardItemRepository.findByDashboardIdAndSourceResponseId.mockResolvedValue(
      {
        id: 88,
        dashboardId: 7,
        type: 'BAR',
        detail: {
          sql: 'select 1',
          sourceResponseId: 62,
        },
        layout: { x: 0, y: 0, w: 3, h: 4 },
      },
    );

    const result = await dashboardService.createDashboardItem({
      dashboardId: 7,
      type: 'BAR' as any,
      sql: 'select 1',
      chartSchema: { mark: 'bar' },
      sourceResponseId: 62,
      sourceThreadId: 50,
      sourceQuestion: '统计 990001 平台下各渠道的折扣比例，并生成柱状图',
    });

    expect(
      mockDashboardItemRepository.findByDashboardIdAndSourceResponseId,
    ).toHaveBeenCalledWith(7, 62);
    expect(mockDashboardItemRepository.createOne).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 88,
        dashboardId: 7,
      }),
    );
  });
});
