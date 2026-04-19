import { isNumber, sortBy, uniq } from 'lodash';

import type { ThreadResponseChartDetail } from '@server/repositories';
import type {
  ColumnMetadata,
  PreviewDataResponse,
} from '@server/services/queryService';

import {
  type EncodingChannel,
  type EncodingSpec,
  cloneChartSpec,
  getMarkType,
  normalizeTemporalValue,
} from './chartSpecShared';

type ChartDataProfile = {
  sourceRowCount: number;
  resultRowCount: number;
  appliedShaping: Array<Record<string, unknown>>;
};

const DEFAULT_CATEGORY_LIMIT = 25;
const DEFAULT_SERIES_LIMIT = 120;
const OTHER_BUCKET_LABEL = 'Other';

const getEncodingField = (
  encoding: EncodingSpec | undefined,
  channels: EncodingChannel[],
  type?: string,
) =>
  channels
    .map((channel) => encoding?.[channel])
    .find((spec) => spec?.field && (!type || spec.type === type))?.field ||
  null;

const toRowObjects = (
  columns: ColumnMetadata[],
  data: unknown[][],
): Record<string, unknown>[] =>
  (data || []).map((values) =>
    columns.reduce<Record<string, unknown>>((acc, column, index) => {
      acc[column.name] = values[index];
      return acc;
    }, {}),
  );

const toMatrix = (
  columns: ColumnMetadata[],
  rows: Record<string, unknown>[],
): unknown[][] => rows.map((row) => columns.map((column) => row[column.name]));

const aggregateQuantitativeByCategory = ({
  rows,
  categoryField,
  quantitativeField,
}: {
  rows: Record<string, unknown>[];
  categoryField: string;
  quantitativeField: string;
}) => {
  const totals = new Map<unknown, number>();
  rows.forEach((row) => {
    const category = row[categoryField];
    const value = row[quantitativeField];
    const numericValue = isNumber(value) ? value : Number(value);
    totals.set(
      category,
      (totals.get(category) || 0) +
        (Number.isFinite(numericValue) ? numericValue : 0),
    );
  });
  return totals;
};

const evenlySampleRows = (
  rows: Record<string, unknown>[],
  targetCount: number,
) => {
  if (rows.length <= targetCount) {
    return rows;
  }
  const step = rows.length / targetCount;
  const sampled: Record<string, unknown>[] = [];
  for (let index = 0; index < targetCount; index += 1) {
    sampled.push(rows[Math.floor(index * step)]);
  }
  const lastRow = rows[rows.length - 1];
  if (sampled[sampled.length - 1] !== lastRow) {
    sampled[sampled.length - 1] = lastRow;
  }
  return sampled;
};

const getTemporalSortValue = (value: unknown) => {
  if (value == null) {
    return Number.NEGATIVE_INFINITY;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const normalizedValue = normalizeTemporalValue(value);
  const timestamp = Date.parse(String(normalizedValue));
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  return String(normalizedValue);
};

const sortRowsByTemporalField = (
  rows: Record<string, unknown>[],
  temporalField: string,
) => sortBy(rows, (row) => getTemporalSortValue(row[temporalField]));

export const shapeChartPreviewData = ({
  chartDetail,
  previewData,
}: {
  chartDetail?: Pick<
    ThreadResponseChartDetail,
    'chartSchema' | 'rawChartSchema' | 'renderHints' | 'chartDataProfile'
  > | null;
  previewData: PreviewDataResponse;
}): {
  previewData: PreviewDataResponse;
  renderHints?: Record<string, unknown>;
  chartDataProfile?: ChartDataProfile;
} => {
  const baseSpec =
    cloneChartSpec(chartDetail?.chartSchema || chartDetail?.rawChartSchema) ||
    null;
  if (!baseSpec || !previewData.columns?.length || !previewData.data?.length) {
    return {
      previewData,
      renderHints: chartDetail?.renderHints,
      chartDataProfile: chartDetail?.chartDataProfile as
        | ChartDataProfile
        | undefined,
    };
  }

  const encoding = (baseSpec.encoding || {}) as EncodingSpec;
  const markType = getMarkType(baseSpec.mark)?.toLowerCase() || 'bar';
  const categoryField = getEncodingField(
    encoding,
    ['xOffset', 'color', 'x', 'y'],
    'nominal',
  );
  const quantitativeField = getEncodingField(
    encoding,
    ['theta', 'y', 'x'],
    'quantitative',
  );
  const temporalField = getEncodingField(encoding, ['x', 'y'], 'temporal');
  const categoryFields = uniq(
    (['xOffset', 'color', 'x', 'y'] as EncodingChannel[])
      .filter((channel) => encoding?.[channel]?.type === 'nominal')
      .map((channel) => encoding?.[channel]?.field)
      .filter(Boolean),
  );

  let shapedRows = toRowObjects(previewData.columns, previewData.data);
  const sourceRowCount = shapedRows.length;
  const appliedShaping: Array<Record<string, unknown>> = [];

  const categoryCount = categoryField
    ? uniq(shapedRows.map((row) => row[categoryField])).length
    : 0;

  if (
    categoryField &&
    quantitativeField &&
    categoryCount > DEFAULT_CATEGORY_LIMIT
  ) {
    const totals = aggregateQuantitativeByCategory({
      rows: shapedRows,
      categoryField,
      quantitativeField,
    });
    const topCategories = sortBy(
      Array.from(totals.entries()),
      ([, total]) => -total,
    )
      .slice(0, DEFAULT_CATEGORY_LIMIT)
      .map(([category]) => category);

    const canCreateOtherBucket =
      categoryFields.length === 1 && (markType === 'bar' || markType === 'arc');

    const retainedRows = shapedRows.filter((row) =>
      topCategories.includes(row[categoryField]),
    );

    if (canCreateOtherBucket) {
      const otherRows = shapedRows.filter(
        (row) => !topCategories.includes(row[categoryField]),
      );
      if (otherRows.length > 0) {
        const otherTotal = otherRows.reduce((sum, row) => {
          const value = row[quantitativeField];
          const numericValue = isNumber(value) ? value : Number(value);
          return sum + (Number.isFinite(numericValue) ? numericValue : 0);
        }, 0);
        retainedRows.push({
          [categoryField]: OTHER_BUCKET_LABEL,
          [quantitativeField]: otherTotal,
        });
        appliedShaping.push({ type: 'other_bucket' });
      }
    }

    shapedRows = retainedRows;
    appliedShaping.push({ type: 'top_n', value: DEFAULT_CATEGORY_LIMIT });
  }

  if (
    (markType === 'line' || markType === 'area') &&
    shapedRows.length > DEFAULT_SERIES_LIMIT
  ) {
    if (temporalField) {
      shapedRows = sortRowsByTemporalField(shapedRows, temporalField);
    }
    shapedRows = evenlySampleRows(shapedRows, DEFAULT_SERIES_LIMIT);
    appliedShaping.push({
      type: temporalField ? 'time_downsample' : 'series_downsample',
      value: shapedRows.length,
      ...(temporalField ? { granularity: 'sampled' } : {}),
    });
  }

  const nextRenderHints = {
    ...(chartDetail?.renderHints || {}),
    preferredRenderer:
      shapedRows.length > DEFAULT_SERIES_LIMIT ||
      markType === 'line' ||
      markType === 'area'
        ? 'canvas'
        : chartDetail?.renderHints?.preferredRenderer,
    categoryCount: categoryCount || undefined,
    isLargeCategory: categoryCount > DEFAULT_CATEGORY_LIMIT,
    isDenseSeries: sourceRowCount > DEFAULT_SERIES_LIMIT,
    suggestedTopN:
      categoryCount > DEFAULT_CATEGORY_LIMIT
        ? DEFAULT_CATEGORY_LIMIT
        : undefined,
  } as Record<string, unknown>;

  const nextChartDataProfile: ChartDataProfile | undefined =
    appliedShaping.length > 0
      ? {
          sourceRowCount,
          resultRowCount: shapedRows.length,
          appliedShaping,
        }
      : undefined;

  if (
    !nextChartDataProfile &&
    !nextRenderHints.isLargeCategory &&
    !nextRenderHints.isDenseSeries
  ) {
    return {
      previewData,
      renderHints: nextRenderHints,
      chartDataProfile: chartDetail?.chartDataProfile as
        | ChartDataProfile
        | undefined,
    };
  }

  return {
    previewData: {
      ...previewData,
      data: toMatrix(previewData.columns, shapedRows),
    },
    renderHints: nextRenderHints,
    chartDataProfile:
      nextChartDataProfile ||
      (chartDetail?.chartDataProfile as ChartDataProfile | undefined),
  };
};
