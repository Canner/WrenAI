import type { PreviewDataResponse } from './queryService';

export type ChartabilityReasonCode =
  | 'EMPTY_RESULT_SET'
  | 'INSUFFICIENT_NUMERIC_FIELDS'
  | 'INSUFFICIENT_DATA_VARIATION'
  | 'UNSUPPORTED_RESULT_SHAPE';

export type ChartabilityResult = {
  chartable: boolean;
  reasonCode?: ChartabilityReasonCode | null;
  message?: string | null;
};

const NUMERIC_TYPE_PATTERN =
  /(int|integer|bigint|smallint|decimal|numeric|double|float|real|number)/i;

const isNumericType = (type?: string | null) =>
  typeof type === 'string' && NUMERIC_TYPE_PATTERN.test(type);

const getUniqueValueCount = (rows: unknown[][], columnIndex: number) =>
  new Set(rows.map((row) => row?.[columnIndex] ?? null)).size;

export const evaluateChartability = (
  previewData?: PreviewDataResponse | null,
): ChartabilityResult => {
  const payload: Partial<PreviewDataResponse> = previewData ?? {};
  const rows = Array.isArray(payload.data) ? (payload.data as unknown[][]) : [];
  const columns = Array.isArray(payload.columns) ? payload.columns : [];

  if (rows.length === 0) {
    return {
      chartable: false,
      reasonCode: 'EMPTY_RESULT_SET',
      message: '当前查询结果为空，暂时无法生成图表。',
    };
  }

  const numericColumns = columns.filter((column) => isNumericType(column.type));
  if (numericColumns.length === 0) {
    return {
      chartable: false,
      reasonCode: 'INSUFFICIENT_NUMERIC_FIELDS',
      message: '当前结果缺少可用于图表展示的数值字段。',
    };
  }

  if (columns.length < 2 || rows.length === 1) {
    return {
      chartable: false,
      reasonCode: 'UNSUPPORTED_RESULT_SHAPE',
      message: '当前结果更适合以表格方式查看。',
    };
  }

  const hasDimensionVariation = columns.some(
    (_, index) => getUniqueValueCount(rows, index) >= 2,
  );

  if (!hasDimensionVariation) {
    return {
      chartable: false,
      reasonCode: 'INSUFFICIENT_DATA_VARIATION',
      message: '当前结果缺少足够的维度变化，暂时不适合直接生成图表。',
    };
  }

  return {
    chartable: true,
    reasonCode: null,
    message: null,
  };
};
