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
import { registerShutdownCallback } from '@server/utils/shutdown';
import { toPersistedRuntimeIdentityFromSource } from '@server/utils/persistedRuntimeIdentity';
import { canonicalizeChartSchema } from '@/utils/chartSpecRuntime';
import * as Errors from '@server/utils/error';
import { deriveChartThinkingTrace } from '@server/services/chartThinking';

const logger = getLogger('ChartBackgroundTracker');
logger.level = 'debug';

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const POLLING_LEASE_TTL_MS = 8_000;

const isFinalized = (status: ChartStatus) => {
  return (
    status === ChartStatus.FINISHED ||
    status === ChartStatus.FAILED ||
    status === ChartStatus.STOPPED
  );
};

const toErrorPayload = (error: unknown) => {
  if (error && typeof error === 'object') {
    return error as Record<string, unknown>;
  }
  return { message: String(error) };
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
};

const toErrorCode = (error: unknown) => {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return null;
};

const normalizeChartErrorCode = ({
  rawCode,
  hasInvalidSchema,
}: {
  rawCode?: string | null;
  hasInvalidSchema?: boolean;
}) => {
  if (hasInvalidSchema) {
    return Errors.GeneralErrorCodes.CHART_SCHEMA_INVALID;
  }
  if (
    rawCode === 'AI_NO_CHART' ||
    rawCode === Errors.GeneralErrorCodes.NO_CHART
  ) {
    return Errors.GeneralErrorCodes.AI_NO_CHART;
  }
  if (rawCode === 'UPSTREAM_DATA_ERROR') {
    return Errors.GeneralErrorCodes.UPSTREAM_DATA_ERROR;
  }
  return rawCode || null;
};

const computeBackoffMs = (retryCount: number) => {
  return Math.min(
    BASE_BACKOFF_MS * 2 ** Math.max(retryCount - 1, 0),
    MAX_BACKOFF_MS,
  );
};

abstract class BaseChartBackgroundTracker {
  protected tasks: Record<number, ThreadResponse> = {};
  protected intervalTime: number;
  protected wrenAIAdaptor: IWrenAIAdaptor;
  protected threadResponseRepository: IThreadResponseRepository;
  protected runningJobs = new Set<number>();
  protected telemetry: PostHogTelemetry;
  protected pollingIntervalId: ReturnType<typeof setInterval> | null = null;
  protected unregisterShutdown?: () => void;
  protected workerId: string;

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
    this.intervalTime = 1000;
    this.workerId = `${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
    this.start();
  }

  protected abstract getTrackerName(): string;
  protected abstract getTelemetryEvent(): TelemetryEvent;
  protected abstract fetchResult(
    queryId: string,
  ): ReturnType<IWrenAIAdaptor['getChartResult']>;
  protected abstract isAdjustmentTracker(): boolean;

  private start() {
    if (this.pollingIntervalId) {
      return;
    }
    logger.info(`${this.getTrackerName()} started`);
    this.pollingIntervalId = setInterval(() => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          if (this.runningJobs.has(threadResponse.id)) {
            return;
          }

          const chartDetail = threadResponse.chartDetail;
          if (!chartDetail?.queryId) {
            delete this.tasks[threadResponse.id];
            return;
          }

          const nextRetryAt = chartDetail.nextRetryAt
            ? Date.parse(chartDetail.nextRetryAt)
            : null;
          if (
            nextRetryAt &&
            Number.isFinite(nextRetryAt) &&
            nextRetryAt > Date.now()
          ) {
            return;
          }

          this.runningJobs.add(threadResponse.id);
          let activeResponse = threadResponse;
          try {
            const leaseClaim =
              await this.threadResponseRepository.claimChartPollingLease?.(
                threadResponse.id,
                toPersistedRuntimeIdentityFromSource(threadResponse),
                this.workerId,
                new Date(Date.now() + POLLING_LEASE_TTL_MS).toISOString(),
              );
            if (
              this.threadResponseRepository.claimChartPollingLease &&
              !leaseClaim
            ) {
              return;
            }

            const trackedResponse = leaseClaim || threadResponse;
            activeResponse = trackedResponse;
            const trackedChartDetail = trackedResponse.chartDetail;
            if (!trackedChartDetail?.queryId) {
              delete this.tasks[threadResponse.id];
              return;
            }

            const previousChartInstructionCount = (() => {
              const count = trackedChartDetail.thinking?.steps.find(
                (step) => step.key === 'chart.chart_instructions_retrieved',
              )?.messageParams?.count;
              return typeof count === 'number' ? count : 0;
            })();

            const result = await this.fetchResult(trackedChartDetail.queryId);
            const shouldCanonicalize =
              !!result?.response?.chartSchema &&
              (!trackedChartDetail.rawChartSchema ||
                !trackedChartDetail.canonicalizationVersion);
            const statusChanged = trackedChartDetail.status !== result.status;
            const instructionCountChanged =
              typeof result.instructionCount === 'number' &&
              result.instructionCount !== previousChartInstructionCount;

            if (
              !statusChanged &&
              !shouldCanonicalize &&
              !instructionCountChanged
            ) {
              this.tasks[threadResponse.id] = {
                ...trackedResponse,
                chartDetail: {
                  ...trackedChartDetail,
                  lastPolledAt: new Date().toISOString(),
                },
              };
              logger.debug(
                `Job ${threadResponse.id} chart status not changed, finished`,
              );
              return;
            }

            const {
              canonicalChartSchema,
              canonicalizationVersion,
              renderHints,
              validationErrors,
            } = canonicalizeChartSchema(result?.response?.chartSchema);
            const hasInvalidSchema =
              result.status === ChartStatus.FINISHED &&
              !!result?.response?.chartSchema &&
              !canonicalChartSchema;
            const normalizedErrorCode = normalizeChartErrorCode({
              rawCode: result.error?.code || null,
              hasInvalidSchema,
            });
            const normalizedStatus = hasInvalidSchema
              ? ChartStatus.FAILED
              : result.status;
            const normalizedError = hasInvalidSchema
              ? Errors.create(Errors.GeneralErrorCodes.CHART_SCHEMA_INVALID)
              : result.error
                ? Errors.create(
                    (normalizedErrorCode ||
                      Errors.GeneralErrorCodes
                        .AI_SERVICE_UNDEFINED_ERROR) as Errors.GeneralErrorCodes,
                    {
                      customMessage: result.error.message,
                    },
                  )
                : undefined;
            const updatedChartDetail = {
              ...trackedChartDetail,
              diagnostics: {
                ...(trackedChartDetail.diagnostics || {}),
                lastErrorCode: normalizedErrorCode || null,
                lastErrorMessage:
                  normalizedError?.message ||
                  result.error?.message ||
                  (hasInvalidSchema
                    ? Errors.errorMessages[
                        Errors.GeneralErrorCodes.CHART_SCHEMA_INVALID
                      ]
                    : null),
                finalizedAt: isFinalized(normalizedStatus)
                  ? new Date().toISOString()
                  : trackedChartDetail.diagnostics?.finalizedAt || null,
              },
              queryId: trackedChartDetail.queryId,
              status: normalizedStatus,
              error: normalizedError || undefined,
              lastError:
                normalizedError?.message || result.error?.message || null,
              lastPolledAt: new Date().toISOString(),
              nextRetryAt: null,
              retryCount: 0,
              description: result?.response?.reasoning,
              chartType:
                result?.response?.chartType?.toUpperCase() ||
                trackedChartDetail.chartType,
              rawChartSchema:
                result?.response?.chartSchema ||
                trackedChartDetail.rawChartSchema,
              chartSchema:
                canonicalChartSchema ||
                result?.response?.chartSchema ||
                trackedChartDetail.chartSchema,
              canonicalizationVersion,
              renderHints: renderHints || undefined,
              validationErrors,
              adjustment: this.isAdjustmentTracker(),
              pollingLeaseOwner: null,
              pollingLeaseExpiresAt: null,
            };
            const persistedChartDetail = {
              ...updatedChartDetail,
              thinking: deriveChartThinkingTrace(updatedChartDetail, {
                chartInstructionsCount:
                  result.instructionCount ?? previousChartInstructionCount,
                previousThinking: trackedChartDetail.thinking,
              }),
            };
            logger.debug(
              `Job ${threadResponse.id} chart status changed, updating`,
            );
            const updatedThreadResponse =
              await this.threadResponseRepository.updateOneByIdWithRuntimeScope(
                trackedResponse.id,
                toPersistedRuntimeIdentityFromSource(trackedResponse),
                {
                  chartDetail: persistedChartDetail,
                },
              );
            if (!updatedThreadResponse) {
              delete this.tasks[threadResponse.id];
              throw new Error(
                `Thread response ${threadResponse.id} no longer matches the tracked runtime scope`,
              );
            }
            this.tasks[threadResponse.id] = updatedThreadResponse;

            if (isFinalized(normalizedStatus)) {
              if (normalizedStatus === ChartStatus.FAILED) {
                logger.warn(
                  `Chart job ${threadResponse.id} failed (queryId=${trackedChartDetail.queryId}): code=${
                    normalizedErrorCode || 'UNKNOWN'
                  } message=${
                    normalizedError?.message ||
                    result.error?.message ||
                    'unknown'
                  } columns=${
                    trackedChartDetail.diagnostics?.previewColumnCount ?? 'n/a'
                  } rows=${
                    trackedChartDetail.diagnostics?.previewRowCount ?? 'n/a'
                  }`,
                );
              }
              const eventProperties = {
                question: trackedResponse.question,
                error: normalizedError || result.error,
              };
              if (normalizedStatus === ChartStatus.FINISHED) {
                this.telemetry.sendEvent(
                  this.getTelemetryEvent(),
                  eventProperties,
                );
              } else {
                this.telemetry.sendEvent(
                  this.getTelemetryEvent(),
                  eventProperties,
                  WrenService.AI,
                  false,
                );
              }
              logger.debug(
                `Job ${threadResponse.id} chart is finalized, removing`,
              );
              delete this.tasks[threadResponse.id];
            }
          } catch (error) {
            logger.error(`Job ${threadResponse.id} failed: ${error}`);
            await this.handleTaskFailure(activeResponse, error);
          } finally {
            this.runningJobs.delete(threadResponse.id);
          }
        },
      );

      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
    this.unregisterShutdown = registerShutdownCallback(() => this.stop());
  }

  private async handleTaskFailure(
    threadResponse: ThreadResponse,
    error: unknown,
  ) {
    const chartDetail = threadResponse.chartDetail;
    if (!chartDetail?.queryId) {
      delete this.tasks[threadResponse.id];
      return;
    }

    const retryCount = (chartDetail.retryCount || 0) + 1;
    const shouldFinalize = retryCount >= MAX_RETRIES;
    const nextRetryAt = shouldFinalize
      ? null
      : new Date(Date.now() + computeBackoffMs(retryCount)).toISOString();
    const failedChartDetail = {
      ...chartDetail,
      diagnostics: {
        ...(chartDetail.diagnostics || {}),
        lastErrorCode: toErrorCode(error),
        lastErrorMessage: toErrorMessage(error),
        finalizedAt: shouldFinalize
          ? new Date().toISOString()
          : chartDetail.diagnostics?.finalizedAt || null,
      },
      status: shouldFinalize ? ChartStatus.FAILED : chartDetail.status,
      error: shouldFinalize ? toErrorPayload(error) : chartDetail.error,
      lastError: toErrorMessage(error),
      retryCount,
      nextRetryAt,
      lastPolledAt: new Date().toISOString(),
      adjustment: this.isAdjustmentTracker(),
      pollingLeaseOwner: null,
      pollingLeaseExpiresAt: null,
    };
    const persistedFailedChartDetail = {
      ...failedChartDetail,
      thinking: deriveChartThinkingTrace(failedChartDetail, {
        previousThinking: chartDetail.thinking,
      }),
    };

    const updatedThreadResponse =
      await this.threadResponseRepository.updateOneByIdWithRuntimeScope(
        threadResponse.id,
        toPersistedRuntimeIdentityFromSource(threadResponse),
        {
          chartDetail: persistedFailedChartDetail,
        },
      );

    if (!updatedThreadResponse || shouldFinalize) {
      if (shouldFinalize) {
        logger.error(
          `Chart job ${threadResponse.id} finalized after retries (queryId=${
            chartDetail.queryId
          }): ${toErrorMessage(error)}`,
        );
      }
      delete this.tasks[threadResponse.id];
      return;
    }

    this.tasks[threadResponse.id] = updatedThreadResponse;
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
    this.tasks[threadResponse.id] = threadResponse;
  }

  public getTasks() {
    return this.tasks;
  }
}

export class ChartBackgroundTracker extends BaseChartBackgroundTracker {
  protected getTrackerName() {
    return 'Chart background tracker';
  }

  protected getTelemetryEvent() {
    return TelemetryEvent.HOME_ANSWER_CHART;
  }

  protected fetchResult(queryId: string) {
    return this.wrenAIAdaptor.getChartResult(queryId);
  }

  protected isAdjustmentTracker() {
    return false;
  }
}

export class ChartAdjustmentBackgroundTracker extends BaseChartBackgroundTracker {
  protected getTrackerName() {
    return 'Chart adjustment background tracker';
  }

  protected getTelemetryEvent() {
    return TelemetryEvent.HOME_ANSWER_ADJUST_CHART;
  }

  protected fetchResult(queryId: string) {
    return this.wrenAIAdaptor.getChartAdjustmentResult(queryId);
  }

  protected isAdjustmentTracker() {
    return true;
  }
}
