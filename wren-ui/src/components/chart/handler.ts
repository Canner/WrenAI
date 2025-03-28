import {
  ChartType,
  ThreadResponseChartDetail,
} from '@/apollo/client/graphql/__types__';
import { isNil, cloneDeep, uniq, sortBy, omit, isNumber } from 'lodash';
import { Config, TopLevelSpec } from 'vega-lite';

enum MarkType {
  ARC = 'arc',
  AREA = 'area',
  BAR = 'bar',
  BOXPLOT = 'boxplot',
  CIRCLE = 'circle',
  ERRORBAND = 'errorband',
  ERRORBAR = 'errorbar',
  IMAGE = 'image',
  LINE = 'line',
  POINT = 'point',
  RECT = 'rect',
  RULE = 'rule',
  SQUARE = 'square',
  TEXT = 'text',
  TICK = 'tick',
  TRAIL = 'trail',
}

const COLOR = {
  GRAY_10: '#262626',
  GRAY_9: '#434343',
  GRAY_8: '#65676c',
  GRAY_5: '#d9d9d9',
};

// Default color scheme
const colorScheme = [
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

// high contrast color scheme
const pickedColorScheme = [
  colorScheme[4],
  colorScheme[5],
  colorScheme[8],
  colorScheme[3],
  colorScheme[0],
];

const DEFAULT_COLOR = colorScheme[2];

// type EncodingFieldType = 'quantitative' | 'nominal' | 'temporal';
type DataSpec = Extract<TopLevelSpec, { data?: any }>['data'];
type EncodingSpec = Extract<TopLevelSpec, { encoding?: any }>['encoding'];
type MarkSpec = Extract<TopLevelSpec, { mark?: any }>['mark'] extends
  | string
  | infer M
  ? M
  : never;
type AutosizeSpec = Extract<TopLevelSpec, { autosize?: any }>['autosize'];
type ParamsSpec = {
  name: string;
  select: {
    type: string;
    fields?: string[];
    on: string;
    clear: string;
  };
  value?: any;
}[];
type TransformSpec = Extract<TopLevelSpec, { transform?: any }>['transform'];

type ChartOptions = {
  width?: number | string;
  height?: number | string;
  stack?: 'zero' | 'normalize';
  point?: boolean;
  donutInner?: number | false;
  categoriesLimit?: number;
  isShowTopCategories?: boolean;
  isHideLegend?: boolean;
  isHideTitle?: boolean;
};

const config: Config = {
  mark: { tooltip: true },
  font: 'Roboto, Arial, Noto Sans, sans-serif',
  padding: {
    top: 30,
    bottom: 20,
    left: 0,
    right: 0,
  },
  title: {
    color: COLOR.GRAY_10,
    fontSize: 14,
  },
  axis: {
    labelPadding: 0,
    labelOffset: 0,
    labelFontSize: 10,
    gridColor: COLOR.GRAY_5,
    titleColor: COLOR.GRAY_9,
    labelColor: COLOR.GRAY_8,
    labelFont: ' Roboto, Arial, Noto Sans, sans-serif',
  },
  axisX: { labelAngle: -45 },
  line: {
    color: DEFAULT_COLOR,
  },
  bar: {
    color: DEFAULT_COLOR,
  },
  legend: {
    symbolLimit: 15,
    columns: 1,
    labelFontSize: 10,
    labelColor: COLOR.GRAY_8,
    titleColor: COLOR.GRAY_9,
    titleFontSize: 14,
  },
  range: {
    category: colorScheme,
    ordinal: colorScheme,
    diverging: colorScheme,
    symbol: colorScheme,
    heatmap: colorScheme,
    ramp: colorScheme,
  },
  point: { size: 60, color: DEFAULT_COLOR },
};

export default class ChartSpecHandler {
  public config: Config;
  public options: ChartOptions;
  public $schema: string;
  public title: string;
  public data: DataSpec;
  public encoding: EncodingSpec;
  public mark: MarkSpec;
  public autosize: AutosizeSpec;
  public params: ParamsSpec;
  public transform: TransformSpec;

  constructor(spec: TopLevelSpec, options?: ChartOptions) {
    this.config = config;
    this.data = spec.data;
    this.autosize = { type: 'fit', contains: 'padding' };
    this.params = [
      {
        name: 'hover',
        select: {
          type: 'point',
          on: 'mouseover',
          clear: 'mouseout',
        },
      },
    ];
    // default options
    this.options = {
      width: isNil(options?.width) ? 'container' : options.width,
      height: isNil(options?.height) ? 'container' : options.height,
      stack: isNil(options?.stack) ? 'zero' : options.stack,
      point: isNil(options?.point) ? true : options.point,
      donutInner: isNil(options?.donutInner) ? 60 : options.donutInner,
      categoriesLimit: isNil(options?.categoriesLimit)
        ? 25
        : options.categoriesLimit,
      isShowTopCategories: isNil(options?.isShowTopCategories)
        ? false
        : options?.isShowTopCategories,
      isHideLegend: isNil(options?.isHideLegend) ? false : options.isHideLegend,
      isHideTitle: isNil(options?.isHideTitle) ? false : options.isHideTitle,
    };

    // avoid mutating the original spec
    const clonedSpec = cloneDeep(spec);
    this.parseSpec(clonedSpec);
  }

  public getChartSpec() {
    const categories = this.getAllCategories(this.encoding);
    // chart not support if categories more than the categories limit
    if (categories.length > this.options.categoriesLimit) {
      return null;
    }

    // if categories less or equal 5, use the picked color
    if (categories.length <= 5) {
      // Set the contrast color range on the color encoding instead of x/xOffset
      this.encoding.color = {
        ...this.encoding.color,
        scale: {
          range: pickedColorScheme,
        },
      } as any;
    }

    if (this.options.isHideLegend) {
      this.encoding.color = {
        ...this.encoding.color,
        legend: null,
      } as any;
    }

    if (this.options.isHideTitle) {
      this.title = null;
    }

    return {
      $schema: this.$schema,
      title: this.title,
      data: this.data,
      mark: this.mark,
      width: this.options.width,
      height: this.options.height,
      autosize: this.autosize,
      encoding: this.encoding,
      params: this.params,
      transform: this.transform,
    } as TopLevelSpec;
  }

  private parseSpec(spec: TopLevelSpec) {
    this.$schema = spec.$schema;
    this.title = spec.title as string;
    this.transform = spec.transform;

    if ('mark' in spec) {
      const mark =
        typeof spec.mark === 'string' ? { type: spec.mark } : spec.mark;
      this.addMark(mark);
    }

    if ('encoding' in spec) {
      // filter top categories before encoding scale calculation
      if (this.options?.isShowTopCategories) {
        const filteredData = this.filterTopCategories(spec.encoding);
        if (filteredData) this.data = filteredData;
      }

      this.addEncoding(spec.encoding);
    }
  }

  private addMark(mark: MarkSpec) {
    let additionalProps = {};

    if (mark.type === MarkType.LINE) {
      additionalProps = { point: this.options.point, tooltip: true };
    } else if (mark.type === MarkType.ARC) {
      additionalProps = { innerRadius: this.options.donutInner };
    }
    this.mark = { type: mark.type, ...additionalProps };
  }

  private addEncoding(encoding: EncodingSpec) {
    this.encoding = encoding;

    // fill color by x field if AI not provide color(category) field
    if (isNil(this.encoding.color)) {
      // find the nominal axis
      const nominalAxis = ['x', 'y'].find(
        (axis) => encoding[axis]?.type === 'nominal',
      );
      if (nominalAxis) {
        const category = encoding[nominalAxis] as any;
        this.encoding.color = {
          field: category.field,
          type: category.type,
        };
      }
    }

    // handle scale on bar chart
    if (this.mark.type === MarkType.BAR) {
      if ('stack' in this.encoding.y) {
        this.encoding.y.stack = this.options.stack;
      }

      if ('xOffset' in this.encoding) {
        const xOffset = this.encoding.xOffset as any;
        let title = xOffset?.title;
        // find xOffset title if not provided
        if (!title) {
          title = this.findFieldTitleInEncoding(this.encoding, xOffset?.field);
        }
        this.encoding.xOffset = { ...xOffset, title };
      }
    }

    this.addHoverHighlight(this.encoding);
  }

  private addHoverHighlight(encoding: EncodingSpec) {
    const category = (
      encoding.color?.condition ? encoding.color.condition : encoding.color
    ) as { type: any; field: string; title?: string };
    if (!category?.field || !category?.type) return;

    // Define the hover parameter correctly
    if (this.params && category?.field) {
      this.params[0].select.fields = [category.field];
    }

    this.encoding.opacity = {
      condition: {
        param: 'hover',
        value: 1,
      },
      value: 0.3,
    };

    let title = category?.title;
    // find color title if not provided
    if (!title) {
      title = this.findFieldTitleInEncoding(this.encoding, category?.field);
    }

    // basic color properties
    const colorProperties = {
      title,
      field: category?.field,
      type: category?.type,
      scale: {
        range: colorScheme,
      },
    } as any;

    this.encoding.color = {
      ...colorProperties,
      condition: {
        param: 'hover',
        ...omit(colorProperties, 'scale'),
      } as any,
    };
  }

  private filterTopCategories(encoding: EncodingSpec) {
    const nominalKeys = ['xOffset', 'color', 'x', 'y'].filter(
      (axis) => encoding[axis]?.type === 'nominal',
    );
    const quantitativeKeys = ['theta', 'x', 'y'].filter(
      (axis) => encoding[axis]?.type === 'quantitative',
    );
    if (!nominalKeys.length || !quantitativeKeys.length) return;

    const clonedValues = cloneDeep((this.data as any).values);

    const quantitativeAxis = quantitativeKeys[0];
    const quanAxis = encoding[quantitativeAxis] as any;
    const sortedValues = sortBy(clonedValues, (val) => {
      const value = val[quanAxis.field];
      return isNumber(value) ? -value : 0;
    });

    // nominal values probably have different length, so we need to filter them
    const filteredNominals = [];
    for (const nominalKey of nominalKeys) {
      const nomiAxis = encoding[nominalKey] as any;
      if (filteredNominals.some((val) => val.field === nomiAxis.field)) {
        continue;
      }
      const nominalValues = sortedValues.map((val) => val[nomiAxis.field]);
      const uniqueNominalValues = uniq(nominalValues);
      const topNominalValues = uniqueNominalValues.slice(
        0,
        this.options.categoriesLimit,
      );
      filteredNominals.push({
        field: nomiAxis.field,
        values: topNominalValues,
      });
    }
    const values = clonedValues.filter((val) =>
      filteredNominals.every((nominal) =>
        nominal.values.includes(val[nominal.field]),
      ),
    );
    return { values };
  }

  private getAllCategories(encoding: EncodingSpec) {
    const nominalAxis = ['xOffset', 'color', 'x', 'y'].find(
      (axis) => encoding[axis]?.type === 'nominal',
    );
    if (!nominalAxis) return [];
    const axisKey = encoding[nominalAxis] as any;
    const values = (this.data as any).values;
    const categoryValues = values.map((val) => val[axisKey.field]);
    const uniqueCategoryValues = uniq(categoryValues);

    return uniqueCategoryValues;
  }

  private findFieldTitleInEncoding(encoding: EncodingSpec, field: string) {
    const axis = ['x', 'y', 'xOffset', 'color'].find(
      (axis) => encoding[axis]?.field === field && encoding[axis]?.title,
    ) as any;
    return encoding[axis]?.title || undefined;
  }
}

export const convertToChartType = (
  markType: string,
  encoding: EncodingSpec,
) => {
  if (markType === MarkType.BAR) {
    if (encoding?.xOffset) {
      return ChartType.GROUPED_BAR;
    } else if (
      !isNil((encoding?.y as any)?.stack) ||
      !isNil((encoding?.x as any)?.stack)
    ) {
      return ChartType.STACKED_BAR;
    }
  } else if (markType === MarkType.ARC) {
    return ChartType.PIE;
  }
  return markType ? (markType.toUpperCase() as ChartType) : null;
};

export const getChartSpecOptionValues = (
  chartDetail: ThreadResponseChartDetail,
) => {
  const spec = chartDetail?.chartSchema;
  let chartType: string | null = chartDetail?.chartType || null;
  let xAxis: string | null = null;
  let yAxis: string | null = null;
  let color: string | null = null;
  let xOffset: string | null = null;
  let theta: string | null = null;

  if (spec && 'encoding' in spec) {
    const encoding = spec.encoding as EncodingSpec;
    xAxis = (encoding?.x as any)?.field || null;
    yAxis = (encoding?.y as any)?.field || null;
    color = (encoding?.color as any)?.field || null;
    xOffset = (encoding?.xOffset as any)?.field || null;
    theta = (encoding?.theta as any)?.field || null;
    if (chartType === null) {
      chartType = convertToChartType(
        typeof spec.mark === 'string' ? spec.mark : spec.mark.type,
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

export const getChartSpecFieldTitleMap = (encoding: EncodingSpec) => {
  if (!encoding) return {};
  const allFields = ['x', 'y', 'xOffset', 'color'].reduce((result, key) => {
    const axis = encoding[key] as any;
    if (axis?.field && axis?.title) {
      result[axis?.field] = axis?.title;
    }
    return result;
  }, {});
  return allFields;
};
