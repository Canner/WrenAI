import {
  ExplainPipelineStatus,
  IWrenAIAdaptor,
} from '../adaptors/wrenAIAdaptor';
import {
  IThreadResponseExplainRepository,
  ThreadResponseExplain,
} from '../repositories/threadResponseExplainRepository';
import { Telemetry } from '../telemetry/telemetry';
import { BackgroundTracker } from './index';
import { getLogger } from '@server/utils/logger';

const logger = getLogger('ExplainBackgroundTracker');
logger.level = 'debug';

export class ThreadResponseExplainBackgroundTracker extends BackgroundTracker<ThreadResponseExplain> {
  // tasks is a kv pair of task id and thread response
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseExplainRepository: IThreadResponseExplainRepository;

  constructor({
    telemetry,
    wrenAIAdaptor,
    threadResponseExplainRepository,
  }: {
    telemetry: Telemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseExplainRepository: IThreadResponseExplainRepository;
  }) {
    super();
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseExplainRepository = threadResponseExplainRepository;
    this.intervalTime = 1000;
    this.start();
  }

  protected start() {
    logger.info('Explain Background tracker started');
    setInterval(() => {
      const jobs = Object.values(this.tasks).map(
        (threadResponseExplain) => async () => {
          // check if same job is running
          if (this.runningJobs.has(threadResponseExplain.id)) {
            return;
          }

          // mark the job as running
          this.runningJobs.add(threadResponseExplain.id);

          // get the latest result from AI service
          const result = await this.wrenAIAdaptor.getExplainResult(
            threadResponseExplain.queryId,
          );

          // check if status change
          if (threadResponseExplain.status === result.status) {
            // mark the job as finished
            logger.debug(
              `Explain job ${threadResponseExplain.id} status not changed, finished`,
            );
            this.runningJobs.delete(threadResponseExplain.id);
            return;
          }

          // update database
          logger.debug(
            `Explain job ${threadResponseExplain.id} status changed, updating`,
          );
          await this.threadResponseExplainRepository.updateOne(
            threadResponseExplain.id,
            {
              status: result.status,
              detail: result.response,
              error: result.error,
            },
          );

          // remove the task from tracker if it is finalized
          if (this.isFinalized(result.status)) {
            logger.debug(
              `Explain job ${threadResponseExplain.id} is finalized, removing`,
            );
            delete this.tasks[threadResponseExplain.id];
          }

          // mark the job as finished
          this.runningJobs.delete(threadResponseExplain.id);
          return result;
        },
      );

      // run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.telemetry.send_event('explain_job_failed', {
              status: result.status,
              reason: result.reason,
            });
            logger.error(`Explain Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(threadResponseExplain: ThreadResponseExplain) {
    this.tasks[threadResponseExplain.id] = threadResponseExplain;
  }

  public getTasks() {
    return this.tasks;
  }

  public isFinalized = (status: ExplainPipelineStatus) => {
    return (
      status === ExplainPipelineStatus.FAILED ||
      status === ExplainPipelineStatus.FINISHED
    );
  };
}
