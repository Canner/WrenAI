import {
  ChartStatus,
  type ThinkingStep,
  type ThinkingTrace,
} from '@server/models/adaptor';
import type { ThreadResponseChartDetail } from '@server/repositories/threadResponseRepositoryTypes';

const getMessageParamNumber = (
  step: ThinkingStep | undefined,
  key: string,
): number | null => {
  const value = step?.messageParams?.[key];
  return typeof value === 'number' ? value : null;
};

const findThinkingStep = (
  thinking: ThinkingTrace | null | undefined,
  keys: string[],
): ThinkingStep | undefined =>
  thinking?.steps?.find((step) => keys.includes(step.key));

const buildThinkingStep = ({
  key,
  status,
  messageParams,
  phase,
  detail,
  errorCode,
  tags,
}: {
  key: string;
  status: ThinkingStep['status'];
  messageParams?: ThinkingStep['messageParams'];
  phase?: string | null;
  detail?: string | null;
  errorCode?: string | null;
  tags?: string[] | null;
}): ThinkingStep => ({
  key,
  status,
  messageKey: key,
  ...(messageParams ? { messageParams } : {}),
  ...(phase ? { phase } : {}),
  ...(detail ? { detail } : {}),
  ...(errorCode ? { errorCode } : {}),
  ...(tags?.length ? { tags } : {}),
});

const buildThinkingTrace = (steps: ThinkingStep[]): ThinkingTrace => ({
  steps,
  currentStepKey:
    steps.find((step) => step.status === 'running')?.key ||
    steps.find((step) => step.status === 'failed')?.key ||
    null,
});

const getChartErrorCode = (
  chartDetail?: ThreadResponseChartDetail | null,
): string | null => {
  if (
    !chartDetail?.error ||
    typeof chartDetail.error !== 'object' ||
    !('code' in chartDetail.error) ||
    typeof chartDetail.error.code !== 'string'
  ) {
    return null;
  }

  return chartDetail.error.code;
};

export const deriveChartThinkingTrace = (
  chartDetail?: ThreadResponseChartDetail | null,
  options?: {
    previousThinking?: ThinkingTrace | null;
    sqlPairsCount?: number | null;
    sqlInstructionsCount?: number | null;
    chartInstructionsCount?: number | null;
  },
): ThinkingTrace | null => {
  if (!chartDetail) {
    return null;
  }

  const previousThinking = options?.previousThinking || chartDetail.thinking;
  const diagnostics = chartDetail.diagnostics || null;
  const previewRows = diagnostics?.previewRowCount || 0;
  const previewColumns = diagnostics?.previewColumnCount || 0;
  const previewColumnNames =
    diagnostics?.previewColumns
      ?.map((column) => column?.name)
      .filter(Boolean) || [];
  const chartabilityKnown =
    typeof chartDetail.chartability?.chartable === 'boolean';
  const chartable = chartabilityKnown
    ? chartDetail.chartability?.chartable
    : null;
  const errorCode = getChartErrorCode(chartDetail);
  const previewErrorCode = diagnostics?.lastErrorCode || null;
  const previewFailed =
    previewErrorCode === 'UPSTREAM_DATA_ERROR' ||
    errorCode === 'UPSTREAM_DATA_ERROR';
  const hasValidationFailure =
    errorCode === 'CHART_SCHEMA_INVALID' ||
    Boolean(chartDetail.validationErrors?.length);
  const validationMessage =
    chartDetail.validationErrors?.[0] ||
    (errorCode === 'CHART_SCHEMA_INVALID'
      ? ((chartDetail.error as { message?: string | null }).message ?? null)
      : null);

  const previousSqlPairsStep = findThinkingStep(previousThinking, [
    'chart.sql_pairs_retrieved',
    'ask.sql_pairs_retrieved',
  ]);
  const previousSqlInstructionsStep = findThinkingStep(previousThinking, [
    'chart.sql_instructions_retrieved',
    'ask.sql_instructions_retrieved',
  ]);
  const previousChartInstructionsStep = findThinkingStep(previousThinking, [
    'chart.chart_instructions_retrieved',
  ]);

  const sqlPairsCount =
    options?.sqlPairsCount ??
    getMessageParamNumber(previousSqlPairsStep, 'count') ??
    0;
  const sqlInstructionsCount =
    options?.sqlInstructionsCount ??
    getMessageParamNumber(previousSqlInstructionsStep, 'count') ??
    0;
  const chartInstructionsCount =
    options?.chartInstructionsCount ??
    getMessageParamNumber(previousChartInstructionsStep, 'count') ??
    0;

  const previewStatus: ThinkingStep['status'] = previewFailed
    ? 'failed'
    : diagnostics
      ? 'finished'
      : chartDetail.status === ChartStatus.FAILED && chartable === false
        ? 'finished'
        : chartDetail.status === ChartStatus.FAILED
          ? 'failed'
          : 'running';

  const retrievalStatus: ThinkingStep['status'] = 'finished';

  const intentStatus: ThinkingStep['status'] = 'finished';

  const chartInstructionStatus: ThinkingStep['status'] = 'finished';

  const chartTypeStatus: ThinkingStep['status'] = previewFailed
    ? 'skipped'
    : chartable === false
      ? 'failed'
      : chartDetail.chartType
        ? 'finished'
        : [ChartStatus.FETCHING, ChartStatus.GENERATING].includes(
              chartDetail.status as ChartStatus,
            )
          ? 'running'
          : hasValidationFailure
            ? chartDetail.rawChartSchema || chartDetail.chartSchema
              ? 'finished'
              : 'skipped'
            : chartDetail.status === ChartStatus.FAILED
              ? 'skipped'
              : 'pending';

  const generationStatus: ThinkingStep['status'] =
    chartDetail.status === ChartStatus.FINISHED
      ? 'finished'
      : previewStatus === 'failed'
        ? 'skipped'
        : chartable === false
          ? 'skipped'
          : chartDetail.status === ChartStatus.FAILED
            ? hasValidationFailure
              ? 'finished'
              : 'failed'
            : chartDetail.status === ChartStatus.GENERATING
              ? 'running'
              : 'pending';

  const validationStatus: ThinkingStep['status'] =
    chartDetail.status === ChartStatus.FINISHED
      ? 'finished'
      : hasValidationFailure
        ? 'failed'
        : previewStatus === 'failed' ||
            generationStatus === 'skipped' ||
            chartable === false
          ? 'skipped'
          : generationStatus === 'finished' &&
              ![ChartStatus.FINISHED, ChartStatus.FAILED].includes(
                chartDetail.status as ChartStatus,
              )
            ? 'running'
            : 'pending';

  return buildThinkingTrace([
    buildThinkingStep({
      key: 'chart.sql_pairs_retrieved',
      status: retrievalStatus,
      messageParams: {
        count: sqlPairsCount,
      },
      phase: 'retrieval',
    }),
    buildThinkingStep({
      key: 'chart.sql_instructions_retrieved',
      status: retrievalStatus,
      messageParams: {
        count: sqlInstructionsCount,
      },
      phase: 'retrieval',
    }),
    buildThinkingStep({
      key: 'chart.preview_data_fetched',
      status: previewStatus,
      messageParams: {
        rows: previewRows,
        columns: previewColumns,
      },
      phase: 'data',
      detail:
        previewStatus === 'failed'
          ? diagnostics?.lastErrorMessage || null
          : null,
      errorCode:
        previewStatus === 'failed' ? previewErrorCode || errorCode : null,
      tags: previewColumnNames.slice(0, 6),
    }),
    buildThinkingStep({
      key: 'chart.intent_recognized',
      status: intentStatus,
      phase: 'intent',
    }),
    buildThinkingStep({
      key: 'chart.chart_instructions_retrieved',
      status: chartInstructionStatus,
      messageParams: {
        count: chartInstructionsCount,
      },
      phase: 'retrieval',
    }),
    buildThinkingStep({
      key: 'chart.chart_intent_detected',
      status: intentStatus,
      phase: 'intent',
    }),
    buildThinkingStep({
      key: 'chart.chart_type_selected',
      status: chartTypeStatus,
      messageParams: {
        chartType: chartDetail.chartType || null,
      },
      phase: 'planning',
      detail:
        chartTypeStatus === 'failed'
          ? chartDetail.chartability?.message || chartDetail.description || null
          : chartDetail.description || null,
      errorCode: chartTypeStatus === 'failed' ? errorCode : null,
    }),
    buildThinkingStep({
      key: 'chart.chart_generated',
      status: generationStatus,
      phase: 'generation',
      detail:
        generationStatus === 'failed'
          ? ((chartDetail.error as { message?: string | null } | null)
              ?.message ??
            diagnostics?.lastErrorMessage ??
            null)
          : null,
      errorCode: generationStatus === 'failed' ? errorCode : null,
    }),
    buildThinkingStep({
      key: 'chart.chart_validated',
      status: validationStatus,
      messageParams: {
        canonicalizationVersion: chartDetail.canonicalizationVersion || null,
      },
      phase: 'validation',
      detail: validationStatus === 'finished' ? null : validationMessage,
      errorCode: validationStatus === 'failed' ? errorCode : null,
    }),
  ]);
};
