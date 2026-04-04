import crypto from 'crypto';
import { IScheduleJobRepository, ScheduleJob } from '@server/repositories';

export const DASHBOARD_REFRESH_TARGET_TYPE = 'dashboard_refresh';
const DEFAULT_SCHEDULE_TIMEZONE = 'UTC';

export interface SyncDashboardScheduleJobInput {
  dashboardId: number;
  enabled: boolean;
  cronExpr?: string | null;
  timezone?: string | null;
  nextRunAt?: Date | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  createdBy?: string | null;
}

export interface IScheduleService {
  findDashboardRefreshJob(dashboardId: number): Promise<ScheduleJob | null>;
  syncDashboardRefreshJob(
    input: SyncDashboardScheduleJobInput,
  ): Promise<ScheduleJob | null>;
}

const assignIfPresent = <T extends Record<string, any>>(
  patch: T,
  key: keyof T,
  value: any,
) => {
  if (value !== undefined) {
    patch[key] = value;
  }
};

export class ScheduleService implements IScheduleService {
  private readonly scheduleJobRepository: IScheduleJobRepository;
  private readonly generateId: () => string;

  constructor({
    scheduleJobRepository,
    generateId = crypto.randomUUID,
  }: {
    scheduleJobRepository: IScheduleJobRepository;
    generateId?: () => string;
  }) {
    this.scheduleJobRepository = scheduleJobRepository;
    this.generateId = generateId;
  }

  public async findDashboardRefreshJob(
    dashboardId: number,
  ): Promise<ScheduleJob | null> {
    return await this.scheduleJobRepository.findOneBy({
      targetType: DASHBOARD_REFRESH_TARGET_TYPE,
      targetId: String(dashboardId),
    });
  }

  public async syncDashboardRefreshJob(
    input: SyncDashboardScheduleJobInput,
  ): Promise<ScheduleJob | null> {
    const existingJob = await this.findDashboardRefreshJob(input.dashboardId);

    if (!input.enabled) {
      if (!existingJob) {
        return null;
      }

      return await this.scheduleJobRepository.updateOne(existingJob.id, {
        ...this.buildRuntimeIdentityPatch(input),
        status: 'inactive',
        nextRunAt: null,
        lastError: null,
      });
    }

    const runtimeIdentity = this.requireRuntimeIdentity(input);
    const cronExpr = input.cronExpr?.trim();
    if (!cronExpr) {
      throw new Error(
        'Dashboard refresh schedule requires a cron expression when enabled',
      );
    }

    const schedulePatch: Partial<ScheduleJob> = {
      ...runtimeIdentity,
      cronExpr,
      timezone:
        input.timezone && input.timezone.trim().length > 0
          ? input.timezone
          : DEFAULT_SCHEDULE_TIMEZONE,
      status: 'active',
      nextRunAt: input.nextRunAt ?? null,
      lastError: null,
    };

    if (existingJob) {
      return await this.scheduleJobRepository.updateOne(
        existingJob.id,
        schedulePatch,
      );
    }

    return await this.scheduleJobRepository.createOne({
      id: this.generateId(),
      ...schedulePatch,
      targetType: DASHBOARD_REFRESH_TARGET_TYPE,
      targetId: String(input.dashboardId),
      createdBy: input.createdBy ?? null,
      lastRunAt: null,
    });
  }

  private requireRuntimeIdentity(
    input: SyncDashboardScheduleJobInput,
  ): Required<
    Pick<
      SyncDashboardScheduleJobInput,
      'workspaceId' | 'knowledgeBaseId' | 'kbSnapshotId' | 'deployHash'
    >
  > {
    if (!input.workspaceId) {
      throw new Error(
        'Dashboard refresh schedule requires workspace runtime binding',
      );
    }
    if (!input.knowledgeBaseId) {
      throw new Error(
        'Dashboard refresh schedule requires knowledge base runtime binding',
      );
    }
    if (!input.kbSnapshotId) {
      throw new Error(
        'Dashboard refresh schedule requires snapshot runtime binding',
      );
    }
    if (!input.deployHash) {
      throw new Error(
        'Dashboard refresh schedule requires deploy hash runtime binding',
      );
    }

    return {
      workspaceId: input.workspaceId,
      knowledgeBaseId: input.knowledgeBaseId,
      kbSnapshotId: input.kbSnapshotId,
      deployHash: input.deployHash,
    };
  }

  private buildRuntimeIdentityPatch(
    input: SyncDashboardScheduleJobInput,
  ): Partial<ScheduleJob> {
    const patch: Partial<ScheduleJob> = {};
    assignIfPresent(patch, 'workspaceId', input.workspaceId);
    assignIfPresent(patch, 'knowledgeBaseId', input.knowledgeBaseId);
    assignIfPresent(patch, 'kbSnapshotId', input.kbSnapshotId);
    assignIfPresent(patch, 'deployHash', input.deployHash);
    return patch;
  }
}
