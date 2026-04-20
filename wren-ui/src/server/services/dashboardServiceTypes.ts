import {
  Dashboard,
  DashboardItem,
  DashboardItemDetail,
  DashboardItemLayout,
  DashboardItemType,
  IDashboardItemRepository,
  IDashboardRepository,
} from '@server/repositories';
import {
  DashboardSchedule,
  SetDashboardCacheData,
} from '@server/models/dashboard';

export interface CreateDashboardItemInput {
  dashboardId: number;
  type: DashboardItemType;
  sql: string;
  chartSchema: DashboardItemDetail['chartSchema'];
  renderHints?: DashboardItemDetail['renderHints'];
  canonicalizationVersion?: DashboardItemDetail['canonicalizationVersion'];
  chartDataProfile?: DashboardItemDetail['chartDataProfile'];
  validationErrors?: DashboardItemDetail['validationErrors'];
  sourceResponseId?: number | null;
  sourceThreadId?: number | null;
  sourceQuestion?: string | null;
}

export interface UpdateDashboardItemInput {
  displayName: string;
}

export interface UpdateDashboardForScopeInput {
  isDefault?: boolean;
  name?: string;
}

export interface DashboardRuntimeBinding {
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  createdBy?: string | null;
}

export type UpdateDashboardItemLayouts = (DashboardItemLayout & {
  itemId: number;
})[];

export interface IDashboardService {
  listDashboardsForScope(
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard[]>;
  getDashboardForScope(
    dashboardId: number,
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard | null>;
  createDashboardForScope(
    input: { name: string },
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard>;
  updateDashboardForScope(
    dashboardId: number,
    input: UpdateDashboardForScopeInput,
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard>;
  deleteDashboardForScope(
    dashboardId: number,
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard>;
  initDashboard(
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard>;
  getCurrentDashboard(bridgeProjectId: number): Promise<Dashboard>;
  getCurrentDashboardForScope(
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard | null>;
  syncDashboardRuntimeBinding(
    dashboardId: number,
    binding: DashboardRuntimeBinding,
  ): Promise<Dashboard>;
  getDashboardItem(dashboardItemId: number): Promise<DashboardItem>;
  getDashboardItems(dashboardId: number): Promise<DashboardItem[]>;
  createDashboardItem(input: CreateDashboardItemInput): Promise<DashboardItem>;
  updateDashboardItem(
    dashboardItemId: number,
    input: UpdateDashboardItemInput,
  ): Promise<DashboardItem>;
  deleteDashboardItem(dashboardItemId: number): Promise<boolean>;
  updateDashboardItemLayouts(
    layouts: UpdateDashboardItemLayouts,
  ): Promise<DashboardItem[]>;
  setDashboardSchedule(
    dashboardId: number,
    data: SetDashboardCacheData,
  ): Promise<Dashboard>;
  parseCronExpression(dashboard: Dashboard): DashboardSchedule;
}

export interface DashboardServiceDependencies {
  dashboardItemRepository: IDashboardItemRepository;
  dashboardRepository: IDashboardRepository;
}
