import type {
  AuditEventRepository,
  DashboardItemRefreshJobRepository,
  DashboardItemRepository,
  DashboardRepository,
  KBSnapshotRepository,
  ScheduleJobRepository,
  ScheduleJobRunRepository,
} from '@server/repositories';
import type { IDeployService } from '@server/services/deployService';
import type { IProjectService } from '@server/services/projectService';

import type { QueryService } from './server/services';
import {
  DashboardCacheBackgroundTracker,
  ScheduleWorker,
} from './server/backgrounds';

type BackgroundTrackerDependencies = {
  auditEventRepository: AuditEventRepository;
  dashboardItemRefreshJobRepository: DashboardItemRefreshJobRepository;
  dashboardItemRepository: DashboardItemRepository;
  dashboardRepository: DashboardRepository;
  deployService: IDeployService;
  kbSnapshotRepository: KBSnapshotRepository;
  projectService: IProjectService;
  queryService: QueryService;
  scheduleJobRepository: ScheduleJobRepository;
  scheduleJobRunRepository: ScheduleJobRunRepository;
};

export const createBackgroundTrackers = ({
  auditEventRepository,
  dashboardItemRefreshJobRepository,
  dashboardItemRepository,
  dashboardRepository,
  deployService,
  kbSnapshotRepository,
  projectService,
  queryService,
  scheduleJobRepository,
  scheduleJobRunRepository,
}: BackgroundTrackerDependencies) => {
  const dashboardCacheBackgroundTracker = new DashboardCacheBackgroundTracker({
    dashboardRepository,
    dashboardItemRepository,
    dashboardItemRefreshJobRepository,
    kbSnapshotRepository,
    projectService,
    deployService,
    queryService,
    enablePolling: false,
  });
  const scheduleWorker = new ScheduleWorker({
    scheduleJobRepository,
    scheduleJobRunRepository,
    auditEventRepository,
    executors: {
      dashboard_refresh: async (job) => {
        const dashboardId = Number.parseInt(job.targetId, 10);
        if (Number.isNaN(dashboardId)) {
          throw new Error(
            `Invalid dashboard refresh target id: ${job.targetId}`,
          );
        }

        const refreshedItems =
          await dashboardCacheBackgroundTracker.refreshDashboardById(
            dashboardId,
          );

        return {
          detailJson: {
            refreshedItems,
          },
        };
      },
    },
  });

  return {
    dashboardCacheBackgroundTracker,
    scheduleWorker,
  };
};
