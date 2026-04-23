import { RecommendationQuestionStatus } from '@server/models/adaptor';
import { IWrenAIAdaptor } from '../adaptors/wrenAIAdaptor';
import { IThreadResponseRepository, ThreadResponse } from '../repositories';
import {
  ITelemetry,
  TelemetryEvent,
  WrenService,
} from '../telemetry/telemetry';
import { getLogger } from '../utils/logger';
import { Logger } from 'log4js';
import { registerShutdownCallback } from '@server/utils/shutdown';
import { toStructuredRecommendationItem } from '../services/recommendationIntelligence';

// TRR background tracker: thread response recommend question background tracker
const loggerPrefix = 'TRRBT:';

const isFinalized = (status: RecommendationQuestionStatus) => {
  return [
    RecommendationQuestionStatus.FINISHED,
    RecommendationQuestionStatus.FAILED,
  ].includes(status);
};

const toRecommendationItems = (
  questions:
    | Array<{
        category?: string | null;
        interactionMode?: 'draft_to_composer' | 'execute_intent' | null;
        interaction_mode?: 'draft_to_composer' | 'execute_intent' | null;
        label?: string | null;
        prompt?: string | null;
        question?: string | null;
        sql?: string | null;
        suggestedIntent?: 'ASK' | 'CHART' | 'RECOMMEND_QUESTIONS' | null;
        suggested_intent?: 'ASK' | 'CHART' | 'RECOMMEND_QUESTIONS' | null;
      }>
    | undefined,
) =>
  (questions || [])
    .map((item) => toStructuredRecommendationItem(item))
    .filter(
      (
        item,
      ): item is NonNullable<
        ReturnType<typeof toStructuredRecommendationItem>
      > => Boolean(item),
    );

export class ThreadResponseRecommendQuestionBackgroundTracker {
  private tasks: Record<number, ThreadResponse> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadResponseRepository: IThreadResponseRepository;
  private runningJobs = new Set<number>();
  private telemetry: ITelemetry;
  private logger: Logger;
  private pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  private unregisterShutdown?: () => void;

  constructor({
    telemetry,
    wrenAIAdaptor,
    threadResponseRepository,
  }: {
    telemetry: ITelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    threadResponseRepository: IThreadResponseRepository;
  }) {
    this.logger = getLogger('TRR Background Tracker');
    this.logger.level = 'debug';
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadResponseRepository = threadResponseRepository;
    this.intervalTime = 1000;
    this.start();
  }

  public start() {
    if (this.pollingIntervalId) {
      return;
    }

    this.logger.info(
      'Thread response recommendation background tracker started',
    );
    this.pollingIntervalId = setInterval(() => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          const taskId = this.taskKey(threadResponse);
          if (this.runningJobs.has(taskId)) {
            return;
          }

          this.runningJobs.add(taskId);

          try {
            const queryId = threadResponse.recommendationDetail?.queryId;
            if (!queryId) {
              this.logger.debug(
                `${loggerPrefix}response job ${taskId} missing queryId, removing`,
              );
              delete this.tasks[taskId];
              return;
            }

            const result =
              await this.wrenAIAdaptor.getRecommendationQuestionsResult(
                queryId,
              );
            const nextItems = toRecommendationItems(result.response?.questions);
            const currentItems =
              threadResponse.recommendationDetail?.items || [];
            const hasChanged =
              threadResponse.recommendationDetail?.status !== result.status ||
              currentItems.length !== nextItems.length ||
              JSON.stringify(currentItems) !== JSON.stringify(nextItems) ||
              JSON.stringify(
                threadResponse.recommendationDetail?.error || null,
              ) !== JSON.stringify(result.error || null);

            if (!hasChanged) {
              this.logger.debug(
                `${loggerPrefix}response job ${taskId} status not changed, returning item count: ${nextItems.length}`,
              );
              return;
            }

            const updatedResponse =
              await this.threadResponseRepository.updateOne(threadResponse.id, {
                recommendationDetail: {
                  ...(threadResponse.recommendationDetail || {
                    items: [],
                  }),
                  queryId,
                  status: result.status.toUpperCase(),
                  items: nextItems,
                  error: result.error || undefined,
                  sourceResponseId:
                    threadResponse.recommendationDetail?.sourceResponseId ??
                    threadResponse.sourceResponseId ??
                    null,
                },
              });

            threadResponse.recommendationDetail =
              updatedResponse?.recommendationDetail;

            if (isFinalized(result.status)) {
              const eventProperties = {
                threadResponseId: threadResponse.id,
                sourceResponseId:
                  threadResponse.recommendationDetail?.sourceResponseId ??
                  threadResponse.sourceResponseId ??
                  null,
                status: result.status,
                items: nextItems,
                error: result.error,
              };
              if (result.status === RecommendationQuestionStatus.FINISHED) {
                this.telemetry.sendEvent(
                  TelemetryEvent.HOME_RECOMMENDATION_GENERATED,
                  eventProperties,
                );
                this.telemetry.sendEvent(
                  TelemetryEvent.HOME_GENERATE_THREAD_RECOMMENDATION_QUESTIONS,
                  eventProperties,
                );
              } else {
                this.telemetry.sendEvent(
                  TelemetryEvent.HOME_RECOMMENDATION_GENERATED,
                  eventProperties,
                  WrenService.AI,
                  false,
                );
                this.telemetry.sendEvent(
                  TelemetryEvent.HOME_GENERATE_THREAD_RECOMMENDATION_QUESTIONS,
                  eventProperties,
                  WrenService.AI,
                  false,
                );
              }
              this.logger.debug(
                `${loggerPrefix}response job ${taskId} is finalized, removing`,
              );
              delete this.tasks[taskId];
            }
          } finally {
            this.runningJobs.delete(taskId);
          }
        },
      );

      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
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

  public addTask(threadResponse: ThreadResponse) {
    this.tasks[this.taskKey(threadResponse)] = threadResponse;
  }

  public getTasks() {
    return this.tasks;
  }

  public async initialize() {
    const threadResponses =
      await this.threadResponseRepository.findUnfinishedRecommendationResponses();
    for (const threadResponse of threadResponses) {
      if (
        !this.tasks[this.taskKey(threadResponse)] &&
        threadResponse.recommendationDetail?.queryId &&
        !isFinalized(
          threadResponse.recommendationDetail
            ?.status as RecommendationQuestionStatus,
        )
      ) {
        this.addTask(threadResponse);
      }
    }
  }

  public taskKey(threadResponse: ThreadResponse) {
    return threadResponse.id;
  }

  public isExist(threadResponse: ThreadResponse) {
    return this.tasks[this.taskKey(threadResponse)];
  }
}
