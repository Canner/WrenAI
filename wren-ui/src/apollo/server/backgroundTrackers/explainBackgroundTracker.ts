import {
  ExplainPipelineStatus,
  ExplanationType,
  IWrenAIAdaptor,
} from '../adaptors/wrenAIAdaptor';
import {
  ExplainDetail,
  IThreadResponseExplainRepository,
  ThreadResponseExplain,
} from '../repositories/threadResponseExplainRepository';
import {
  IThreadResponseRepository,
  ThreadResponseDetail,
} from '../repositories/threadResponseRepository';
import { Telemetry } from '../telemetry/telemetry';
import { GeneralErrorCodes } from '../utils/error';
import { findAnalysisById, reverseEnum } from '../utils';
import { BackgroundTracker } from './index';
import { getLogger } from '@server/utils/logger';

const logger = getLogger('ExplainBackgroundTracker');
logger.level = 'debug';

export class ThreadResponseExplainBackgroundTracker extends BackgroundTracker<ThreadResponseExplain> {
  // tasks is a kv pair of task id and thread response
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private threadResponseExplainRepository: IThreadResponseExplainRepository;

  constructor({
    telemetry,
    wrenAIAdaptor,
    threadResponseRepository,
    threadResponseExplainRepository,
  }: {
    telemetry: Telemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
    threadResponseExplainRepository: IThreadResponseExplainRepository;
  }) {
    super();
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
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

          // if status not changed, early return
          if (threadResponseExplain.status === result.status) {
            logger.debug(
              `Explain job ${threadResponseExplain.id} status not changed, skipping`,
            );
            this.runningJobs.delete(threadResponseExplain.id);
            return;
          }

          // update database
          logger.debug(
            `Explain job ${threadResponseExplain.id} status changed to "${result.status}", updating`,
          );

          const updatedExplain =
            await this.threadResponseExplainRepository.updateOne(
              threadResponseExplain.id,
              {
                status: result.status,
                detail: result.response,
                error: result.error,
              },
            );
          this.tasks[threadResponseExplain.id] = updatedExplain;

          // remove the task from tracker if it is finalized
          if (this.isFinalized(result.status)) {
            logger.debug(
              `Explain job ${threadResponseExplain.id} is finalized`,
            );
            if (this.isSucceed(result.status)) {
              try {
                await this.mergeExplanationIntoThreadResponse(
                  threadResponseExplain.id,
                );
                logger.debug(`Explain job ${threadResponseExplain.id} done`);
              } catch (error: any) {
                logger.error(
                  `Explain job ${threadResponseExplain.id} merge failed: ${error}`,
                );
                await this.threadResponseExplainRepository.updateOne(
                  threadResponseExplain.id,
                  {
                    error: {
                      code: GeneralErrorCodes.MERGE_THREAD_RESPONSE_ERROR,
                      message:
                        typeof error === 'object'
                          ? JSON.stringify(error)
                          : error,
                    },
                  },
                );
              }
            }
            delete this.tasks[threadResponseExplain.id];
            logger.debug(`Explain job ${threadResponseExplain.id} deleted`);
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
    const _status = status.toUpperCase();
    return (
      _status === ExplainPipelineStatus.FAILED ||
      _status === ExplainPipelineStatus.FINISHED
    );
  };

  public isSucceed = (status: ExplainPipelineStatus) => {
    return status.toUpperCase() === ExplainPipelineStatus.FINISHED;
  };

  private async mergeExplanationIntoThreadResponse(threadResponseExplainId) {
    const threadResponseExplain =
      await this.threadResponseExplainRepository.findOneBy({
        id: threadResponseExplainId,
      });
    const threadResponse = await this.threadResponseRepository.findOneBy({
      id: threadResponseExplain.threadResponseId,
    });
    logger.debug(
      `Start Merging explanation ${threadResponseExplain.id} into thread response ${threadResponse.id}`,
    );
    // merge explain response to thread response
    const detailWithExplanation = this.mergeExplanationToThreadResponseDetail(
      threadResponse.detail,
      threadResponseExplain.detail,
      threadResponseExplain.analysis,
    );
    logger.debug(
      `Merge explanation ${threadResponseExplain.id} into thread response ${threadResponse.id} completed`,
    );
    await this.threadResponseRepository.updateOne(threadResponse.id, {
      detail: detailWithExplanation as any,
    });
    logger.debug(`ThreadResponse ${threadResponse.id} detail updated`);
  }

  // reorder explanation id and attach sql location to each explanation
  // then attach the explanation to the thread response detail
  private mergeExplanationToThreadResponseDetail(
    detail: ThreadResponseDetail,
    explanations: ExplainDetail[],
    analyses: object,
  ) {
    const toReferenceType = reverseEnum(ExplanationType);
    // reorder reference id
    let id = 1;
    const steps = Object.entries(detail.steps).map(([stepId, step]) => {
      const analysesOfStep = analyses[stepId];
      const explanationOfStep = explanations[stepId];
      const references = explanationOfStep.map((explanation) => {
        const analysis = findAnalysisById(
          analysesOfStep,
          Number(explanation.payload.id),
        );
        // remove previous id
        const payload = { ...explanation.payload };
        delete payload.id;
        return {
          referenceId: id++,
          type: toReferenceType[explanation.type],
          sqlSnippet:
            (explanation.payload as any).expression ||
            (explanation.payload as any).criteria ||
            (analysis as any).tableName,
          summary: explanation.payload.explanation || '',
          sqlLocation: analysis ? analysis.nodeLocation : null,
        };
      });

      return {
        ...step,
        references,
      };
    });
    return {
      ...detail,
      steps,
    };
  }
}
