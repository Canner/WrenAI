import { getLogger } from '@server/utils';
import {
  Dashboard,
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
import { resolveDashboardExecutionContext } from '@server/utils/dashboardRuntime';
import { registerShutdownCallback } from '@server/utils/shutdown';
import { CronExpressionParser } from 'cron-parser';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger('DashboardCacheBackgroundTracker');
logger.level = 'debug';

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  private unregisterShutdown?: () => void;

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
    if (this.pollingIntervalId) {
      return;
    }
    logger.info('Dashboard cache background tracker started');
    this.pollingIntervalId = setInterval(() => {
      this.checkAndRefreshCaches();
    }, this.intervalTime);
    this.unregisterShutdown = registerShutdownCallback(() => this.stop());
  }

  public stop(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
    this.unregisterShutdown?.();
    this.unregisterShutdown = undefined;
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
      logger.error(
        `Error checking dashboard caches: ${getErrorMessage(error)}`,
      );
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

  private async refreshDashboardCache(dashboard: Dashboard): Promise<number> {
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
      const { project, manifest: mdl } = await resolveDashboardExecutionContext(
        {
          dashboard,
          kbSnapshotRepository: this.kbSnapshotRepository,
          projectService: this.projectService,
          deployService: this.deployService,
        },
      );
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
                  errorMessage: getErrorMessage(error),
                },
              );
              logger.debug(
                `Error refreshing cache for item ${item.id}: ${getErrorMessage(error)}`,
              );
              return false;
            }
          } catch (error) {
            logger.debug(
              `Error creating refresh job record for item ${item.id}: ${getErrorMessage(error)}`,
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
        `Error refreshing dashboard ${dashboard.id}: ${getErrorMessage(error)}`,
      );
      return 0;
    } finally {
      this.runningJobs.delete(dashboard.id);
    }
  }

  private calculateNextRunTime(cronExpression: string | null): Date | null {
    if (!cronExpression) {
      return null;
    }

    try {
      const interval = CronExpressionParser.parse(cronExpression, {
        currentDate: new Date(),
      });
      return interval.next().toDate();
    } catch (error) {
      logger.error(
        `Failed to parse cron expression: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }
}
