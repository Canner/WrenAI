import type { DashboardGridItem } from './dashboardGridTypes';

export const DASHBOARD_GRID_GUTTER = 8;
export const DASHBOARD_GRID_COLUMN_COUNT = 6;

export const getLayoutToGrid = (item: DashboardGridItem) => ({
  i: item.id.toString(),
  x: item.layout.x,
  y: item.layout.y,
  w: item.layout.w,
  h: item.layout.h,
});

export const resolveDashboardGridWidth = (containerWidth: number) =>
  Math.max(containerWidth, 0);

export const calculateDashboardGridColumnSize = (gridWidth: number) =>
  (resolveDashboardGridWidth(gridWidth) -
    DASHBOARD_GRID_GUTTER * (DASHBOARD_GRID_COLUMN_COUNT - 1)) /
  DASHBOARD_GRID_COLUMN_COUNT;

export const resolveDashboardGridLayouts = (items: DashboardGridItem[]) =>
  items.map((item) => getLayoutToGrid(item));
