import { ChartType, ThreadResponseChartDetail } from '@/types/api';
import { isNil } from 'lodash';

type EncodingChannel = 'x' | 'y' | 'color' | 'xOffset' | 'theta';

type EncodingAxisSpec = {
  type?: string;
  field?: string;
  title?: string;
  stack?: 'zero' | 'normalize' | null;
  [key: string]: unknown;
};

type EncodingSpec = Partial<Record<EncodingChannel, EncodingAxisSpec>> & {
  [key: string]: unknown;
};

export const convertToChartType = (
  markType?: string | null,
  encoding?: EncodingSpec,
) => {
  if (!markType) {
    return null;
  }

  const normalizedMarkType = markType.toLowerCase();
  if (normalizedMarkType === 'bar') {
    if (encoding?.xOffset) {
      return ChartType.GROUPED_BAR;
    }
    if (!isNil(encoding?.y?.stack) || !isNil(encoding?.x?.stack)) {
      return ChartType.STACKED_BAR;
    }
  }

  if (normalizedMarkType === 'arc') {
    return ChartType.PIE;
  }

  return normalizedMarkType.toUpperCase() as ChartType;
};

export const getChartSpecOptionValues = (
  chartDetail?: ThreadResponseChartDetail | null,
) => {
  const spec = chartDetail?.chartSchema;
  let chartType: string | null = chartDetail?.chartType || null;
  let xAxis: string | null = null;
  let yAxis: string | null = null;
  let color: string | null = null;
  let xOffset: string | null = null;
  let theta: string | null = null;

  if (spec && 'encoding' in spec) {
    const encoding = (spec.encoding || {}) as EncodingSpec;
    xAxis = encoding?.x?.field || null;
    yAxis = encoding?.y?.field || null;
    color = encoding?.color?.field || null;
    xOffset = encoding?.xOffset?.field || null;
    theta = encoding?.theta?.field || null;
    if (chartType === null) {
      chartType = convertToChartType(
        typeof spec.mark === 'string' ? spec.mark : spec.mark?.type,
        encoding,
      );
    }
  }

  return {
    chartType,
    xAxis,
    yAxis,
    color,
    xOffset,
    theta,
  };
};

export const getChartSpecFieldTitleMap = (encoding?: EncodingSpec | null) => {
  if (!encoding) return {};

  return (['x', 'y', 'xOffset', 'color', 'theta'] as const).reduce(
    (result: Record<string, string>, key) => {
      const axis = encoding[key];
      if (axis?.field && axis?.title) {
        result[axis.field] = axis.title;
      }
      return result;
    },
    {},
  );
};
