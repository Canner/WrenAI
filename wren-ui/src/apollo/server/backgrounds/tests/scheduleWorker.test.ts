import { ScheduleWorker } from '../scheduleWorker';

describe('ScheduleWorker', () => {
  const dueJob = {
    id: 'job-1',
    workspaceId: 'workspace-1',
    knowledgeBaseId: 'kb-1',
    kbSnapshotId: 'snapshot-1',
    deployHash: 'deploy-1',
    targetType: 'dashboard_refresh',
    targetId: 'dashboard-1',
    cronExpr: '0 * * * *',
    timezone: 'UTC',
    status: 'active',
    nextRunAt: new Date(Date.now() - 60_000),
    createdBy: 'user-1',
  };

  let scheduleJobRepository: any;
  let scheduleJobRunRepository: any;
  let auditEventRepository: any;
  let executor: jest.Mock;
  let worker: ScheduleWorker;

  beforeEach(() => {
    jest.spyOn(global, 'setInterval').mockImplementation((() => 1) as any);

    scheduleJobRepository = {
      findAllBy: jest.fn().mockResolvedValue([dueJob]),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    scheduleJobRunRepository = {
      createOne: jest.fn().mockResolvedValue(undefined),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    auditEventRepository = {
      createOne: jest.fn().mockResolvedValue(undefined),
    };
    executor = jest.fn().mockResolvedValue({
      traceId: 'trace-1',
      detailJson: { refreshedItems: 3 },
    });

    worker = new ScheduleWorker({
      scheduleJobRepository,
      scheduleJobRunRepository,
      auditEventRepository,
      executors: {
        dashboard_refresh: executor,
      },
      generateId: (() => {
        let counter = 0;
        return () => `id-${++counter}`;
      })(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('executes due jobs with the job-bound runtime identity and records audit/run state', async () => {
    await worker.runDueJobsOnce();

    expect(executor).toHaveBeenCalledWith(dueJob);
    expect(scheduleJobRunRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'id-1',
        scheduleJobId: 'job-1',
        status: 'running',
        detailJson: {
          targetType: 'dashboard_refresh',
          targetId: 'dashboard-1',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
        },
      }),
    );
    expect(scheduleJobRunRepository.updateOne).toHaveBeenCalledWith(
      'id-1',
      expect.objectContaining({
        status: 'succeeded',
        traceId: 'trace-1',
        detailJson: expect.objectContaining({
          refreshedItems: 3,
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
        }),
      }),
    );
    expect(scheduleJobRepository.updateOne).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        lastError: null,
        lastRunAt: expect.any(Date),
        nextRunAt: expect.any(Date),
      }),
    );
    expect(auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'id-2',
        workspaceId: 'workspace-1',
        actorUserId: 'user-1',
        entityType: 'schedule_job',
        entityId: 'job-1',
        eventType: 'schedule_job.succeeded',
        payloadJson: expect.objectContaining({
          traceId: 'trace-1',
          status: 'succeeded',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
        }),
      }),
    );
  });

  it('marks the run failed when the executor is missing', async () => {
    worker = new ScheduleWorker({
      scheduleJobRepository,
      scheduleJobRunRepository,
      auditEventRepository,
      executors: {},
      generateId: (() => {
        let counter = 0;
        return () => `missing-${++counter}`;
      })(),
    });

    await worker.runDueJobsOnce();

    expect(scheduleJobRunRepository.updateOne).toHaveBeenCalledWith(
      'missing-1',
      expect.objectContaining({
        status: 'failed',
        errorMessage:
          'No executor registered for target type dashboard_refresh',
      }),
    );
    expect(scheduleJobRepository.updateOne).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        lastError: 'No executor registered for target type dashboard_refresh',
      }),
    );
    expect(auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'schedule_job.failed',
        payloadJson: expect.objectContaining({
          status: 'failed',
          runtimeIdentity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
        }),
      }),
    );
  });
});
