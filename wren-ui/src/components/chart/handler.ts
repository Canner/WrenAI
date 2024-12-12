import { ChartType } from '@/apollo/client/graphql/__types__';
import { isNil, cloneDeep, uniq, sortBy, omit } from 'lodash';
import { Config, TopLevelSpec } from 'vega-lite';
import { PositionFieldDef } from 'vega-lite/build/src/channeldef';

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

type ChartOptions = {
  width?: number | string;
  height?: number;
  stack?: 'zero' | 'normalize';
  point?: boolean;
  donutInner?: number | false;
  categoriesLimit?: number;
  isShowTopCategories?: boolean;
};

const config: Config = {
  mark: { tooltip: true },
  font: 'Roboto, Arial, Noto Sans, sans-serif',
  padding: {
    top: 30,
    bottom: 20,
  },
  title: {
    color: COLOR.GRAY_10,
    fontSize: 14,
  },
  axis: {
    labelFontSize: 10,
    gridColor: COLOR.GRAY_5,
    titleColor: COLOR.GRAY_9,
    labelColor: COLOR.GRAY_8,
    labelFont: ' Roboto, Arial, Noto Sans, sans-serif',
  },
  line: {
    color: DEFAULT_COLOR,
  },
  bar: {
    color: DEFAULT_COLOR,
  },
  legend: {
    symbolLimit: 15,
    columns: 1,
    labelFontSize: 12,
    labelColor: COLOR.GRAY_8,
    titleColor: COLOR.GRAY_9,
    titleFontSize: 14,
  },
  range: {
    category: colorScheme,
    ordinal: colorScheme,
  },
  point: { size: 60 },
};

export default class ChartSpecHandler {
  public config: Config;
  public options: ChartOptions;
  public $schema: string;
  public data: DataSpec;
  public encoding: EncodingSpec;
  public mark: MarkSpec;
  public autosize: AutosizeSpec;
  public params: ParamsSpec;

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
      height: isNil(options?.height) ? 280 : options.height,
      stack: isNil(options?.stack) ? 'zero' : options.stack,
      point: isNil(options?.point) ? true : options.point,
      donutInner: isNil(options?.donutInner) ? 60 : options.donutInner,
      categoriesLimit: isNil(options?.categoriesLimit)
        ? 25
        : options.categoriesLimit,
      isShowTopCategories: isNil(options?.isShowTopCategories)
        ? false
        : options?.isShowTopCategories,
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

    return {
      $schema: this.$schema,
      data: this.data,
      mark: this.mark,
      width: this.options.width,
      height: this.options.height,
      autosize: this.autosize,
      encoding: this.encoding,
      params: this.params,
    } as TopLevelSpec;
  }

  private parseSpec(spec: TopLevelSpec) {
    this.$schema = spec.$schema;

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
    const { x, y } = this.getAxisDomain();

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
      if (y) {
        this.encoding.y = {
          ...this.encoding.y,
          scale: {
            domain: y,
            nice: false,
          },
        };
      }

      if (x) {
        this.encoding.x = {
          ...this.encoding.x,
          scale: {
            domain: x,
            nice: false,
          },
        };
      }

      if ('stack' in this.encoding.y) {
        this.encoding.y.stack = this.options.stack;
      }
    }

    this.addHoverHighlight(this.encoding);
  }

  private getAxisDomain() {
    const xField = this.encoding.x as PositionFieldDef<any>;
    const yField = this.encoding.y as PositionFieldDef<any>;
    const calculateMaxDomain = (field: PositionFieldDef<any>) => {
      if (field?.type !== 'quantitative') return null;
      const fieldValue = field.field;
      const values = (this.data as any).values.map((d) => d[fieldValue]);

      const maxValue = Math.max(...values);

      // Get the magnitude (e.g., 1, 10, 100, 1000)
      const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue)));

      // Get number between 1-10
      const normalizedValue = maxValue / magnitude;
      let niceNumber;

      if (normalizedValue <= 1.2) niceNumber = 1.2;
      else if (normalizedValue <= 1.5) niceNumber = 1.5;
      else if (normalizedValue <= 2) niceNumber = 2;
      else if (normalizedValue <= 2.5) niceNumber = 2.5;
      else if (normalizedValue <= 3) niceNumber = 3;
      else if (normalizedValue <= 4) niceNumber = 4;
      else if (normalizedValue <= 5) niceNumber = 5;
      else if (normalizedValue <= 7.5) niceNumber = 7.5;
      else if (normalizedValue <= 8) niceNumber = 8;
      else niceNumber = 10;

      const domainMax = niceNumber * magnitude;
      return [0, domainMax];
    };
    const xDomain = calculateMaxDomain(xField);
    const yDomain = calculateMaxDomain(yField);
    return {
      x: xDomain,
      y: yDomain,
    };
  }

  private addHoverHighlight(encoding: EncodingSpec) {
    const category = (
      encoding.color?.condition ? encoding.color.condition : encoding.color
    ) as { type: any; field: string };
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

    // basic color properties
    let colorProperties = {
      field: category?.field,
      type: category?.type,
      scale: {
        range: colorScheme,
      },
    } as any;
    if (this.mark.type === MarkType.LINE) {
      colorProperties = {
        value: DEFAULT_COLOR,
      };
    }

    this.encoding.color = {
      ...colorProperties,
      condition: {
        param: 'hover',
        ...omit(colorProperties, 'scale'),
      } as any,
    };
  }

  private filterTopCategories(encoding: EncodingSpec) {
    const nominalAxis = ['xOffset', 'color', 'x', 'y'].find(
      (axis) => encoding[axis]?.type === 'nominal',
    );
    if (!nominalAxis) return;
    const quantitativeAxis = ['theta', 'x', 'y'].find(
      (axis) => encoding[axis]?.type === 'quantitative',
    );
    if (!quantitativeAxis) return;

    const clonedValues = cloneDeep((this.data as any).values);

    const quanAxis = encoding[quantitativeAxis] as any;
    const nomiAxis = encoding[nominalAxis] as any;
    const sortedValues = sortBy(clonedValues, (val) => val[quanAxis.field]);
    const categoryValues = sortedValues.map((val) => val[nomiAxis.field]);
    const uniqueCategoryValues = uniq(categoryValues);
    const topCategories = uniqueCategoryValues.slice(
      0,
      this.options.categoriesLimit,
    );

    const values = clonedValues.filter((val) =>
      topCategories.includes(val[nomiAxis.field]),
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

export const getChartSpecOptionValues = (spec: TopLevelSpec) => {
  let chartType: string | null = null;
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
    if ('mark' in spec) {
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
