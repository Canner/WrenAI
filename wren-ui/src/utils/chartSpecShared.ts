import { cloneDeep, isPlainObject } from 'lodash';

export type EncodingChannel = 'x' | 'y' | 'color' | 'xOffset' | 'theta';

export type EncodingFieldSpec = {
  field?: string;
  type?: string;
  title?: string;
  stack?: 'zero' | 'normalize' | null;
  legend?: unknown;
  scale?: Record<string, unknown>;
  condition?: Record<string, unknown>;
  [key: string]: unknown;
};

export type EncodingSpec = Partial<
  Record<EncodingChannel, EncodingFieldSpec>
> & {
  opacity?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ChartSpecRecord = {
  [key: string]: any;
  $schema?: string;
  title?: string | null;
  mark?: string | { type?: string; [key: string]: unknown };
  encoding?: EncodingSpec;
  data?: { values?: Record<string, unknown>[] };
  autosize?: { type: string; contains: string };
  params?: Array<Record<string, unknown>>;
  width?: string | number;
  height?: string | number;
  transform?: unknown;
};

export const DEFAULT_COLOR_RANGE = [
  '#7763CF',
  '#444CE7',
  '#1570EF',
  '#0086C9',
  '#3E4784',
  '#E31B54',
  '#EC4A0A',
  '#EF8D0C',
  '#EBC405',
  '#5381AD',
];

export const DEFAULT_HOVER_PARAM_NAME = 'hover';
export const DEFAULT_CANONICAL_AUTOSIZE = {
  type: 'fit',
  contains: 'padding',
} as const;
export const DEFAULT_CANONICAL_DIMENSION = 'container';

export const cloneChartSpec = (
  chartSchema?: Record<string, any> | null,
): ChartSpecRecord | null => {
  if (!isPlainObject(chartSchema)) {
    return null;
  }
  return cloneDeep(chartSchema) as ChartSpecRecord;
};

export const getMarkType = (mark?: ChartSpecRecord['mark']) => {
  if (!mark) return null;
  return typeof mark === 'string' ? mark : mark.type || null;
};

export const findFieldTitleInEncoding = (
  encoding: EncodingSpec,
  field?: string,
) => {
  if (!field) {
    return undefined;
  }

  const channel = (
    ['x', 'y', 'xOffset', 'color', 'theta'] as EncodingChannel[]
  ).find((key) => encoding[key]?.field === field && encoding[key]?.title);

  return channel ? encoding[channel]?.title : undefined;
};

export const normalizeMarkSpec = (
  mark?: ChartSpecRecord['mark'],
  options?: {
    donutInner?: number | false;
    linePoint?: boolean;
    lineTooltip?: boolean;
  },
) => {
  const nextMark =
    typeof mark === 'string'
      ? { type: mark.toLowerCase() }
      : cloneDeep(mark || { type: 'bar' });

  nextMark.type = nextMark.type?.toLowerCase?.() || 'bar';

  if (nextMark.type === 'line') {
    if (options?.linePoint !== false && nextMark.point == null) {
      nextMark.point = true;
    }
    if (options?.lineTooltip !== false && nextMark.tooltip == null) {
      nextMark.tooltip = true;
    }
  }

  if (nextMark.type === 'arc') {
    const nextInnerRadius =
      options?.donutInner === false
        ? false
        : typeof options?.donutInner === 'number'
          ? options.donutInner
          : 60;
    if (nextInnerRadius !== false && nextMark.innerRadius == null) {
      nextMark.innerRadius = nextInnerRadius;
    }
  }

  return nextMark;
};

export const ensureColorFallback = (encoding: EncodingSpec) => {
  if (encoding.color?.field) {
    return;
  }

  const nominalChannel = (['x', 'y'] as const).find(
    (channel) =>
      encoding[channel]?.type === 'nominal' && encoding[channel]?.field,
  );

  if (!nominalChannel) {
    return;
  }

  const source = encoding[nominalChannel];
  if (!source?.field || !source?.type) {
    return;
  }

  encoding.color = {
    field: source.field,
    type: source.type,
    title: source.title,
  };
};

export const ensureEncodingTitles = (encoding: EncodingSpec) => {
  (['x', 'y', 'color', 'xOffset', 'theta'] as EncodingChannel[]).forEach(
    (channel) => {
      const spec = encoding[channel];
      if (!spec?.field || spec.title) {
        return;
      }
      spec.title = findFieldTitleInEncoding(encoding, spec.field) || spec.field;
    },
  );
};

export const ensureBarEncodingDefaults = (
  markType: string | null,
  encoding: EncodingSpec,
) => {
  if (markType !== 'bar') {
    return;
  }

  const xOffset = encoding.xOffset;
  if (!xOffset?.field || xOffset.title) {
    return;
  }

  xOffset.title =
    findFieldTitleInEncoding(encoding, xOffset.field) || xOffset.field;
};

export const buildHoverParams = ({
  field,
  params,
}: {
  field: string;
  params?: Array<Record<string, unknown>>;
}) => {
  const nextParams = cloneDeep(params || []);
  const existingParamIndex = nextParams.findIndex(
    (param) =>
      isPlainObject(param) &&
      param.name === DEFAULT_HOVER_PARAM_NAME &&
      isPlainObject(param.select),
  );

  const hoverParam = {
    name: DEFAULT_HOVER_PARAM_NAME,
    select: {
      type: 'point',
      fields: [field],
      on: 'mouseover',
      clear: 'mouseout',
    },
  };

  if (existingParamIndex === -1) {
    return [hoverParam, ...nextParams];
  }

  const existingParam = nextParams[existingParamIndex];
  const existingSelect = isPlainObject(existingParam.select)
    ? (existingParam.select as Record<string, unknown>)
    : {};
  nextParams[existingParamIndex] = {
    ...existingParam,
    select: {
      ...existingSelect,
      type: 'point',
      fields: [field],
      on: 'mouseover',
      clear: 'mouseout',
    },
  };
  return nextParams;
};

export const ensureHoverDefaults = ({
  encoding,
  params,
}: {
  encoding: EncodingSpec;
  params?: Array<Record<string, unknown>>;
}) => {
  const colorField = encoding.color?.field;
  const colorType = encoding.color?.type;

  if (!colorField || !colorType) {
    return {
      encoding,
      params,
    };
  }

  const colorTitle =
    encoding.color?.title ||
    findFieldTitleInEncoding(encoding, colorField) ||
    colorField;
  const currentColor = encoding.color;

  encoding.color = {
    ...currentColor,
    field: colorField,
    type: colorType,
    title: colorTitle,
    ...(currentColor?.scale ? { scale: currentColor.scale } : {}),
    ...(currentColor &&
    Object.prototype.hasOwnProperty.call(currentColor, 'legend')
      ? { legend: currentColor.legend }
      : {}),
    condition: {
      param: DEFAULT_HOVER_PARAM_NAME,
      field: colorField,
      type: colorType,
      title: colorTitle,
    },
  };

  if (!encoding.color.scale) {
    encoding.color.scale = {
      range: DEFAULT_COLOR_RANGE,
    };
  }

  if (!encoding.opacity) {
    encoding.opacity = {
      condition: {
        param: DEFAULT_HOVER_PARAM_NAME,
        value: 1,
      },
      value: 0.3,
    };
  }

  return {
    encoding,
    params: buildHoverParams({ field: colorField, params }),
  };
};

export const normalizeTemporalValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return value;
  }
  const stringValue = typeof value === 'string' ? value : String(value);
  return stringValue.includes('UTC')
    ? stringValue.replace(/\s+UTC([+-][0-9]+)?(:[0-9]+)?/, '')
    : stringValue;
};

export const transformTemporalRows = (
  values: Record<string, unknown>[],
  encoding?: EncodingSpec,
) => {
  const temporalChannels = (['x', 'y'] as const).filter(
    (channel) =>
      encoding?.[channel]?.type === 'temporal' && encoding?.[channel]?.field,
  );
  if (temporalChannels.length === 0) {
    return values;
  }

  return values.map((row) => {
    const next = { ...row };
    temporalChannels.forEach((channel) => {
      const field = encoding?.[channel]?.field;
      if (!field) return;
      next[field] = normalizeTemporalValue(next[field]);
    });
    return next;
  });
};
