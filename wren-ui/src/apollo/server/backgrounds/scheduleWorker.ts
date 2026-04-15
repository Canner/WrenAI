import { getLogger } from '@server/utils';
import {
  AuditEvent,
  IAuditEventRepository,
  IScheduleJobRepository,
  IScheduleJobRunRepository,
  ScheduleJob,
} from '@server/repositories';
import { CronExpressionParser } from 'cron-parser';
import { v4 as uuidv4 } from 'uuid';
import { registerShutdownCallback } from '@server/utils/shutdown';
import {
  buildScheduledJobActor,
  serializeAuthorizationActor,
} from '@server/authz';

const logger = getLogger('ScheduleWorker');
logger.level = 'debug';

export interface ScheduleJobExecutionResult {
  traceId?: string | null;
  detailJson?: Record<string, any> | null;
}

export type ScheduleJobExecutor = (
  job: ScheduleJob,
) => Promise<ScheduleJobExecutionResult | void>;

export interface ScheduleWorkerExecutors {
  [targetType: string]: ScheduleJobExecutor;
}

export class ScheduleWorker {
  private readonly intervalTime: number;
  private readonly scheduleJobRepository: IScheduleJobRepository;
  private readonly scheduleJobRunRepository: IScheduleJobRunRepository;
  private readonly auditEventRepository: IAuditEventRepository;
  private readonly executors: ScheduleWorkerExecutors;
  private readonly runningJobs = new Set<string>();
  private readonly generateId: () => string;
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  private unregisterShutdown?: () => void;

  constructor({
    scheduleJobRepository,
    scheduleJobRunRepository,
    auditEventRepository,
    executors,
    intervalTime = 60000,
    generateId = uuidv4,
  }: {
    scheduleJobRepository: IScheduleJobRepository;
    scheduleJobRunRepository: IScheduleJobRunRepository;
    auditEventRepository: IAuditEventRepository;
    executors: ScheduleWorkerExecutors;
    intervalTime?: number;
    generateId?: () => string;
  }) {
    this.scheduleJobRepository = scheduleJobRepository;
    this.scheduleJobRunRepository = scheduleJobRunRepository;
    this.auditEventRepository = auditEventRepository;
    this.executors = executors;
    this.intervalTime = intervalTime;
    this.generateId = generateId;
    this.start();
  }

  private start() {
    if (this.pollingIntervalId) {
      return;
    }
    logger.info('Schedule worker started');
    this.pollingIntervalId = setInterval(() => {
      void this.runDueJobsOnce();
    }, this.intervalTime);
    this.unregisterShutdown = registerShutdownCallback(() => this.stop());
  }

  public stop() {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
    this.unregisterShutdown?.();
    this.unregisterShutdown = undefined;
  }

  public async runDueJobsOnce() {
    const jobs = await this.scheduleJobRepository.findAllBy({
      status: 'active',
    });
    const now = new Date();

    await Promise.all(
      jobs
        .filter((job) => job.nextRunAt && new Date(job.nextRunAt) <= now)
        .map((job) => this.runJobNow(job)),
    );
  }

  public async runJobNow(job: ScheduleJob) {
    if (this.runningJobs.has(job.id)) {
      logger.debug(`Schedule job ${job.id} is already running`);
      return;
    }

    const executor = this.executors[job.targetType];
    const runId = this.generateId();
    const startedAt = new Date();
    const executionActor = buildScheduledJobActor({
      workspaceId: job.workspaceId,
      principalId: job.id,
    });
    const bindingPayload = this.buildBindingPayload(job, executionActor);
    this.runningJobs.add(job.id);

    try {
      await this.scheduleJobRunRepository.createOne({
        id: runId,
        scheduleJobId: job.id,
        status: 'running',
        startedAt,
        detailJson: bindingPayload,
      });

      if (!executor) {
        throw new Error(
          `No executor registered for target type ${job.targetType}`,
        );
      }

      const result = (await executor(job)) || {};
      const finishedAt = new Date();

      await this.scheduleJobRunRepository.updateOne(runId, {
        status: 'succeeded',
        finishedAt,
        traceId: result.traceId || null,
        detailJson: {
          ...bindingPayload,
          ...(result.detailJson || {}),
        },
      });

      await this.scheduleJobRepository.updateOne(job.id, {
        lastRunAt: finishedAt,
        nextRunAt: this.calculateNextRunAt(job.cronExpr),
        lastError: null,
      });

      await this.recordAuditEvent({
        workspaceId: job.workspaceId,
        actorType: executionActor.principalType,
        actorId: executionActor.principalId,
        actorUserId: null,
        action: 'schedule_job.run',
        entityType: 'schedule_job',
        entityId: job.id,
        resourceType: 'schedule_job',
        resourceId: job.id,
        eventType: 'schedule_job.succeeded',
        result: 'succeeded',
        payloadJson: {
          ...bindingPayload,
          traceId: result.traceId || null,
          status: 'succeeded',
        },
      });
    } catch (error) {
      const finishedAt = new Date();
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.scheduleJobRunRepository.updateOne(runId, {
        status: 'failed',
        finishedAt,
        errorMessage,
        detailJson: bindingPayload,
      });
      await this.scheduleJobRepository.updateOne(job.id, {
        lastRunAt: finishedAt,
        lastError: errorMessage,
      });
      await this.recordAuditEvent({
        workspaceId: job.workspaceId,
        actorType: executionActor.principalType,
        actorId: executionActor.principalId,
        actorUserId: null,
        action: 'schedule_job.run',
        entityType: 'schedule_job',
        entityId: job.id,
        resourceType: 'schedule_job',
        resourceId: job.id,
        eventType: 'schedule_job.failed',
        result: 'failed',
        reason: errorMessage,
        payloadJson: {
          ...bindingPayload,
          status: 'failed',
          errorMessage,
        },
      });
      logger.error(`Failed to execute schedule job ${job.id}: ${errorMessage}`);
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  private buildBindingPayload(
    job: ScheduleJob,
    executionActor = buildScheduledJobActor({
      workspaceId: job.workspaceId,
      principalId: job.id,
    }),
  ) {
    return {
      targetType: job.targetType,
      targetId: job.targetId,
      requestedByUserId: job.createdBy || null,
      createdByUserId: job.createdBy || null,
      executedBy: executionActor.principalType,
      authorizationActor: serializeAuthorizationActor(executionActor),
      runtimeIdentity: {
        workspaceId: job.workspaceId,
        knowledgeBaseId: job.knowledgeBaseId,
        kbSnapshotId: job.kbSnapshotId,
        deployHash: job.deployHash,
      },
    };
  }

  private async recordAuditEvent(event: Partial<AuditEvent>) {
    await this.auditEventRepository.createOne({
      id: this.generateId(),
      ...event,
    });
  }

  private calculateNextRunAt(cronExpr: string) {
    try {
      return CronExpressionParser.parse(cronExpr, {
        currentDate: new Date(),
      })
        .next()
        .toDate();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Failed to parse schedule cron expression: ${errorMessage}`);
      return null;
    }
  }
}
