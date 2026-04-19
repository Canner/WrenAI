import type {
  AuditEventRepository,
  DashboardItemRefreshJobRepository,
  DashboardItemRepository,
  DashboardRepository,
  KBSnapshotRepository,
  ProjectRepository,
  ScheduleJobRepository,
  ScheduleJobRunRepository,
  ThreadRepository,
} from '@server/repositories';
import type { WrenAIAdaptor } from '@server/adaptors';
import type { IDeployService } from '@server/services/deployService';
import type { IProjectService } from '@server/services/projectService';

import { PostHogTelemetry } from './server/telemetry/telemetry';
import type { QueryService } from './server/services';
import {
  DashboardCacheBackgroundTracker,
  ProjectRecommendQuestionBackgroundTracker,
  ScheduleWorker,
  ThreadRecommendQuestionBackgroundTracker,
} from './server/backgrounds';

type BackgroundTrackerDependencies = {
  auditEventRepository: AuditEventRepository;
  dashboardItemRefreshJobRepository: DashboardItemRefreshJobRepository;
  dashboardItemRepository: DashboardItemRepository;
  dashboardRepository: DashboardRepository;
  deployService: IDeployService;
  kbSnapshotRepository: KBSnapshotRepository;
  projectRepository: ProjectRepository;
  projectService: IProjectService;
  queryService: QueryService;
  scheduleJobRepository: ScheduleJobRepository;
  scheduleJobRunRepository: ScheduleJobRunRepository;
  telemetry: PostHogTelemetry;
  threadRepository: ThreadRepository;
  wrenAIAdaptor: WrenAIAdaptor;
};

export const createBackgroundTrackers = ({
  auditEventRepository,
  dashboardItemRefreshJobRepository,
  dashboardItemRepository,
  dashboardRepository,
  deployService,
  kbSnapshotRepository,
  projectRepository,
  projectService,
  queryService,
  scheduleJobRepository,
  scheduleJobRunRepository,
  telemetry,
  threadRepository,
  wrenAIAdaptor,
}: BackgroundTrackerDependencies) => {
  const projectRecommendQuestionBackgroundTracker =
    new ProjectRecommendQuestionBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      projectRepository,
    });
  const threadRecommendQuestionBackgroundTracker =
    new ThreadRecommendQuestionBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      threadRepository,
    });
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
    projectRecommendQuestionBackgroundTracker,
    scheduleWorker,
    threadRecommendQuestionBackgroundTracker,
  };
};
