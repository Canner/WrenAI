import { getLogger } from '@server/utils';
import {
  AskResult,
  AskResultType,
  AskResultStatus,
  AskInput,
} from '@server/models/adaptor';
import {
  AskingTask,
  IAskingTaskRepository,
  IThreadResponseRepository,
  IViewRepository,
} from '@server/repositories';
import { IWrenAIAdaptor } from '../adaptors';

const logger = getLogger('AskingTaskTracker');
logger.level = 'debug';

interface TrackedTask {
  queryId: string;
  taskId?: number;
  lastPolled: number;
  question?: string;
  result?: AskResult;
  isFinalized: boolean;
  threadResponseId?: number;
}

export type TrackedAskingResult = AskResult & {
  taskId?: number;
  queryId: string;
  question: string;
};

export interface IAskingTaskTracker {
  createAskingTask(
    input: AskInput,
    question?: string,
    threadId?: number,
    threadResponseId?: number,
  ): Promise<{ queryId: string }>;
  getAskingResult(queryId: string): Promise<TrackedAskingResult>;
  getAskingResultById(id: number): Promise<TrackedAskingResult>;
  cancelAskingTask(queryId: string): Promise<void>;
  bindThreadResponse(
    id: number,
    queryId: string,
    threadId: number,
    threadResponseId: number,
  ): Promise<void>;
}

export class AskingTaskTracker implements IAskingTaskTracker {
  private wrenAIAdaptor: IWrenAIAdaptor;
  private askingTaskRepository: IAskingTaskRepository;
  private trackedTasks: Map<string, TrackedTask> = new Map();
  private trackedTasksById: Map<number, TrackedTask> = new Map();
  private pollingInterval: number;
  private memoryRetentionTime: number;
  private pollingIntervalId: NodeJS.Timeout;
  private runningJobs = new Set<string>();
  private threadResponseRepository: IThreadResponseRepository;
  private viewRepository: IViewRepository;

  constructor({
    wrenAIAdaptor,
    askingTaskRepository,
    threadResponseRepository,
    viewRepository,
    pollingInterval = 1000, // 1 second
    memoryRetentionTime = 5 * 60 * 1000, // 5 minutes
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    askingTaskRepository: IAskingTaskRepository;
    threadResponseRepository: IThreadResponseRepository;
    viewRepository: IViewRepository;
    pollingInterval?: number;
    memoryRetentionTime?: number;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.askingTaskRepository = askingTaskRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.viewRepository = viewRepository;
    this.pollingInterval = pollingInterval;
    this.memoryRetentionTime = memoryRetentionTime;
    this.startPolling();
  }

  public async createAskingTask(input: AskInput): Promise<{ queryId: string }> {
    try {
      // Call the AI service to create a task
      const response = await this.wrenAIAdaptor.ask(input);
      const queryId = response.queryId;

      // Start tracking this task
      this.trackedTasks.set(queryId, {
        queryId,
        lastPolled: Date.now(),
        question: input.query,
        isFinalized: false,
      });

      logger.info(`Created asking task with queryId: ${queryId}`);
      return { queryId };
    } catch (err) {
      logger.error(`Failed to create asking task: ${err}`);
      throw err;
    }
  }

  public async getAskingResult(queryId: string): Promise<TrackedAskingResult> {
    // Check if we're tracking this task in memory
    const trackedTask = this.trackedTasks.get(queryId);

    if (trackedTask && trackedTask.result) {
      return {
        ...trackedTask.result,
        queryId,
        question: trackedTask.question,
        taskId: trackedTask.taskId,
      };
    }

    // If not in memory or no result yet, check the database
    return this.getAskingResultFromDB({ queryId });
  }

  public async getAskingResultById(id: number): Promise<TrackedAskingResult> {
    const task = this.trackedTasksById.get(id);
    if (task) {
      return this.getAskingResult(task.queryId);
    }

    return this.getAskingResultFromDB({ taskId: id });
  }

  public async cancelAskingTask(queryId: string): Promise<void> {
    await this.wrenAIAdaptor.cancelAsk(queryId);
  }

  public stopPolling(): void {
    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
    }
  }

  public async bindThreadResponse(
    id: number,
    queryId: string,
    threadId: number,
    threadResponseId: number,
  ): Promise<void> {
    const task = this.trackedTasks.get(queryId);
    if (!task) {
      throw new Error(`Task ${queryId} not found`);
    }

    task.threadResponseId = threadResponseId;
    this.trackedTasksById.set(id, task);
    await this.askingTaskRepository.updateOne(id, {
      threadId,
      threadResponseId,
    });
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
            const result = await this.wrenAIAdaptor.getAskResult(queryId);
            task.lastPolled = now;

            // if result is not changed, we don't need to update the database
            if (!this.isResultChanged(task.result, result)) {
              this.runningJobs.delete(queryId);
              return;
            }

            // update task in memory if any change
            task.result = result;

            // if result is still understanding, we don't need to update the database
            if (result.status === AskResultStatus.UNDERSTANDING) {
              this.runningJobs.delete(queryId);
              return;
            }

            // if type is not TEXT_TO_SQL, we don't need to update the database
            // finalizing the task
            if (result.type !== AskResultType.TEXT_TO_SQL) {
              task.isFinalized = true;
              this.runningJobs.delete(queryId);
              return;
            }

            // update the database
            logger.info(`Updating task ${queryId} in database`);
            await this.updateTaskInDatabase(queryId, task);

            // Check if task is now finalized
            if (this.isTaskFinalized(result.status)) {
              task.isFinalized = true;
              // update thread response if threadResponseId is provided
              if (task.threadResponseId) {
                const response = result?.response?.[0];

                // if the generated response of asking task is not null, update the thread response
                if (response) {
                  if (response.viewId) {
                    // get sql from the view
                    const view = await this.viewRepository.findOneBy({
                      id: response.viewId,
                    });
                    await this.threadResponseRepository.updateOne(
                      task.threadResponseId,
                      {
                        sql: view.statement,
                        viewId: response.viewId,
                      },
                    );
                  } else {
                    await this.threadResponseRepository.updateOne(
                      task.threadResponseId,
                      {
                        sql: response?.sql,
                      },
                    );
                  }
                }
              }

              logger.info(
                `Task ${queryId} is finalized with status: ${result.status}`,
              );
            }

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

  private async getAskingResultFromDB({
    queryId,
    taskId,
  }: {
    queryId?: string;
    taskId?: number;
  }): Promise<TrackedAskingResult> {
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
      ...taskRecord?.detail,
      queryId,
      question: taskRecord?.question,
      taskId: taskRecord?.id,
    };
  }

  private async updateTaskInDatabase(
    queryId: string,
    trackedTask: TrackedTask,
  ): Promise<void> {
    const taskRecord = await this.askingTaskRepository.findByQueryId(queryId);

    if (!taskRecord) {
      // if record not found, create one
      const task = await this.askingTaskRepository.createOne({
        queryId,
        question: trackedTask.question,
        detail: trackedTask.result,
      });
      // update the task id in memory
      this.trackedTasks.get(queryId).taskId = task.id;
      return;
    }

    // update the task
    await this.askingTaskRepository.updateOne(taskRecord.id, {
      detail: trackedTask.result,
    });
  }

  private isTaskFinalized(status: AskResultStatus): boolean {
    return [
      AskResultStatus.FINISHED,
      AskResultStatus.FAILED,
      AskResultStatus.STOPPED,
    ].includes(status);
  }

  private isResultChanged(
    previousResult: AskResult,
    newResult: AskResult,
  ): boolean {
    // check status change
    if (previousResult?.status !== newResult.status) {
      return true;
    }

    return false;
  }
}
