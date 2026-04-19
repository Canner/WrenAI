import type { DashboardGridItemData } from '@/utils/dashboardRest';

export type DashboardGridItem = DashboardGridItemData;

export interface DashboardGridPinnedItemHandle {
  onRefresh: () => void;
}
