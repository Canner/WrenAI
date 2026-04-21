import { Dashboard, DashboardItem } from '@server/repositories';
import { getLogger } from '@server/utils';
import {
  DashboardSchedule,
  SetDashboardCacheData,
  ScheduleFrequencyEnum,
} from '@server/models/dashboard';
import {
  calculateDashboardNewLayout,
  calculateDashboardNextRunTime,
  buildDashboardRuntimeBindingPatch,
  createScopedDashboard,
  findProjectDashboardByProjectBridge,
  findUnboundProjectDashboard,
  generateDashboardCronExpression,
  parseDashboardCronExpression,
  resolveDefaultDashboard,
  sortDashboardsForScope,
  toDashboardTimezoneSchedule,
  toUtcDashboardSchedule,
  validateDashboardScheduleInput,
} from './dashboardServiceSupport';
import {
  CreateDashboardItemInput,
  DashboardRuntimeBinding,
  DashboardServiceDependencies,
  IDashboardService,
  UpdateDashboardForScopeInput,
  UpdateDashboardItemInput,
  UpdateDashboardItemLayouts,
} from './dashboardServiceTypes';

export type {
  CreateDashboardItemInput,
  DashboardRuntimeBinding,
  DashboardServiceDependencies,
  IDashboardService,
  UpdateDashboardForScopeInput,
  UpdateDashboardItemInput,
  UpdateDashboardItemLayouts,
} from './dashboardServiceTypes';

const logger = getLogger('DashboardService');
logger.level = 'debug';

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export class DashboardService implements IDashboardService {
  private dashboardItemRepository: DashboardServiceDependencies['dashboardItemRepository'];
  private dashboardRepository: DashboardServiceDependencies['dashboardRepository'];

  constructor({
    dashboardItemRepository,
    dashboardRepository,
  }: DashboardServiceDependencies) {
    this.dashboardItemRepository = dashboardItemRepository;
    this.dashboardRepository = dashboardRepository;
  }

  public async setDashboardSchedule(
    dashboardId: number,
    data: SetDashboardCacheData,
  ): Promise<Dashboard> {
    try {
      const { cacheEnabled, schedule } = data;
      validateDashboardScheduleInput(data);

      const dashboard = await this.dashboardRepository.findOneBy({
        id: dashboardId,
      });
      if (!dashboard) {
        throw new Error(`Dashboard with id ${dashboardId} not found`);
      }
      if (!cacheEnabled || !schedule) {
        return await this.dashboardRepository.updateOne(dashboardId, {
          cacheEnabled: false,
          scheduleFrequency: null,
          scheduleTimezone: null,
          scheduleCron: null,
          nextScheduledAt: null,
        });
      }

      let cronExpression: string | null = null;
      let nextScheduledAt: Date | null = null;

      if (schedule.frequency !== ScheduleFrequencyEnum.NEVER) {
        cronExpression = generateDashboardCronExpression(schedule);
        nextScheduledAt = cronExpression
          ? calculateDashboardNextRunTime(cronExpression)
          : null;
      }

      return await this.dashboardRepository.updateOne(dashboardId, {
        cacheEnabled,
        scheduleFrequency: schedule.frequency,
        scheduleTimezone: schedule.timezone,
        scheduleCron: cronExpression,
        nextScheduledAt,
      });
    } catch (error: unknown) {
      logger.error(
        `Failed to set dashboard schedule: ${toErrorMessage(error)}`,
      );
      throw error;
    }
  }

  public async initDashboard(
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard> {
    const scopedKnowledgeBaseId = binding?.knowledgeBaseId || null;
    if (scopedKnowledgeBaseId) {
      const scopedDashboards = await this.dashboardRepository.findAllBy({
        knowledgeBaseId: scopedKnowledgeBaseId,
      });
      const scopedDashboard = resolveDefaultDashboard(scopedDashboards);
      if (scopedDashboard) {
        return await this.syncDashboardRuntimeBinding(
          scopedDashboard.id,
          binding || {},
        );
      }
    }

    if (bridgeProjectId != null) {
      const projectDashboard = binding
        ? await findUnboundProjectDashboard(
            this.dashboardRepository,
            bridgeProjectId,
          )
        : await findProjectDashboardByProjectBridge(
            this.dashboardRepository,
            bridgeProjectId,
          );
      if (projectDashboard) {
        return binding
          ? await this.syncDashboardRuntimeBinding(projectDashboard.id, binding)
          : projectDashboard;
      }
    }

    return await createScopedDashboard(this.dashboardRepository, {
      bridgeProjectId,
      binding,
      isDefault: true,
    });
  }

  public async listDashboardsForScope(
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard[]> {
    const scopedKnowledgeBaseId = binding?.knowledgeBaseId || null;
    let dashboards: Dashboard[] = [];

    if (scopedKnowledgeBaseId != null) {
      dashboards = await this.dashboardRepository.findAllBy({
        knowledgeBaseId: scopedKnowledgeBaseId,
      });
      if (dashboards.length === 0) {
        const fallbackDashboard = await this.getCurrentDashboardForScope(
          bridgeProjectId,
          binding,
        );
        dashboards = fallbackDashboard ? [fallbackDashboard] : [];
      }
    } else if (bridgeProjectId != null) {
      dashboards = await this.dashboardRepository.findAllBy({
        projectId: bridgeProjectId,
      });
    }

    if (dashboards.length === 0) {
      return [await this.initDashboard(bridgeProjectId, binding)];
    }

    return sortDashboardsForScope(dashboards);
  }

  public async getDashboardForScope(
    dashboardId: number,
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard | null> {
    const dashboards = await this.listDashboardsForScope(
      bridgeProjectId,
      binding,
    );
    const matched = dashboards.find(
      (dashboard) => dashboard.id === dashboardId,
    );
    if (!matched) {
      return null;
    }

    return binding
      ? await this.syncDashboardRuntimeBinding(matched.id, binding)
      : matched;
  }

  public async createDashboardForScope(
    input: { name: string },
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard> {
    const scopedKnowledgeBaseId = binding?.knowledgeBaseId || null;
    const existingDashboards =
      scopedKnowledgeBaseId != null
        ? await this.dashboardRepository.findAllBy({
            knowledgeBaseId: scopedKnowledgeBaseId,
          })
        : bridgeProjectId != null
          ? await this.dashboardRepository.findAllBy({
              projectId: bridgeProjectId,
            })
          : [];

    return await createScopedDashboard(this.dashboardRepository, {
      bridgeProjectId,
      binding,
      isDefault: existingDashboards.length === 0,
      name: input.name,
    });
  }

  public async getCurrentDashboard(
    bridgeProjectId: number,
  ): Promise<Dashboard> {
    const dashboard = await findProjectDashboardByProjectBridge(
      this.dashboardRepository,
      bridgeProjectId,
    );
    if (!dashboard) {
      throw new Error(`Dashboard for project ${bridgeProjectId} not found`);
    }
    return dashboard;
  }

  public async getCurrentDashboardForScope(
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard | null> {
    const scopedKnowledgeBaseId = binding?.knowledgeBaseId || null;
    const scopedDashboards = scopedKnowledgeBaseId
      ? await this.dashboardRepository.findAllBy({
          knowledgeBaseId: scopedKnowledgeBaseId,
        })
      : [];
    const scopedDashboard =
      scopedKnowledgeBaseId != null
        ? resolveDefaultDashboard(scopedDashboards)
        : null;

    if (scopedDashboard) {
      return await this.syncDashboardRuntimeBinding(
        scopedDashboard.id,
        binding || {},
      );
    }

    if (bridgeProjectId == null) {
      return binding
        ? await createScopedDashboard(this.dashboardRepository, {
            bridgeProjectId: null,
            binding,
            isDefault: true,
          })
        : null;
    }

    const projectDashboard = await findUnboundProjectDashboard(
      this.dashboardRepository,
      bridgeProjectId,
    );
    if (projectDashboard) {
      return binding
        ? await this.syncDashboardRuntimeBinding(projectDashboard.id, binding)
        : projectDashboard;
    }

    if (!binding) {
      return await this.getCurrentDashboard(bridgeProjectId);
    }

    return await createScopedDashboard(this.dashboardRepository, {
      bridgeProjectId,
      binding,
      isDefault: true,
    });
  }

  public async updateDashboardForScope(
    dashboardId: number,
    input: UpdateDashboardForScopeInput,
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard> {
    const dashboard = await this.getDashboardForScope(
      dashboardId,
      bridgeProjectId,
      binding,
    );
    if (!dashboard) {
      throw new Error(`Dashboard with id ${dashboardId} not found`);
    }

    const normalizedName =
      input.name === undefined ? undefined : String(input.name || '').trim();
    const shouldUpdateName =
      normalizedName !== undefined &&
      normalizedName.length > 0 &&
      normalizedName !== dashboard.name;
    const shouldSetDefault = input.isDefault === true && !dashboard.isDefault;

    if (!shouldUpdateName && !shouldSetDefault) {
      return dashboard;
    }

    const tx = await this.dashboardRepository.transaction();

    try {
      if (shouldSetDefault) {
        const scopeDashboards = await this.listDashboardsForScope(
          bridgeProjectId,
          binding,
        );
        for (const scopeDashboard of scopeDashboards) {
          if (scopeDashboard.id === dashboardId || !scopeDashboard.isDefault) {
            continue;
          }
          await this.dashboardRepository.updateOne(
            scopeDashboard.id,
            { isDefault: false },
            { tx },
          );
        }
      }

      const patch: Partial<Dashboard> = {
        ...(shouldSetDefault ? { isDefault: true } : {}),
        ...(shouldUpdateName ? { name: normalizedName } : {}),
      };
      const updatedDashboard = await this.dashboardRepository.updateOne(
        dashboardId,
        patch,
        { tx },
      );

      await this.dashboardRepository.commit(tx);
      return updatedDashboard;
    } catch (error) {
      await this.dashboardRepository.rollback(tx);
      throw error;
    }
  }

  public async deleteDashboardForScope(
    dashboardId: number,
    bridgeProjectId: number | null,
    binding?: DashboardRuntimeBinding,
  ): Promise<Dashboard> {
    const dashboard = await this.getDashboardForScope(
      dashboardId,
      bridgeProjectId,
      binding,
    );
    if (!dashboard) {
      throw new Error(`Dashboard with id ${dashboardId} not found`);
    }

    const scopeDashboards = await this.listDashboardsForScope(
      bridgeProjectId,
      binding,
    );
    const remainingDashboards = scopeDashboards.filter(
      (scopeDashboard) => scopeDashboard.id !== dashboardId,
    );
    const tx = await this.dashboardRepository.transaction();

    try {
      await this.dashboardRepository.deleteOne(dashboardId, { tx });

      if (remainingDashboards.length === 0) {
        const recreatedDashboard = await createScopedDashboard(
          this.dashboardRepository,
          {
            bridgeProjectId,
            binding,
            isDefault: true,
          },
          { tx },
        );
        await this.dashboardRepository.commit(tx);
        return recreatedDashboard;
      }

      const nextDefaultDashboard = resolveDefaultDashboard(remainingDashboards);
      if (
        dashboard.isDefault &&
        nextDefaultDashboard &&
        !nextDefaultDashboard.isDefault
      ) {
        await this.dashboardRepository.updateOne(
          nextDefaultDashboard.id,
          { isDefault: true },
          { tx },
        );
      }

      await this.dashboardRepository.commit(tx);
      return nextDefaultDashboard as Dashboard;
    } catch (error) {
      await this.dashboardRepository.rollback(tx);
      throw error;
    }
  }

  public async syncDashboardRuntimeBinding(
    dashboardId: number,
    binding: DashboardRuntimeBinding,
  ): Promise<Dashboard> {
    const dashboard = await this.dashboardRepository.findOneBy({
      id: dashboardId,
    });
    if (!dashboard) {
      throw new Error(`Dashboard with id ${dashboardId} not found`);
    }

    const patch = buildDashboardRuntimeBindingPatch(dashboard, binding);
    if (Object.keys(patch).length === 0) {
      return dashboard;
    }

    return await this.dashboardRepository.updateOne(dashboardId, patch);
  }

  public async getDashboardItem(
    dashboardItemId: number,
  ): Promise<DashboardItem> {
    const item = await this.dashboardItemRepository.findOneBy({
      id: dashboardItemId,
    });
    if (!item) {
      throw new Error('Dashboard item not found.');
    }
    return item;
  }

  public async getDashboardItems(
    dashboardId: number,
  ): Promise<DashboardItem[]> {
    return await this.dashboardItemRepository.findAllBy({
      dashboardId,
    });
  }

  public async createDashboardItem(
    input: CreateDashboardItemInput,
  ): Promise<DashboardItem> {
    if (input.sourceResponseId != null) {
      const existingDashboardItem =
        await this.dashboardItemRepository.findByDashboardIdAndSourceResponseId(
          input.dashboardId,
          input.sourceResponseId,
        );
      if (existingDashboardItem) {
        return existingDashboardItem;
      }
    }

    const layout = await calculateDashboardNewLayout(
      this.dashboardItemRepository,
      input.dashboardId,
    );
    return await this.dashboardItemRepository.createOne({
      dashboardId: input.dashboardId,
      type: input.type,
      detail: {
        sql: input.sql,
        chartSchema: input.chartSchema,
        renderHints: input.renderHints,
        canonicalizationVersion: input.canonicalizationVersion ?? null,
        chartDataProfile: input.chartDataProfile || undefined,
        validationErrors: input.validationErrors || [],
        sourceResponseId: input.sourceResponseId ?? null,
        sourceThreadId: input.sourceThreadId ?? null,
        sourceQuestion: input.sourceQuestion ?? null,
      },
      layout,
    });
  }

  public async updateDashboardItem(
    dashboardItemId: number,
    input: UpdateDashboardItemInput,
  ): Promise<DashboardItem> {
    return await this.dashboardItemRepository.updateOne(dashboardItemId, {
      displayName: input.displayName,
    });
  }

  public async updateDashboardItemLayouts(
    layouts: UpdateDashboardItemLayouts,
  ): Promise<DashboardItem[]> {
    const updatedItems: DashboardItem[] = [];
    const isValidLayouts = layouts.every(
      (layout) =>
        layout.itemId &&
        layout.x >= 0 &&
        layout.y >= 0 &&
        layout.w > 0 &&
        layout.h > 0,
    );
    if (!isValidLayouts) {
      throw new Error('Invalid layouts boundaries.');
    }
    await Promise.all(
      layouts.map(async (layout) => {
        const updatedItem = await this.dashboardItemRepository.updateOne(
          layout.itemId,
          {
            layout: {
              x: layout.x,
              y: layout.y,
              w: layout.w,
              h: layout.h,
            },
          },
        );
        updatedItems.push(updatedItem);
      }),
    );
    return updatedItems;
  }

  public async deleteDashboardItem(dashboardItemId: number): Promise<boolean> {
    await this.dashboardItemRepository.deleteOne(dashboardItemId);
    return true;
  }

  protected toUTC(schedule: DashboardSchedule): DashboardSchedule {
    return toUtcDashboardSchedule(schedule);
  }

  protected toTimezone(schedule: DashboardSchedule): DashboardSchedule {
    return toDashboardTimezoneSchedule(schedule);
  }

  protected generateCronExpression(schedule: DashboardSchedule): string | null {
    return generateDashboardCronExpression(schedule);
  }

  protected calculateNextRunTime(cronExpression: string): Date | null {
    return calculateDashboardNextRunTime(cronExpression);
  }

  protected validateScheduleInput(data: SetDashboardCacheData): void {
    return validateDashboardScheduleInput(data);
  }

  public parseCronExpression(dashboard: Dashboard): DashboardSchedule {
    return parseDashboardCronExpression(dashboard);
  }
}
