import {
  calculateDashboardGridColumnSize,
  resolveDashboardGridLayouts,
  resolveDashboardGridWidth,
} from './dashboardGridLayout';

describe('dashboard grid layout helpers', () => {
  it('uses the available container width directly instead of forcing a desktop minimum width', () => {
    expect(resolveDashboardGridWidth(712)).toBe(712);
    expect(resolveDashboardGridWidth(0)).toBe(0);
  });

  it('derives column size from the measured grid width', () => {
    expect(calculateDashboardGridColumnSize(712)).toBeCloseTo(112);
  });

  it('preserves stored layout for a single dashboard item', () => {
    expect(
      resolveDashboardGridLayouts([
        {
          id: 8,
          dashboardId: 75,
          type: 'BAR',
          displayName: '图表卡片 8',
          layout: { x: 0, y: 0, w: 3, h: 2 },
          detail: {
            sql: 'select 1',
          },
        } as any,
      ]),
    ).toEqual([
      {
        i: '8',
        x: 0,
        y: 0,
        w: 3,
        h: 2,
      },
    ]);
  });
});
