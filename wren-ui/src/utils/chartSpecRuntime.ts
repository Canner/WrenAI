import { cloneDeep, uniq } from 'lodash';
import {
  ChartAdjustmentOption,
  ChartType as RuntimeChartType,
} from '@server/models/adaptor';
import type { ThreadResponseChartDetail } from '@server/repositories';
import {
  ChartSpecRecord,
  DEFAULT_CANONICAL_AUTOSIZE,
  DEFAULT_CANONICAL_DIMENSION,
  EncodingChannel,
  EncodingFieldSpec,
  EncodingSpec,
  ensureBarEncodingDefaults,
  ensureColorFallback,
  ensureEncodingTitles,
  ensureHoverDefaults,
  getMarkType,
  normalizeMarkSpec,
  cloneChartSpec,
} from './chartSpecShared';
export { shapeChartPreviewData } from './chartPreviewShaping';

type FieldMeta = {
  field: string;
  type?: string;
  title?: string;
};

const CANONICALIZATION_VERSION = 'chart-canonical-v1';

const DEFAULT_CHANNEL_TYPE: Record<EncodingChannel, string> = {
  x: 'nominal',
  y: 'quantitative',
  color: 'nominal',
  xOffset: 'nominal',
  theta: 'quantitative',
};

const DEFAULT_RENDERER_BY_MARK: Record<string, 'svg' | 'canvas'> = {
  line: 'canvas',
  area: 'canvas',
};

const normalizeChartType = (value?: string | null): RuntimeChartType | null => {
  if (!value) return null;
  const normalized = value.toLowerCase();
  return (Object.values(RuntimeChartType).find(
    (chartType) => chartType === normalized,
  ) || null) as RuntimeChartType | null;
};

const toLegacyChartType = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  return value.toUpperCase();
};

const collectFieldMeta = (encoding?: EncodingSpec | null) => {
  const meta = new Map<string, FieldMeta>();
  const channels: EncodingChannel[] = ['x', 'y', 'color', 'xOffset', 'theta'];
  channels.forEach((channel) => {
    const spec = encoding?.[channel];
    if (!spec?.field) return;
    if (!meta.has(spec.field)) {
      meta.set(spec.field, {
        field: spec.field,
        type: spec.type,
        title: spec.title,
      });
    }
  });
  return meta;
};

const buildEncodingField = (
  field: string,
  channel: EncodingChannel,
  fieldMeta: Map<string, FieldMeta>,
  fallback?: EncodingFieldSpec,
): EncodingFieldSpec => {
  const meta = fieldMeta.get(field);
  return {
    ...(fallback || {}),
    field,
    title: meta?.title || fallback?.title || field,
    type:
      meta?.type ||
      fallback?.type ||
      DEFAULT_CHANNEL_TYPE[channel] ||
      'nominal',
  };
};

const cleanupEncoding = (encoding: EncodingSpec) => {
  const cleaned = cloneDeep(encoding);
  (['x', 'y', 'color', 'xOffset', 'theta'] as EncodingChannel[]).forEach(
    (channel) => {
      const spec = cleaned[channel];
      if (!spec?.field) {
        delete cleaned[channel];
      }
    },
  );
  return cleaned;
};

const convertMarkToChartType = (
  markType?: string | null,
  encoding?: EncodingSpec,
) => {
  const normalizedMarkType = markType?.toLowerCase();
  if (!normalizedMarkType) {
    return null;
  }

  if (normalizedMarkType === 'bar') {
    if (encoding?.xOffset) {
      return RuntimeChartType.GROUPED_BAR;
    }

    if (encoding?.y?.stack != null || encoding?.x?.stack != null) {
      return RuntimeChartType.STACKED_BAR;
    }
  }

  if (normalizedMarkType === 'arc') {
    return RuntimeChartType.PIE;
  }

  return normalizedMarkType;
};

const inferChartTypeFromSpec = (
  spec: ChartSpecRecord,
): RuntimeChartType | null => {
  const markType = getMarkType(spec.mark);
  if (!markType) return null;
  const inferred = convertMarkToChartType(markType, spec.encoding);
  return normalizeChartType(inferred);
};

const inferPreferredRenderer = (spec: ChartSpecRecord): 'svg' | 'canvas' => {
  const markType = getMarkType(spec.mark)?.toLowerCase() || 'bar';
  return DEFAULT_RENDERER_BY_MARK[markType] || 'svg';
};

const collectValidationErrors = (spec: ChartSpecRecord) => {
  const errors: string[] = [];
  const markType = getMarkType(spec.mark)?.toLowerCase() || null;
  const encoding = spec.encoding || {};
  const supportedMarkTypes = new Set(['bar', 'line', 'area', 'arc']);

  if (!markType) {
    errors.push('Chart spec is missing mark type');
    return errors;
  }

  if (!supportedMarkTypes.has(markType)) {
    errors.push(`Unsupported chart mark type: ${markType}`);
  }

  (['x', 'y', 'color', 'xOffset', 'theta'] as EncodingChannel[]).forEach(
    (channel) => {
      const fieldSpec = encoding[channel];
      if (fieldSpec?.field && !fieldSpec.type) {
        errors.push(`Encoding channel ${channel} is missing type`);
      }
    },
  );

  if (
    (markType === 'line' || markType === 'area') &&
    (!encoding.x?.field || !encoding.y?.field)
  ) {
    errors.push('Line/area chart requires x and y fields');
  }

  if (
    (markType === 'line' || markType === 'area') &&
    encoding.x?.type === 'nominal' &&
    encoding.y?.type === 'nominal'
  ) {
    errors.push(
      'Line/area chart requires at least one quantitative or temporal axis',
    );
  }

  if (markType === 'bar' && (!encoding.x?.field || !encoding.y?.field)) {
    errors.push('Bar chart requires x and y fields');
  }

  if (
    markType === 'bar' &&
    encoding.xOffset?.field &&
    encoding.xOffset?.type !== 'nominal'
  ) {
    errors.push('Grouped bar chart requires xOffset to be nominal');
  }

  if (
    markType === 'bar' &&
    encoding.xOffset?.field &&
    (encoding.x?.stack != null || encoding.y?.stack != null)
  ) {
    errors.push(
      'Grouped bar chart cannot enable stack and xOffset at the same time',
    );
  }

  if (
    markType === 'bar' &&
    (encoding.y?.type !== 'quantitative' || !encoding.y?.field) &&
    (encoding.x?.type !== 'quantitative' || !encoding.x?.field)
  ) {
    errors.push('Bar chart requires a quantitative measure on x or y');
  }

  if (markType === 'arc') {
    if (!encoding.color?.field) {
      errors.push('Pie chart requires color/category field');
    }
    if (!encoding.theta?.field) {
      errors.push('Pie chart requires theta/value field');
    }
    if (encoding.color?.field && encoding.color.type !== 'nominal') {
      errors.push('Pie chart category field should be nominal');
    }
    if (encoding.theta?.field && encoding.theta.type !== 'quantitative') {
      errors.push('Pie chart theta field should be quantitative');
    }
  }

  return uniq(errors);
};

export const canonicalizeChartSchema = (
  chartSchema?: Record<string, any> | null,
): {
  canonicalChartSchema: Record<string, any> | null;
  canonicalizationVersion: string;
  renderHints?: Record<string, unknown>;
  validationErrors: string[];
} => {
  const spec = cloneChartSpec(chartSchema);
  if (!spec) {
    return {
      canonicalChartSchema: null,
      canonicalizationVersion: CANONICALIZATION_VERSION,
      renderHints: undefined,
      validationErrors: ['Chart schema is empty or invalid'],
    };
  }

  try {
    const mark = normalizeMarkSpec(spec.mark);
    const encoding = cleanupEncoding(
      cloneDeep((spec.encoding || {}) as EncodingSpec),
    );

    ensureColorFallback(encoding);
    ensureEncodingTitles(encoding);
    ensureBarEncodingDefaults(mark.type || null, encoding);
    const { params } = ensureHoverDefaults({
      encoding,
      params: cloneDeep(spec.params || []),
    });

    const canonicalSpec = {
      ...cloneDeep(spec),
      mark,
      encoding,
      autosize: cloneDeep(DEFAULT_CANONICAL_AUTOSIZE),
      width: spec.width ?? DEFAULT_CANONICAL_DIMENSION,
      height: spec.height ?? DEFAULT_CANONICAL_DIMENSION,
      params,
    } as ChartSpecRecord;
    delete canonicalSpec.data;

    return {
      canonicalChartSchema: canonicalSpec,
      canonicalizationVersion: CANONICALIZATION_VERSION,
      renderHints: {
        preferredRenderer: inferPreferredRenderer(canonicalSpec),
      },
      validationErrors: collectValidationErrors(canonicalSpec),
    };
  } catch (error) {
    return {
      canonicalChartSchema: spec,
      canonicalizationVersion: CANONICALIZATION_VERSION,
      renderHints: {
        preferredRenderer: inferPreferredRenderer(spec),
      },
      validationErrors: [
        error instanceof Error ? error.message : String(error),
      ],
    };
  }
};

export const applyDeterministicChartAdjustment = (
  chartDetail: ThreadResponseChartDetail,
  input: ChartAdjustmentOption,
): ThreadResponseChartDetail => {
  const baseSpec =
    cloneChartSpec(chartDetail.rawChartSchema || chartDetail.chartSchema) ||
    cloneChartSpec(chartDetail.chartSchema);
  if (!baseSpec) {
    throw new Error('Chart schema is missing');
  }

  const encoding = cloneDeep((baseSpec.encoding || {}) as EncodingSpec);
  const fieldMeta = collectFieldMeta(encoding);
  const currentChartType =
    normalizeChartType(chartDetail.chartType) ||
    inferChartTypeFromSpec(baseSpec);
  const nextChartType = normalizeChartType(input.chartType) || currentChartType;
  if (!nextChartType) {
    throw new Error('Chart type is missing');
  }

  const currentX = input.xAxis || encoding.x?.field;
  const currentY = input.yAxis || encoding.y?.field;
  const currentColor = input.color || encoding.color?.field;
  const currentTheta = input.theta || encoding.theta?.field;
  const currentXOffset = input.xOffset || encoding.xOffset?.field;

  const nextEncoding: EncodingSpec = {};
  const nextMarkType = (() => {
    switch (nextChartType) {
      case RuntimeChartType.LINE:
      case RuntimeChartType.MULTI_LINE:
        return 'line';
      case RuntimeChartType.AREA:
        return 'area';
      case RuntimeChartType.PIE:
        return 'arc';
      case RuntimeChartType.BAR:
      case RuntimeChartType.GROUPED_BAR:
      case RuntimeChartType.STACKED_BAR:
      default:
        return 'bar';
    }
  })();

  const fallbackX = encoding.x;
  const fallbackY = encoding.y;
  const fallbackColor = encoding.color;
  const fallbackXOffset = encoding.xOffset;
  const fallbackTheta = encoding.theta;

  switch (nextChartType) {
    case RuntimeChartType.PIE: {
      const categoryField = currentColor || currentX || currentY;
      const valueField = currentTheta || currentY || currentX;
      if (!categoryField || !valueField) {
        throw new Error('Pie chart requires category and value fields');
      }
      nextEncoding.color = buildEncodingField(
        categoryField,
        'color',
        fieldMeta,
        fallbackColor || fallbackX,
      );
      nextEncoding.theta = buildEncodingField(
        valueField,
        'theta',
        fieldMeta,
        fallbackTheta || fallbackY,
      );
      break;
    }
    case RuntimeChartType.LINE:
    case RuntimeChartType.MULTI_LINE:
    case RuntimeChartType.AREA: {
      if (!currentX || !currentY) {
        throw new Error('Line/area chart requires x and y fields');
      }
      nextEncoding.x = buildEncodingField(currentX, 'x', fieldMeta, fallbackX);
      nextEncoding.y = buildEncodingField(currentY, 'y', fieldMeta, fallbackY);
      if (currentColor) {
        nextEncoding.color = buildEncodingField(
          currentColor,
          'color',
          fieldMeta,
          fallbackColor,
        );
      }
      break;
    }
    case RuntimeChartType.GROUPED_BAR: {
      if (!currentX || !currentY) {
        throw new Error('Grouped bar chart requires x and y fields');
      }
      const groupField = currentXOffset || currentColor;
      nextEncoding.x = buildEncodingField(currentX, 'x', fieldMeta, fallbackX);
      nextEncoding.y = buildEncodingField(currentY, 'y', fieldMeta, fallbackY);
      nextEncoding.y.stack = null;
      if (groupField) {
        nextEncoding.xOffset = buildEncodingField(
          groupField,
          'xOffset',
          fieldMeta,
          fallbackXOffset || fallbackColor,
        );
        nextEncoding.color = buildEncodingField(
          currentColor || groupField,
          'color',
          fieldMeta,
          fallbackColor || fallbackXOffset,
        );
      }
      break;
    }
    case RuntimeChartType.STACKED_BAR: {
      if (!currentX || !currentY) {
        throw new Error('Stacked bar chart requires x and y fields');
      }
      nextEncoding.x = buildEncodingField(currentX, 'x', fieldMeta, fallbackX);
      nextEncoding.y = buildEncodingField(currentY, 'y', fieldMeta, fallbackY);
      nextEncoding.y.stack = 'zero';
      if (currentColor) {
        nextEncoding.color = buildEncodingField(
          currentColor,
          'color',
          fieldMeta,
          fallbackColor,
        );
      }
      break;
    }
    case RuntimeChartType.BAR:
    default: {
      if (!currentX || !currentY) {
        throw new Error('Bar chart requires x and y fields');
      }
      nextEncoding.x = buildEncodingField(currentX, 'x', fieldMeta, fallbackX);
      nextEncoding.y = buildEncodingField(currentY, 'y', fieldMeta, fallbackY);
      nextEncoding.y.stack = null;
      if (currentColor && currentColor !== currentX) {
        nextEncoding.color = buildEncodingField(
          currentColor,
          'color',
          fieldMeta,
          fallbackColor,
        );
      }
      break;
    }
  }

  const nextSpec: ChartSpecRecord = {
    ...baseSpec,
    mark:
      typeof baseSpec.mark === 'string'
        ? nextMarkType
        : { ...(baseSpec.mark || {}), type: nextMarkType },
    encoding: cleanupEncoding(nextEncoding),
  };

  const { canonicalChartSchema, canonicalizationVersion, renderHints } =
    canonicalizeChartSchema(nextSpec);
  const finalSpec = (canonicalChartSchema || nextSpec) as ChartSpecRecord;
  const finalChartType =
    normalizeChartType(input.chartType) || inferChartTypeFromSpec(finalSpec);

  return {
    ...chartDetail,
    status: chartDetail.status,
    chartType: toLegacyChartType(finalChartType),
    rawChartSchema: nextSpec,
    chartSchema: finalSpec,
    canonicalizationVersion,
    renderHints: renderHints || undefined,
    adjustment: false,
  };
};
