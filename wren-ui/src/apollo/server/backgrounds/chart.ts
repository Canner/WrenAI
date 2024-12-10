import { ChartStatus } from '@server/models/adaptor';
import { IWrenAIAdaptor } from '@server/adaptors/wrenAIAdaptor';
import {
  IThreadResponseRepository,
  ThreadResponse,
} from '@server/repositories';
import { getLogger } from '@server/utils/logger';

const logger = getLogger('ChartBackgroundTracker');
logger.level = 'debug';

const isFinalized = (status: ChartStatus) => {
  return (
    status === ChartStatus.FINISHED ||
    status === ChartStatus.FAILED ||
    status === ChartStatus.STOPPED
  );
};

export class ChartBackgroundTracker {
  private tasks: Record<number, ThreadResponse> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private runningJobs = new Set();

  constructor({
    wrenAIAdaptor,
    threadResponseRepository,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.intervalTime = 1000;
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

          // mark the job as running
          this.runningJobs.add(threadResponse.id);

          // get the chart detail
          const chartDetail = threadResponse.chartDetail;

          // get the latest result from AI service
          const result = await this.wrenAIAdaptor.getChartResult(
            chartDetail.queryId,
          );

          // check if status change
          if (chartDetail.status === result.status) {
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
            chartSchema: result?.response?.chartSchema,
          };
          logger.debug(
            `Job ${threadResponse.id} chart status changed, updating`,
          );
          await this.threadResponseRepository.updateOne(threadResponse.id, {
            chartDetail: updatedChartDetail,
          });

          // remove the task from tracker if it is finalized
          if (isFinalized(result.status)) {
            logger.debug(
              `Job ${threadResponse.id} chart is finalized, removing`,
            );
            delete this.tasks[threadResponse.id];
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
  }

  public getTasks() {
    return this.tasks;
  }
}

export class ChartAdjustmentBackgroundTracker {
  private tasks: Record<number, ThreadResponse> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private runningJobs = new Set();

  constructor({
    wrenAIAdaptor,
    threadResponseRepository,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.intervalTime = 1000;
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

          // mark the job as running
          this.runningJobs.add(threadResponse.id);

          // get the chart detail
          const chartDetail = threadResponse.chartDetail;

          // get the latest result from AI service
          const result = await this.wrenAIAdaptor.getChartAdjustmentResult(
            chartDetail.queryId,
          );

          // check if status change
          if (chartDetail.status === result.status) {
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
            chartSchema: result?.response?.chartSchema,
          };
          logger.debug(
            `Job ${threadResponse.id} chart status changed, updating`,
          );
          await this.threadResponseRepository.updateOne(threadResponse.id, {
            chartDetail: updatedChartDetail,
          });

          // remove the task from tracker if it is finalized
          if (isFinalized(result.status)) {
            logger.debug(
              `Job ${threadResponse.id} chart is finalized, removing`,
            );
            delete this.tasks[threadResponse.id];
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
  }

  public getTasks() {
    return this.tasks;
  }
}
