import { ChartStatus } from '@server/models/adaptor';
import { IWrenAIAdaptor } from '@server/adaptors/wrenAIAdaptor';
import {
  IThreadResponseRepository,
  ThreadResponse,
} from '@server/repositories';
import { getLogger } from '@server/utils/logger';
import {
  PostHogTelemetry,
  TelemetryEvent,
  WrenService,
} from '@server/telemetry/telemetry';

const logger = getLogger('ChartBackgroundTracker');
logger.level = 'debug';

const isFinalized = (status: ChartStatus) => {
  return (
    status === ChartStatus.FINISHED ||
    status === ChartStatus.FAILED ||
    status === ChartStatus.STOPPED
  );
};

const MIN_POLL_DELAY = 2000;
const MAX_POLL_DELAY = 10000;

export class ChartBackgroundTracker {
  private tasks: Record<number, ThreadResponse> = {};
  private nextPollAt: Record<number, number> = {};
  private pollDelay: Record<number, number> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private runningJobs = new Set();
  private telemetry: PostHogTelemetry;

  constructor({
    telemetry,
    wrenAIAdaptor,
    threadResponseRepository,
  }: {
    telemetry: PostHogTelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
  }) {
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.intervalTime = 2000;
    this.start();
  }

  private start() {
    logger.info('Chart background tracker started');
    setInterval(() => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          // check if same job is running
          if (this.runningJobs.has(threadResponse.id)) {
            return;
          }

          if (Date.now() < (this.nextPollAt[threadResponse.id] || 0)) {
            return;
          }

          // mark the job as running
          this.runningJobs.add(threadResponse.id);

          // get the chart detail
          const chartDetail = threadResponse.chartDetail;

          // get the latest result from AI service
          const result = await this.wrenAIAdaptor.getChartResult(
            chartDetail.queryId,
          );

          const statusChanged = chartDetail.status !== result.status;
          this.scheduleNextPoll(threadResponse.id, result.status, statusChanged);

          if (isFinalized(result.status) && !statusChanged) {
            this.finalizeTask(threadResponse, result);
            this.runningJobs.delete(threadResponse.id);
            return;
          }

          // check if status change
          if (!statusChanged) {
            // mark the job as finished
            logger.debug(
              `Job ${threadResponse.id} chart status not changed, finished`,
            );
            this.runningJobs.delete(threadResponse.id);
            return;
          }

          // update database
          const updatedChartDetail = {
            queryId: chartDetail.queryId,
            status: result?.status,
            error: result?.error,
            description: result?.response?.reasoning,
            chartType: result?.response?.chartType?.toUpperCase() || null,
            chartSchema: result?.response?.chartSchema,
          };
          logger.debug(
            `Job ${threadResponse.id} chart status changed, updating`,
          );
          await this.threadResponseRepository.updateOne(threadResponse.id, {
            chartDetail: updatedChartDetail,
          });
          threadResponse.chartDetail = updatedChartDetail;

          // remove the task from tracker if it is finalized
          if (isFinalized(result.status)) {
            this.finalizeTask(threadResponse, result);
          }

          // mark the job as finished
          this.runningJobs.delete(threadResponse.id);
        },
      );

      // run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(threadResponse: ThreadResponse) {
    this.tasks[threadResponse.id] = threadResponse;
    this.nextPollAt[threadResponse.id] = Date.now();
    this.pollDelay[threadResponse.id] = MIN_POLL_DELAY;
  }

  public getTasks() {
    return this.tasks;
  }

  private scheduleNextPoll(
    taskId: number,
    status: ChartStatus,
    resultChanged: boolean,
  ) {
    if (isFinalized(status)) {
      this.nextPollAt[taskId] = Number.MAX_SAFE_INTEGER;
      return;
    }

    const baseDelay = status === ChartStatus.FETCHING ? MIN_POLL_DELAY : 3000;
    this.pollDelay[taskId] = resultChanged
      ? baseDelay
      : Math.min(
          Math.max((this.pollDelay[taskId] || baseDelay) * 1.5, baseDelay),
          MAX_POLL_DELAY,
        );
    this.nextPollAt[taskId] = Date.now() + this.pollDelay[taskId];
  }

  private finalizeTask(threadResponse: ThreadResponse, result) {
    const eventProperties = {
      question: threadResponse.question,
      error: result.error,
    };
    if (result.status === ChartStatus.FINISHED) {
      this.telemetry.sendEvent(TelemetryEvent.HOME_ANSWER_CHART, eventProperties);
    } else {
      this.telemetry.sendEvent(
        TelemetryEvent.HOME_ANSWER_CHART,
        eventProperties,
        WrenService.AI,
        false,
      );
    }
    logger.debug(`Job ${threadResponse.id} chart is finalized, removing`);
    delete this.tasks[threadResponse.id];
    delete this.nextPollAt[threadResponse.id];
    delete this.pollDelay[threadResponse.id];
  }
}

export class ChartAdjustmentBackgroundTracker {
  private tasks: Record<number, ThreadResponse> = {};
  private nextPollAt: Record<number, number> = {};
  private pollDelay: Record<number, number> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private runningJobs = new Set();
  private telemetry: PostHogTelemetry;

  constructor({
    telemetry,
    wrenAIAdaptor,
    threadResponseRepository,
  }: {
    telemetry: PostHogTelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
  }) {
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.intervalTime = 2000;
    this.start();
  }

  private start() {
    logger.info('Chart adjustment background tracker started');
    setInterval(() => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          // check if same job is running
          if (this.runningJobs.has(threadResponse.id)) {
            return;
          }

          if (Date.now() < (this.nextPollAt[threadResponse.id] || 0)) {
            return;
          }

          // mark the job as running
          this.runningJobs.add(threadResponse.id);

          // get the chart detail
          const chartDetail = threadResponse.chartDetail;

          // get the latest result from AI service
          const result = await this.wrenAIAdaptor.getChartAdjustmentResult(
            chartDetail.queryId,
          );

          const statusChanged = chartDetail.status !== result.status;
          this.scheduleNextPoll(threadResponse.id, result.status, statusChanged);

          if (isFinalized(result.status) && !statusChanged) {
            this.finalizeTask(threadResponse, result);
            this.runningJobs.delete(threadResponse.id);
            return;
          }

          // check if status change
          if (!statusChanged) {
            // mark the job as finished
            logger.debug(
              `Job ${threadResponse.id} chart status not changed, finished`,
            );
            this.runningJobs.delete(threadResponse.id);
            return;
          }

          // update database
          const updatedChartDetail = {
            queryId: chartDetail.queryId,
            status: result?.status,
            error: result?.error,
            description: result?.response?.reasoning,
            chartType: result?.response?.chartType?.toUpperCase() || null,
            chartSchema: result?.response?.chartSchema,
            adjustment: true,
          };
          logger.debug(
            `Job ${threadResponse.id} chart status changed, updating`,
          );
          await this.threadResponseRepository.updateOne(threadResponse.id, {
            chartDetail: updatedChartDetail,
          });
          threadResponse.chartDetail = updatedChartDetail;

          // remove the task from tracker if it is finalized
          if (isFinalized(result.status)) {
            this.finalizeTask(threadResponse, result);
          }

          // mark the job as finished
          this.runningJobs.delete(threadResponse.id);
        },
      );

      // run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(threadResponse: ThreadResponse) {
    this.tasks[threadResponse.id] = threadResponse;
    this.nextPollAt[threadResponse.id] = Date.now();
    this.pollDelay[threadResponse.id] = MIN_POLL_DELAY;
  }

  public getTasks() {
    return this.tasks;
  }

  private scheduleNextPoll(
    taskId: number,
    status: ChartStatus,
    resultChanged: boolean,
  ) {
    if (isFinalized(status)) {
      this.nextPollAt[taskId] = Number.MAX_SAFE_INTEGER;
      return;
    }

    const baseDelay = status === ChartStatus.FETCHING ? MIN_POLL_DELAY : 3000;
    this.pollDelay[taskId] = resultChanged
      ? baseDelay
      : Math.min(
          Math.max((this.pollDelay[taskId] || baseDelay) * 1.5, baseDelay),
          MAX_POLL_DELAY,
        );
    this.nextPollAt[taskId] = Date.now() + this.pollDelay[taskId];
  }

  private finalizeTask(threadResponse: ThreadResponse, result) {
    const eventProperties = {
      question: threadResponse.question,
      error: result.error,
    };
    if (result.status === ChartStatus.FINISHED) {
      this.telemetry.sendEvent(
        TelemetryEvent.HOME_ANSWER_ADJUST_CHART,
        eventProperties,
      );
    } else {
      this.telemetry.sendEvent(
        TelemetryEvent.HOME_ANSWER_ADJUST_CHART,
        eventProperties,
        WrenService.AI,
        false,
      );
    }
    logger.debug(`Job ${threadResponse.id} chart is finalized, removing`);
    delete this.tasks[threadResponse.id];
    delete this.nextPollAt[threadResponse.id];
    delete this.pollDelay[threadResponse.id];
  }
}
