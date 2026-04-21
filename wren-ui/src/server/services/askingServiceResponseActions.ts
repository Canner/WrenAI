import { PreviewDataResponse } from './queryService';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  ThreadResponse,
  ThreadResponseAdjustmentType,
} from '../repositories/threadResponseRepository';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import { resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback } from '@server/utils/persistedRuntimeIdentity';
import {
  AskResultStatus,
  ChartAdjustmentOption,
  ChartStatus,
} from '@server/models/adaptor';
import {
  AdjustmentReasoningInput,
  AdjustmentSqlInput,
  CHART_GENERATION_SAMPLE_LIMIT,
  constructCteSql,
  ThreadResponseAnswerStatus,
} from './askingServiceShared';
import { TelemetryEvent } from '../telemetry/telemetry';
import {
  applyDeterministicChartAdjustment,
  shapeChartPreviewData,
} from '@/utils/chartSpecRuntime';
import { isEqual } from 'lodash';
import { logger } from './askingServiceShared';

interface AskingServiceResponseLike {
  wrenAIAdaptor: any;
  threadResponseRepository: any;
  breakdownBackgroundTracker: any;
  textBasedAnswerBackgroundTracker: any;
  chartBackgroundTracker: any;
  queryService: any;
  telemetry: any;
  adjustmentBackgroundTracker: any;
  getResponse(responseId: number): Promise<ThreadResponse | null>;
  getThreadResponseRuntimeIdentity(
    threadResponse: ThreadResponse,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ): Promise<PersistedRuntimeIdentity>;
  getExecutionResources(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<any>;
  toAskRuntimeIdentity(runtimeIdentity?: PersistedRuntimeIdentity | null): any;
  buildAskTaskRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
    deployHash?: string | null,
  ): any;
}

export const generateThreadResponseBreakdownAction = async (
  service: AskingServiceResponseLike,
  threadResponseId: number,
  configurations: { language: string },
): Promise<ThreadResponse> => {
  const { language } = configurations;
  const threadResponse = await service.threadResponseRepository.findOneBy({
    id: threadResponseId,
  });
  if (!threadResponse) {
    throw new Error(`Thread response ${threadResponseId} not found`);
  }
  if (!threadResponse.sql) {
    throw new Error(`Thread response ${threadResponseId} has no SQL`);
  }

  const response = await service.wrenAIAdaptor.generateAskDetail({
    query: threadResponse.question,
    sql: threadResponse.sql,
    configurations: { language },
  });
  const updatedThreadResponse =
    await service.threadResponseRepository.updateOne(threadResponse.id, {
      breakdownDetail: {
        queryId: response.queryId,
        status: AskResultStatus.UNDERSTANDING,
      },
    });
  service.breakdownBackgroundTracker.addTask(updatedThreadResponse);
  return updatedThreadResponse;
};

export const generateThreadResponseAnswerAction = async (
  service: AskingServiceResponseLike,
  threadResponseId: number,
): Promise<ThreadResponse> => {
  const threadResponse = await service.threadResponseRepository.findOneBy({
    id: threadResponseId,
  });
  if (!threadResponse) {
    throw new Error(`Thread response ${threadResponseId} not found`);
  }

  const updatedThreadResponse =
    await service.threadResponseRepository.updateOne(threadResponse.id, {
      answerDetail: {
        status: ThreadResponseAnswerStatus.NOT_STARTED,
      },
    });
  service.textBasedAnswerBackgroundTracker.addTask(updatedThreadResponse);
  return updatedThreadResponse;
};

export const generateThreadResponseChartAction = async (
  service: AskingServiceResponseLike,
  threadResponseId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
  configurations: { language: string },
  runtimeScopeId?: string | null,
): Promise<ThreadResponse> => {
  const threadResponse = await service.threadResponseRepository.findOneBy({
    id: threadResponseId,
  });
  if (!threadResponse) {
    throw new Error(`Thread response ${threadResponseId} not found`);
  }
  if (!threadResponse.sql) {
    throw new Error(`Thread response ${threadResponseId} has no SQL`);
  }

  let previewDataSample: PreviewDataResponse | undefined;
  let chartDiagnostics:
    | {
        previewColumnCount: number;
        previewRowCount: number;
        previewColumns: Array<{ name: string; type?: string | null }>;
        submittedAt: string;
      }
    | undefined;
  try {
    const { project, manifest } =
      await service.getExecutionResources(runtimeIdentity);
    previewDataSample = (await service.queryService.preview(
      threadResponse.sql,
      {
        project,
        manifest,
        limit: CHART_GENERATION_SAMPLE_LIMIT,
        modelingOnly: false,
      },
    )) as PreviewDataResponse;
    chartDiagnostics = {
      previewColumnCount: previewDataSample.columns?.length || 0,
      previewRowCount: previewDataSample.data?.length || 0,
      previewColumns: (previewDataSample.columns || [])
        .slice(0, 8)
        .map((column) => ({
          name: column.name,
          type: column.type || null,
        })),
      submittedAt: new Date().toISOString(),
    };
    logger.info(
      `Chart request ${threadResponseId} prepared with ${chartDiagnostics.previewColumnCount} columns / ${chartDiagnostics.previewRowCount} rows`,
    );
  } catch (error) {
    logger.warn(
      `Unable to fetch chart sample data for response ${threadResponseId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const response = await service.wrenAIAdaptor.generateChart({
    query: threadResponse.question,
    sql: threadResponse.sql,
    data: previewDataSample,
    runtimeScopeId:
      runtimeScopeId ||
      resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
        runtimeIdentity,
      ) ||
      undefined,
    runtimeIdentity: service.toAskRuntimeIdentity(runtimeIdentity),
    configurations,
  });

  const updatedThreadResponse =
    await service.threadResponseRepository.updateOne(threadResponse.id, {
      chartDetail: {
        diagnostics: chartDiagnostics,
        queryId: response.queryId,
        status: ChartStatus.FETCHING,
      },
    });
  service.chartBackgroundTracker.addTask(updatedThreadResponse);
  return updatedThreadResponse;
};

export const adjustThreadResponseChartAction = async (
  service: AskingServiceResponseLike,
  threadResponseId: number,
  input: ChartAdjustmentOption,
): Promise<ThreadResponse> => {
  const threadResponse = await service.threadResponseRepository.findOneBy({
    id: threadResponseId,
  });
  if (!threadResponse) {
    throw new Error(`Thread response ${threadResponseId} not found`);
  }
  if (!threadResponse.sql) {
    throw new Error(`Thread response ${threadResponseId} has no SQL`);
  }
  if (!threadResponse.chartDetail?.chartSchema) {
    throw new Error(`Thread response ${threadResponseId} has no chart`);
  }

  return service.threadResponseRepository.updateOne(threadResponse.id, {
    chartDetail: applyDeterministicChartAdjustment(
      {
        ...threadResponse.chartDetail,
        status: ChartStatus.FINISHED,
      },
      input,
    ),
  });
};

export const previewDataAction = async (
  service: AskingServiceResponseLike,
  responseId: number,
  limit?: number,
  fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
) => {
  const response = await service.getResponse(responseId);
  if (!response) {
    throw new Error(`Thread response ${responseId} not found`);
  }
  if (!response.sql) {
    throw new Error(`Thread response ${responseId} has no SQL`);
  }
  const runtimeIdentity = await service.getThreadResponseRuntimeIdentity(
    response,
    fallbackRuntimeIdentity,
  );
  const { project, manifest } =
    await service.getExecutionResources(runtimeIdentity);
  const eventName = TelemetryEvent.HOME_PREVIEW_ANSWER;
  try {
    const rawData = (await service.queryService.preview(response.sql, {
      project,
      manifest,
      limit,
    })) as PreviewDataResponse;
    const shapedChartPreview = shapeChartPreviewData({
      chartDetail: response.chartDetail,
      previewData: rawData,
    });

    if (response.chartDetail) {
      const nextChartDetail = {
        ...response.chartDetail,
        renderHints:
          shapedChartPreview.renderHints || response.chartDetail.renderHints,
        chartDataProfile:
          shapedChartPreview.chartDataProfile ||
          response.chartDetail.chartDataProfile,
      };

      if (
        !isEqual(
          response.chartDetail.renderHints,
          nextChartDetail.renderHints,
        ) ||
        !isEqual(
          response.chartDetail.chartDataProfile,
          nextChartDetail.chartDataProfile,
        )
      ) {
        await service.threadResponseRepository.updateOneByIdWithRuntimeScope(
          response.id,
          runtimeIdentity,
          {
            chartDetail: nextChartDetail,
          },
        );
      }
    }

    const data = {
      ...shapedChartPreview.previewData,
      chartDataProfile:
        shapedChartPreview.chartDataProfile ||
        response.chartDetail?.chartDataProfile,
    } as PreviewDataResponse & {
      chartDataProfile?: Record<string, unknown>;
    };
    service.telemetry.sendEvent(eventName, { sql: response.sql });
    return data;
  } catch (err: any) {
    service.telemetry.sendEvent(
      eventName,
      { sql: response.sql, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const previewBreakdownDataAction = async (
  service: AskingServiceResponseLike,
  responseId: number,
  stepIndex?: number,
  limit?: number,
  fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
): Promise<PreviewDataResponse> => {
  const response = await service.getResponse(responseId);
  if (!response) {
    throw new Error(`Thread response ${responseId} not found`);
  }
  const runtimeIdentity = await service.getThreadResponseRuntimeIdentity(
    response,
    fallbackRuntimeIdentity,
  );
  const { project, manifest } =
    await service.getExecutionResources(runtimeIdentity);
  const steps = response?.breakdownDetail?.steps || [];
  const sql = safeFormatSQL(constructCteSql(steps, stepIndex));
  const eventName = TelemetryEvent.HOME_PREVIEW_ANSWER;
  try {
    const data = (await service.queryService.preview(sql, {
      project,
      manifest,
      limit,
    })) as PreviewDataResponse;
    service.telemetry.sendEvent(eventName, { sql });
    return data;
  } catch (err: any) {
    service.telemetry.sendEvent(
      eventName,
      { sql, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export const adjustThreadResponseWithSQLAction = async (
  service: AskingServiceResponseLike,
  threadResponseId: number,
  input: AdjustmentSqlInput,
  fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
): Promise<ThreadResponse> => {
  const response = await service.threadResponseRepository.findOneBy({
    id: threadResponseId,
  });
  if (!response) {
    throw new Error(`Thread response ${threadResponseId} not found`);
  }
  const runtimeIdentity = await service.getThreadResponseRuntimeIdentity(
    response,
    fallbackRuntimeIdentity,
  );
  return service.threadResponseRepository.createOne({
    ...runtimeIdentity,
    sql: input.sql,
    threadId: response.threadId,
    question: response.question,
    adjustment: {
      type: ThreadResponseAdjustmentType.APPLY_SQL,
      payload: {
        originalThreadResponseId: response.id,
        sql: input.sql,
      },
    },
  });
};

export const adjustThreadResponseAnswerAction = async (
  service: AskingServiceResponseLike,
  threadResponseId: number,
  input: AdjustmentReasoningInput,
  configurations: { language: string },
  runtimeScopeId?: string | null,
): Promise<ThreadResponse> => {
  const originalThreadResponse =
    await service.threadResponseRepository.findOneBy({
      id: threadResponseId,
    });
  if (!originalThreadResponse) {
    throw new Error(`Thread response ${threadResponseId} not found`);
  }
  if (!originalThreadResponse.sql) {
    throw new Error(`Thread response ${threadResponseId} has no SQL`);
  }

  const adjustmentRuntimeIdentity = input.runtimeIdentity
    ? service.buildAskTaskRuntimeIdentity(input.runtimeIdentity)
    : undefined;
  const { createdThreadResponse } =
    await service.adjustmentBackgroundTracker.createAdjustmentTask({
      threadId: originalThreadResponse.threadId,
      tables: input.tables,
      sqlGenerationReasoning: input.sqlGenerationReasoning,
      sql: originalThreadResponse.sql,
      runtimeScopeId:
        runtimeScopeId ||
        resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
          adjustmentRuntimeIdentity,
        ) ||
        undefined,
      runtimeIdentity: adjustmentRuntimeIdentity,
      configurations,
      question: originalThreadResponse.question,
      originalThreadResponseId: originalThreadResponse.id,
    });
  return createdThreadResponse;
};

export const rerunAdjustThreadResponseAnswerAction = async (
  service: AskingServiceResponseLike,
  threadResponseId: number,
  runtimeIdentity: PersistedRuntimeIdentity,
  configurations: { language: string },
  runtimeScopeId?: string | null,
): Promise<{ queryId: string }> => {
  const threadResponse = await service.threadResponseRepository.findOneBy({
    id: threadResponseId,
  });
  if (!threadResponse) {
    throw new Error(`Thread response ${threadResponseId} not found`);
  }
  const { queryId } =
    await service.adjustmentBackgroundTracker.rerunAdjustmentTask({
      threadId: threadResponse.threadId,
      threadResponseId,
      runtimeScopeId:
        runtimeScopeId ||
        resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
          runtimeIdentity,
        ) ||
        undefined,
      runtimeIdentity,
      configurations,
    });
  return { queryId };
};
