import { isNumber, sortBy, uniq } from 'lodash';
import type { TopLevelSpec } from 'vega-lite';
import {
  ChartSpecRecord as ChartRenderSpec,
  cloneChartSpec,
  DEFAULT_CANONICAL_AUTOSIZE,
  DEFAULT_CANONICAL_DIMENSION,
  EncodingSpec,
  ensureBarEncodingDefaults,
  ensureColorFallback,
  ensureEncodingTitles,
  ensureHoverDefaults,
  getMarkType,
  normalizeMarkSpec,
  transformTemporalRows,
} from '@/utils/chartSpecShared';

export type ChartRenderOptions = {
  width?: number | string;
  height?: number | string;
  donutInner?: number | false;
  categoriesLimit?: number;
  autoFilter?: boolean;
  isShowTopCategories?: boolean;
  hideLegend?: boolean;
  hideTitle?: boolean;
  serverShaped?: boolean;
};

export const normalizeChartRenderDimension = (
  value?: number | string,
): number | string | undefined => (value === '100%' ? 'container' : value);

export const normalizeChartDomDimension = (
  value?: number | string,
): number | string | undefined => (value === 'container' ? '100%' : value);

const getCategoryField = (encoding?: EncodingSpec) => {
  const nominalAxis = (['xOffset', 'color', 'x', 'y'] as const).find(
    (axis) => encoding?.[axis]?.type === 'nominal',
  );
  return nominalAxis ? encoding?.[nominalAxis]?.field || null : null;
};

const getQuantitativeField = (encoding?: EncodingSpec) => {
  const quantitativeAxis = (['theta', 'x', 'y'] as const).find(
    (axis) => encoding?.[axis]?.type === 'quantitative',
  );
  return quantitativeAxis ? encoding?.[quantitativeAxis]?.field || null : null;
};

const countUniqueCategories = (
  values: Record<string, unknown>[],
  encoding?: EncodingSpec,
) => {
  const categoryField = getCategoryField(encoding);
  if (!categoryField) return 0;
  return uniq(values.map((row) => row[categoryField])).length;
};

const filterTopCategories = (
  values: Record<string, unknown>[],
  encoding?: EncodingSpec,
  categoriesLimit = 25,
) => {
  const categoryField = getCategoryField(encoding);
  const quantitativeField = getQuantitativeField(encoding);
  if (!categoryField || !quantitativeField) {
    return values;
  }

  const sortedValues = sortBy(values, (row) => {
    const value = row[quantitativeField];
    return isNumber(value) ? -value : 0;
  });
  const topCategories = uniq(
    sortedValues.map((row) => row[categoryField]),
  ).slice(0, categoriesLimit);
  return values.filter((row) => topCategories.includes(row[categoryField]));
};

export const prepareChartSpecForRender = ({
  spec,
  values,
  options,
}: {
  spec?: TopLevelSpec | null;
  values?: Record<string, unknown>[];
  options?: ChartRenderOptions;
}): TopLevelSpec | null => {
  const clonedSpec = cloneChartSpec(spec as Record<string, unknown> | null);
  if (!clonedSpec || !values) {
    return null;
  }

  const renderOptions = {
    width: options?.width ?? 'container',
    height: options?.height ?? 'container',
    donutInner: options?.donutInner,
    categoriesLimit: options?.categoriesLimit ?? 25,
    autoFilter: options?.autoFilter ?? false,
    isShowTopCategories: options?.isShowTopCategories ?? false,
    hideLegend: options?.hideLegend ?? false,
    hideTitle: options?.hideTitle ?? false,
    serverShaped: options?.serverShaped ?? false,
  };

  const categoryCount = countUniqueCategories(values, clonedSpec.encoding);
  if (
    !renderOptions.serverShaped &&
    categoryCount > renderOptions.categoriesLimit &&
    !renderOptions.autoFilter &&
    !renderOptions.isShowTopCategories
  ) {
    return null;
  }

  const filteredValues =
    !renderOptions.serverShaped && categoryCount > renderOptions.categoriesLimit
      ? filterTopCategories(
          values,
          clonedSpec.encoding,
          renderOptions.categoriesLimit,
        )
      : values;

  clonedSpec.data = {
    values: transformTemporalRows(filteredValues, clonedSpec.encoding),
  };
  clonedSpec.width = renderOptions.width;
  clonedSpec.height = renderOptions.height;
  clonedSpec.autosize = clonedSpec.autosize || {
    ...DEFAULT_CANONICAL_AUTOSIZE,
  };
  clonedSpec.mark = normalizeMarkSpec(clonedSpec.mark, {
    donutInner: renderOptions.donutInner,
  });
  clonedSpec.encoding = clonedSpec.encoding || {};
  ensureColorFallback(clonedSpec.encoding);
  ensureEncodingTitles(clonedSpec.encoding);
  ensureBarEncodingDefaults(
    getMarkType(clonedSpec.mark)?.toLowerCase() || null,
    clonedSpec.encoding,
  );

  if (renderOptions.hideTitle) {
    (clonedSpec as any).title = null;
  }
  if (renderOptions.hideLegend && clonedSpec.encoding?.color) {
    clonedSpec.encoding.color = {
      ...clonedSpec.encoding.color,
      legend: null,
    };
  }

  clonedSpec.width = clonedSpec.width ?? DEFAULT_CANONICAL_DIMENSION;
  clonedSpec.height = clonedSpec.height ?? DEFAULT_CANONICAL_DIMENSION;
  const hoverDefaults = ensureHoverDefaults({
    encoding: clonedSpec.encoding,
    params: clonedSpec.params,
  });
  clonedSpec.params = hoverDefaults.params;
  return clonedSpec as TopLevelSpec;
};

export const resolvePreferredRenderer = ({
  spec,
  values,
  isPinned,
  preferredRenderer,
}: {
  spec?: TopLevelSpec | null;
  values?: Record<string, unknown>[];
  isPinned?: boolean;
  preferredRenderer?: 'svg' | 'canvas';
}) => {
  if (preferredRenderer) {
    return preferredRenderer;
  }
  const markType = getMarkType(
    (spec as ChartRenderSpec | null)?.mark,
  )?.toLowerCase();
  const pointCount = values?.length || 0;
  if (markType === 'line' || markType === 'area') {
    return pointCount > 120 || isPinned ? 'canvas' : 'svg';
  }
  if (pointCount > 300) {
    return 'canvas';
  }
  return 'svg';
};
