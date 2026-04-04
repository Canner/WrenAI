import { getLogger } from '@server/utils';
import {
  IDashboardRepository,
  IDashboardItemRepository,
  IDashboardItemRefreshJobRepository,
  IKBSnapshotRepository,
  DashboardCacheRefreshStatus,
} from '@server/repositories';
import {
  IProjectService,
  IDeployService,
  IQueryService,
} from '@server/services';
import { resolveDashboardRuntime } from '@server/utils/dashboardRuntime';
import { CronExpressionParser } from 'cron-parser';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger('DashboardCacheBackgroundTracker');
logger.level = 'debug';

export class DashboardCacheBackgroundTracker {
  private intervalTime: number;
  private dashboardRepository: IDashboardRepository;
  private dashboardItemRepository: IDashboardItemRepository;
  private dashboardItemRefreshJobRepository: IDashboardItemRefreshJobRepository;
  private kbSnapshotRepository: IKBSnapshotRepository;
  private projectService: IProjectService;
  private deployService: IDeployService;
  private queryService: IQueryService;
  private runningJobs = new Set<number>();

  constructor({
    dashboardRepository,
    dashboardItemRepository,
    dashboardItemRefreshJobRepository,
    kbSnapshotRepository,
    projectService,
    deployService,
    queryService,
    enablePolling = true,
  }: {
    dashboardRepository: IDashboardRepository;
    dashboardItemRepository: IDashboardItemRepository;
    dashboardItemRefreshJobRepository: IDashboardItemRefreshJobRepository;
    kbSnapshotRepository: IKBSnapshotRepository;
    projectService: IProjectService;
    deployService: IDeployService;
    queryService: IQueryService;
    enablePolling?: boolean;
  }) {
    this.dashboardRepository = dashboardRepository;
    this.dashboardItemRepository = dashboardItemRepository;
    this.dashboardItemRefreshJobRepository = dashboardItemRefreshJobRepository;
    this.kbSnapshotRepository = kbSnapshotRepository;
    this.projectService = projectService;
    this.deployService = deployService;
    this.queryService = queryService;
    this.intervalTime = 60000; // 1 minute
    if (enablePolling) {
      this.start();
    }
  }

  private start(): void {
    logger.info('Dashboard cache background tracker started');
    setInterval(() => {
      this.checkAndRefreshCaches();
    }, this.intervalTime);
  }

  private async checkAndRefreshCaches(): Promise<void> {
    try {
      // Get all dashboards with cache enabled
      const dashboards = await this.dashboardRepository.findAllBy({
        cacheEnabled: true,
      });

      for (const dashboard of dashboards) {
        if (!dashboard.scheduleCron || !dashboard.nextScheduledAt) {
          continue;
        }

        const now = new Date();
        const nextScheduledAt = new Date(dashboard.nextScheduledAt);

        // Check if it's time to refresh
        if (now >= nextScheduledAt) {
          logger.info(`Start Refreshing cache for dashboard ${dashboard.id}`);
          await this.refreshDashboardCache(dashboard);
          logger.info(
            `Finished Refreshing cache for dashboard ${dashboard.id}`,
          );
        }
      }
    } catch (error) {
      logger.error(`Error checking dashboard caches: ${error.message}`);
    }
  }

  public async refreshDashboardById(dashboardId: number): Promise<number> {
    const dashboard = await this.dashboardRepository.findOneBy({
      id: dashboardId,
    });
    if (!dashboard) {
      throw new Error(`Dashboard ${dashboardId} not found`);
    }

    return await this.refreshDashboardCache(dashboard);
  }

  private async refreshDashboardCache(dashboard: any): Promise<number> {
    if (this.runningJobs.has(dashboard.id)) {
      logger.debug(`Dashboard ${dashboard.id} refresh already in progress`);
      return 0;
    }

    this.runningJobs.add(dashboard.id);

    try {
      // Get all items for this dashboard
      const items = await this.dashboardItemRepository.findAllBy({
        dashboardId: dashboard.id,
      });

      // Get project and deployment info
      const runtime = await resolveDashboardRuntime({
        dashboard,
        kbSnapshotRepository: this.kbSnapshotRepository,
      });
      if (!runtime.projectId) {
        throw new Error(
          `Dashboard ${dashboard.id} is missing a project runtime binding`,
        );
      }
      const project = await this.projectService.getProjectById(runtime.projectId);
      const deployment = await this.deployService.getDeployment(
        runtime.projectId,
        runtime.deployHash,
      );
      const mdl = deployment.manifest;
      const hash = uuidv4();

      // Refresh cache for each item
      const refreshResults = await Promise.all(
        items.map(async (item) => {
          try {
            // Create a record for this refresh job
            const refreshJob =
              await this.dashboardItemRefreshJobRepository.createOne({
                hash,
                dashboardId: dashboard.id,
                dashboardItemId: item.id,
                startedAt: new Date(),
                finishedAt: null,
                status: DashboardCacheRefreshStatus.IN_PROGRESS,
                errorMessage: null,
              });

            try {
              await this.queryService.preview(item.detail.sql, {
                project,
                manifest: mdl,
                cacheEnabled: true,
                refresh: true,
              });

              // Update the record with success
              await this.dashboardItemRefreshJobRepository.updateOne(
                refreshJob.id,
                {
                  finishedAt: new Date(),
                  status: DashboardCacheRefreshStatus.SUCCESS,
                },
              );
              return true;
            } catch (error) {
              // Update the record with failure
              await this.dashboardItemRefreshJobRepository.updateOne(
                refreshJob.id,
                {
                  finishedAt: new Date(),
                  status: DashboardCacheRefreshStatus.FAILED,
                  errorMessage: error.message,
                },
              );
              logger.debug(
                `Error refreshing cache for item ${item.id}: ${error.message}`,
              );
              return false;
            }
          } catch (error) {
            logger.debug(
              `Error creating refresh job record for item ${item.id}: ${error.message}`,
            );
            return false;
          }
        }),
      );
      const refreshedItems = refreshResults.filter(Boolean).length;

      // Calculate next scheduled time
      const nextScheduledAt = this.calculateNextRunTime(dashboard.scheduleCron);

      // Update dashboard with new next scheduled time
      await this.dashboardRepository.updateOne(dashboard.id, {
        nextScheduledAt,
      });
      logger.info(
        `Next scheduled time for dashboard ${dashboard.id}: ${nextScheduledAt}`,
      );

      logger.info(`Successfully refreshed cache for dashboard ${dashboard.id}`);
      return refreshedItems;
    } catch (error) {
      logger.error(
        `Error refreshing dashboard ${dashboard.id}: ${error.message}`,
      );
      return 0;
    } finally {
      this.runningJobs.delete(dashboard.id);
    }
  }

  private calculateNextRunTime(cronExpression: string): Date | null {
    try {
      const interval = CronExpressionParser.parse(cronExpression, {
        currentDate: new Date(),
      });
      return interval.next().toDate();
    } catch (error) {
      logger.error(`Failed to parse cron expression: ${error.message}`);
      return null;
    }
  }
}
