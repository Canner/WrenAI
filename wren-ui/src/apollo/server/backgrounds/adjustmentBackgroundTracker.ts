import { getLogger } from '@server/utils';
import {
  AskFeedbackInput,
  AskFeedbackResult,
  AskFeedbackStatus,
} from '@server/models/adaptor';
import {
  AskingTask,
  IAskingTaskRepository,
  IThreadResponseRepository,
  ThreadResponse,
  ThreadResponseAdjustmentType,
} from '@server/repositories';
import { IWrenAIAdaptor } from '../adaptors';
import { TelemetryEvent, WrenService } from '../telemetry/telemetry';
import { PostHogTelemetry } from '../telemetry/telemetry';

const logger = getLogger('AdjustmentTaskTracker');
logger.level = 'debug';

interface TrackedTask {
  queryId: string;
  taskId?: number;
  lastPolled: number;
  result?: AskFeedbackResult;
  isFinalized: boolean;
  threadResponseId: number;
  question: string;
  originalThreadResponseId: number;
  rerun?: boolean;
  adjustmentPayload?: {
    originalThreadResponseId: number;
    retrievedTables: string[];
    sqlGenerationReasoning: string;
  };
}

export type TrackedAdjustmentResult = AskFeedbackResult & {
  taskId?: number;
  queryId: string;
};

export type CreateAdjustmentTaskInput = AskFeedbackInput & {
  threadId: number;
  question: string;
  originalThreadResponseId: number;
  configurations: { language: string };
};

export type RerunAdjustmentTaskInput = {
  threadResponseId: number;
  threadId: number;
  projectId: number;
  configurations: { language: string };
};

export interface IAdjustmentBackgroundTaskTracker {
  createAdjustmentTask(
    input: CreateAdjustmentTaskInput,
  ): Promise<{ queryId: string }>;
  getAdjustmentResult(queryId: string): Promise<TrackedAdjustmentResult | null>;
  getAdjustmentResultById(id: number): Promise<TrackedAdjustmentResult | null>;
  cancelAdjustmentTask(queryId: string): Promise<void>;
  rerunAdjustmentTask(
    input: RerunAdjustmentTaskInput,
  ): Promise<{ queryId: string }>;
}

export class AdjustmentBackgroundTaskTracker
  implements IAdjustmentBackgroundTaskTracker
{
  private wrenAIAdaptor: IWrenAIAdaptor;
  private askingTaskRepository: IAskingTaskRepository;
  private trackedTasks: Map<string, TrackedTask> = new Map();
  private trackedTasksById: Map<number, TrackedTask> = new Map();
  private pollingInterval: number;
  private memoryRetentionTime: number;
  private pollingIntervalId: NodeJS.Timeout;
  private runningJobs = new Set<string>();
  private threadResponseRepository: IThreadResponseRepository;
  private telemetry: PostHogTelemetry;

  constructor({
    telemetry,
    wrenAIAdaptor,
    askingTaskRepository,
    threadResponseRepository,
    pollingInterval = 1000, // 1 second
    memoryRetentionTime = 5 * 60 * 1000, // 5 minutes
  }: {
    telemetry: PostHogTelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    askingTaskRepository: IAskingTaskRepository;
    threadResponseRepository: IThreadResponseRepository;
    pollingInterval?: number;
    memoryRetentionTime?: number;
  }) {
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.askingTaskRepository = askingTaskRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.pollingInterval = pollingInterval;
    this.memoryRetentionTime = memoryRetentionTime;
    this.startPolling();
  }

  public async createAdjustmentTask(
    input: CreateAdjustmentTaskInput,
  ): Promise<{ queryId: string; createdThreadResponse: ThreadResponse }> {
    try {
      // Call the AI service to create a task
      const response = await this.wrenAIAdaptor.createAskFeedback(input);
      const queryId = response.queryId;

      // create a new asking task
      const createdAskingTask = await this.askingTaskRepository.createOne({
        queryId,
        question: input.question,
        threadId: input.threadId,
        detail: {
          adjustment: true,
          status: AskFeedbackStatus.UNDERSTANDING,
          response: [],
          error: null,
        },
      });

      // create a new thread response with adjustment payload
      const createdThreadResponse =
        await this.threadResponseRepository.createOne({
          question: input.question,
          threadId: input.threadId,
          askingTaskId: createdAskingTask.id,
          adjustment: {
            type: ThreadResponseAdjustmentType.REASONING,
            payload: {
              originalThreadResponseId: input.originalThreadResponseId,
              retrievedTables: input.tables,
              sqlGenerationReasoning: input.sqlGenerationReasoning,
            },
          },
        });

      // bind the thread response to the asking task
      // todo: it's weird that we need to update the asking task again
      // find a better way to do this
      await this.askingTaskRepository.updateOne(createdAskingTask.id, {
        threadResponseId: createdThreadResponse.id,
      });

      // Start tracking this task
      const task = {
        queryId,
        lastPolled: Date.now(),
        isFinalized: false,
        originalThreadResponseId: input.originalThreadResponseId,
        threadResponseId: createdThreadResponse.id,
        question: input.question,
        adjustmentPayload: {
          originalThreadResponseId: input.originalThreadResponseId,
          retrievedTables: input.tables,
          sqlGenerationReasoning: input.sqlGenerationReasoning,
        },
      } as TrackedTask;
      this.trackedTasks.set(queryId, task);
      this.trackedTasksById.set(createdThreadResponse.id, task);

      logger.info(`Created adjustment task with queryId: ${queryId}`);
      return { queryId, createdThreadResponse };
    } catch (err) {
      logger.error(`Failed to create adjustment task: ${err}`);
      throw err;
    }
  }

  public async rerunAdjustmentTask(
    input: RerunAdjustmentTaskInput,
  ): Promise<{ queryId: string }> {
    const currentThreadResponse = await this.threadResponseRepository.findOneBy(
      {
        id: input.threadResponseId,
      },
    );
    if (!currentThreadResponse) {
      throw new Error(`Thread response ${input.threadResponseId} not found`);
    }

    const adjustment = currentThreadResponse.adjustment;
    if (!adjustment) {
      throw new Error(
        `Thread response ${input.threadResponseId} has no adjustment`,
      );
    }

    const originalThreadResponse =
      await this.threadResponseRepository.findOneBy({
        id: adjustment.payload?.originalThreadResponseId,
      });
    if (!originalThreadResponse) {
      throw new Error(
        `Original thread response ${adjustment.payload?.originalThreadResponseId} not found`,
      );
    }

    // call createAskFeedback on AI service
    const response = await this.wrenAIAdaptor.createAskFeedback({
      ...input,
      tables: adjustment.payload?.retrievedTables,
      sqlGenerationReasoning: adjustment.payload?.sqlGenerationReasoning,
      sql: originalThreadResponse.sql,
      question: originalThreadResponse.question,
    });
    const queryId = response.queryId;

    // update asking task with new queryId
    await this.askingTaskRepository.updateOne(
      currentThreadResponse.askingTaskId,
      {
        queryId,

        // reset detail
        detail: {
          adjustment: true,
          status: AskFeedbackStatus.UNDERSTANDING,
          response: [],
          error: null,
        },
      },
    );

    // schedule task
    const task = {
      queryId,
      lastPolled: Date.now(),
      isFinalized: false,
      originalThreadResponseId: originalThreadResponse.id,
      threadResponseId: currentThreadResponse.id,
      question: originalThreadResponse.question,
      rerun: true,
      adjustmentPayload: {
        originalThreadResponseId: originalThreadResponse.id,
        retrievedTables: adjustment.payload?.retrievedTables,
        sqlGenerationReasoning: adjustment.payload?.sqlGenerationReasoning,
      },
    } as TrackedTask;
    this.trackedTasks.set(queryId, task);
    this.trackedTasksById.set(currentThreadResponse.id, task);

    logger.info(`Rerun adjustment task with queryId: ${queryId}`);
    return { queryId };
  }

  public async getAdjustmentResult(
    queryId: string,
  ): Promise<TrackedAdjustmentResult | null> {
    // Check if we're tracking this task in memory
    const trackedTask = this.trackedTasks.get(queryId);

    if (trackedTask && trackedTask.result) {
      return {
        ...trackedTask.result,
        queryId,
        taskId: trackedTask.taskId,
      };
    }

    // If not in memory or no result yet, check the database
    return this.getAdjustmentResultFromDB({ queryId });
  }

  public async getAdjustmentResultById(
    id: number,
  ): Promise<TrackedAdjustmentResult | null> {
    const task = this.trackedTasksById.get(id);
    if (task) {
      return this.getAdjustmentResult(task.queryId);
    }

    return this.getAdjustmentResultFromDB({ taskId: id });
  }

  public async cancelAdjustmentTask(queryId: string): Promise<void> {
    await this.wrenAIAdaptor.cancelAskFeedback(queryId);

    // telemetry
    const eventName = TelemetryEvent.HOME_ADJUST_THREAD_RESPONSE_CANCEL;
    this.telemetry.sendEvent(eventName, {
      queryId,
    });
  }

  public stopPolling(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
    }
  }

  private startPolling(): void {
    this.pollingIntervalId = setInterval(() => {
      this.pollTasks();
    }, this.pollingInterval);
  }

  private async pollTasks(): Promise<void> {
    const now = Date.now();
    const tasksToRemove: string[] = [];

    // Create an array of job functions
    const jobs = Array.from(this.trackedTasks.entries()).map(
      ([queryId, task]) =>
        async () => {
          try {
            // Skip if the job is already running
            if (this.runningJobs.has(queryId)) {
              return;
            }

            // Skip finalized tasks that have been in memory too long
            if (
              task.isFinalized &&
              now - task.lastPolled > this.memoryRetentionTime
            ) {
              tasksToRemove.push(queryId);
              return;
            }

            // Skip finalized tasks
            if (task.isFinalized) {
              return;
            }

            // Mark the job as running
            this.runningJobs.add(queryId);

            // Poll for updates
            logger.info(`Polling for updates for task ${queryId}`);
            const result =
              await this.wrenAIAdaptor.getAskFeedbackResult(queryId);
            task.lastPolled = now;

            // if result is not changed, we don't need to update the database
            if (!this.isResultChanged(task.result, result)) {
              this.runningJobs.delete(queryId);
              return;
            }

            // Check if task is now finalized
            if (this.isTaskFinalized(result.status)) {
              task.isFinalized = true;
              // update thread response if threadResponseId is provided
              if (task.threadResponseId) {
                await this.updateThreadResponseWhenTaskFinalized(
                  task.threadResponseId,
                  result,
                );
              }

              // telemetry
              const eventName = task.rerun
                ? TelemetryEvent.HOME_ADJUST_THREAD_RESPONSE_RERUN
                : TelemetryEvent.HOME_ADJUST_THREAD_RESPONSE;
              const eventProperties = {
                taskId: task.taskId,
                queryId: task.queryId,
                status: result.status,
                error: result.error,
                adjustmentPayload: task.adjustmentPayload,
              };
              if (result.status === AskFeedbackStatus.FINISHED) {
                this.telemetry.sendEvent(eventName, eventProperties);
              } else {
                this.telemetry.sendEvent(
                  eventName,
                  eventProperties,
                  WrenService.AI,
                  false,
                );
              }

              logger.info(
                `Task ${queryId} is finalized with status: ${result.status}`,
              );
            }

            // update task in memory if any change
            task.result = result;

            // update the database
            logger.info(`Updating task ${queryId} in database`);
            await this.updateTaskInDatabase({ queryId }, result);

            // Mark the job as finished
            this.runningJobs.delete(queryId);
          } catch (err) {
            this.runningJobs.delete(queryId);
            logger.error(err.stack);
            throw err;
          }
        },
    );

    // Run all jobs in parallel
    Promise.allSettled(jobs.map((job) => job())).then((results) => {
      // Log any rejected promises
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.error(`Job ${index} failed: ${result.reason}`);
        }
      });

      // Clean up tasks that have been in memory too long
      if (tasksToRemove.length > 0) {
        logger.info(
          `Cleaning up tasks that have been in memory too long. Tasks: ${tasksToRemove.join(
            ', ',
          )}`,
        );
      }
      for (const queryId of tasksToRemove) {
        this.trackedTasks.delete(queryId);
      }
    });
  }

  private async updateThreadResponseWhenTaskFinalized(
    threadResponseId: number,
    result: AskFeedbackResult,
  ): Promise<void> {
    const response = result?.response?.[0];
    if (!response) {
      return;
    }
    await this.threadResponseRepository.updateOne(threadResponseId, {
      sql: response?.sql,
    });
  }

  private async getAdjustmentResultFromDB({
    queryId,
    taskId,
  }: {
    queryId?: string;
    taskId?: number;
  }): Promise<TrackedAdjustmentResult | null> {
    let taskRecord: AskingTask | null = null;
    if (queryId) {
      taskRecord = await this.askingTaskRepository.findByQueryId(queryId);
    } else if (taskId) {
      taskRecord = await this.askingTaskRepository.findOneBy({ id: taskId });
    }

    if (!taskRecord) {
      return null;
    }

    return {
      ...(taskRecord?.detail as AskFeedbackResult),
      queryId: queryId || taskRecord?.queryId,
      taskId: taskRecord?.id,
    };
  }

  private async updateTaskInDatabase(
    filter: { queryId?: string; taskId?: number },
    result: AskFeedbackResult,
  ): Promise<void> {
    const { queryId, taskId } = filter;
    let taskRecord: AskingTask | null = null;
    if (queryId) {
      taskRecord = await this.askingTaskRepository.findByQueryId(queryId);
    } else if (taskId) {
      taskRecord = await this.askingTaskRepository.findOneBy({ id: taskId });
    }

    if (!taskRecord) {
      throw new Error('Asking task not found');
    }

    // update the task
    await this.askingTaskRepository.updateOne(taskRecord.id, {
      detail: {
        adjustment: true,
        ...result,
      },
    });
  }

  private isTaskFinalized(status: AskFeedbackStatus): boolean {
    return [
      AskFeedbackStatus.FINISHED,
      AskFeedbackStatus.FAILED,
      AskFeedbackStatus.STOPPED,
    ].includes(status);
  }

  private isResultChanged(
    previousResult: AskFeedbackResult,
    newResult: AskFeedbackResult,
  ): boolean {
    // check status change
    if (previousResult?.status !== newResult.status) {
      return true;
    }

    return false;
  }
}
