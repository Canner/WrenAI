import { AskResultStatus, IWrenAIAdaptor } from '../adaptors/wrenAIAdaptor';
import {
  IThreadResponseRepository,
  ThreadResponse,
} from '../repositories/threadResponseRepository';
import { Telemetry } from '../telemetry/telemetry';
import { BackgroundTracker } from './index';
import { getLogger } from '@server/utils/logger';

const logger = getLogger('ThreadResponseBackgroundTracker');
logger.level = 'debug';

export class ThreadResponseBackgroundTracker extends BackgroundTracker<ThreadResponse> {
  // tasks is a kv pair of task id and thread response
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;

  constructor({
    telemetry,
    wrenAIAdaptor,
    threadResponseRepository,
  }: {
    telemetry: Telemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
  }) {
    super();
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.start();
  }

  public start() {
    logger.info('Background tracker started');
    setInterval(() => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          // check if same job is running
          if (this.runningJobs.has(threadResponse.id)) {
            return;
          }

          // mark the job as running
          this.runningJobs.add(threadResponse.id);

          // get the latest result from AI service
          const result = await this.wrenAIAdaptor.getAskDetailResult(
            threadResponse.queryId,
          );

          // check if status change
          if (threadResponse.status === result.status) {
            // mark the job as finished
            logger.debug(
              `Job ${threadResponse.id} status not changed, finished`,
            );
            this.runningJobs.delete(threadResponse.id);
            return;
          }

          // update database
          logger.debug(`Job ${threadResponse.id} status changed, updating`);
          await this.threadResponseRepository.updateOne(threadResponse.id, {
            status: result.status,
            detail: result.response,
            error: result.error,
          });

          // remove the task from tracker if it is finalized
          if (this.isFinalized(result.status)) {
            this.telemetry.send_event('question_answered', {
              question: threadResponse.question,
              result,
            });
            logger.debug(`Job ${threadResponse.id} is finalized, removing`);
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

  private isFinalized = (status: AskResultStatus) => {
    return (
      status === AskResultStatus.FAILED ||
      status === AskResultStatus.FINISHED ||
      status === AskResultStatus.STOPPED
    );
  };
}
