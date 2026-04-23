import crypto from 'crypto';
import { IScheduleJobRepository, ScheduleJob } from '@server/repositories';

export const DASHBOARD_REFRESH_TARGET_TYPE = 'dashboard_refresh';
const DEFAULT_SCHEDULE_TIMEZONE = 'UTC';
const DASHBOARD_REFRESH_DUPLICATE_ERROR_PREFIX =
  'Duplicate dashboard refresh job superseded by';

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

type ScheduleRuntimeBinding = {
  workspaceId?: string;
  knowledgeBaseId?: string;
  kbSnapshotId?: string;
  deployHash?: string;
};

const assignIfPresent = <T extends Record<string, any>>(
  patch: T,
  key: keyof T,
  value: any,
) => {
  if (value !== undefined && value !== null) {
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
    const [job] = await this.findDashboardRefreshJobs(dashboardId);
    return job || null;
  }

  public async syncDashboardRefreshJob(
    input: SyncDashboardScheduleJobInput,
  ): Promise<ScheduleJob | null> {
    const existingJobs = await this.findDashboardRefreshJobs(input.dashboardId);
    const [existingJob, ...duplicateJobs] = existingJobs;

    if (!input.enabled) {
      if (existingJobs.length === 0) {
        return null;
      }

      const patch: Partial<ScheduleJob> = {
        ...this.selectRuntimeBinding(input, false),
        status: 'inactive',
        nextRunAt: null,
        lastError: null,
      };

      const [updatedPrimary] = await Promise.all([
        existingJob
          ? this.scheduleJobRepository.updateOne(existingJob.id, patch)
          : Promise.resolve(null),
        ...duplicateJobs.map((job) =>
          this.scheduleJobRepository.updateOne(job.id, {
            ...patch,
            lastError: this.buildDuplicateDashboardRefreshJobMessage(
              existingJob?.id || null,
            ),
          }),
        ),
      ]);

      return updatedPrimary;
    }

    const runtimeIdentity = this.selectRuntimeBinding(input, true);
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
      const [updatedPrimary] = await Promise.all([
        this.scheduleJobRepository.updateOne(existingJob.id, schedulePatch),
        ...duplicateJobs.map((job) =>
          this.scheduleJobRepository.updateOne(job.id, {
            ...runtimeIdentity,
            status: 'inactive',
            nextRunAt: null,
            lastError: this.buildDuplicateDashboardRefreshJobMessage(
              existingJob.id,
            ),
          }),
        ),
      ]);

      return updatedPrimary;
    }

    try {
      return await this.scheduleJobRepository.createOne({
        id: this.generateId(),
        ...schedulePatch,
        targetType: DASHBOARD_REFRESH_TARGET_TYPE,
        targetId: String(input.dashboardId),
        createdBy: input.createdBy ?? null,
        lastRunAt: null,
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }

      const recoveredJob = await this.findDashboardRefreshJob(
        input.dashboardId,
      );
      if (!recoveredJob) {
        throw error;
      }

      return await this.scheduleJobRepository.updateOne(
        recoveredJob.id,
        schedulePatch,
      );
    }
  }

  private async findDashboardRefreshJobs(
    dashboardId: number,
  ): Promise<ScheduleJob[]> {
    return await this.scheduleJobRepository.findAllBy(
      {
        targetType: DASHBOARD_REFRESH_TARGET_TYPE,
        targetId: String(dashboardId),
      },
      {
        order: 'updated_at desc, created_at desc, id desc',
      },
    );
  }

  private buildDuplicateDashboardRefreshJobMessage(
    primaryJobId?: string | null,
  ) {
    return primaryJobId
      ? `${DASHBOARD_REFRESH_DUPLICATE_ERROR_PREFIX} ${primaryJobId}`
      : `${DASHBOARD_REFRESH_DUPLICATE_ERROR_PREFIX} canonical`;
  }

  private isUniqueViolation(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  private selectRuntimeBinding(
    input: SyncDashboardScheduleJobInput,
    requireAll: true,
  ): Required<ScheduleRuntimeBinding>;
  private selectRuntimeBinding(
    input: SyncDashboardScheduleJobInput,
    requireAll: false,
  ): Partial<ScheduleRuntimeBinding>;
  private selectRuntimeBinding(
    input: SyncDashboardScheduleJobInput,
    requireAll: boolean,
  ): Required<ScheduleRuntimeBinding> | Partial<ScheduleRuntimeBinding> {
    if (requireAll && !input.workspaceId) {
      throw new Error(
        'Dashboard refresh schedule requires workspace runtime binding',
      );
    }

    const patch: Partial<ScheduleRuntimeBinding> = {};
    assignIfPresent(patch, 'workspaceId', input.workspaceId);
    assignIfPresent(patch, 'knowledgeBaseId', input.knowledgeBaseId);
    assignIfPresent(patch, 'kbSnapshotId', input.kbSnapshotId);
    assignIfPresent(patch, 'deployHash', input.deployHash);
    return requireAll ? (patch as Required<ScheduleRuntimeBinding>) : patch;
  }
}
