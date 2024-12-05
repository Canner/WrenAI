import { isNil } from 'lodash';
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
};

const config: Config = {
  mark: { tooltip: true },
  font: 'Roboto, Arial, Noto Sans, sans-serif',
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
    color: colorScheme[0],
  },
  bar: {
    color: colorScheme[0],
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
      height: isNil(options?.height) ? 250 : options.height,
      stack: isNil(options?.stack) ? 'zero' : options.stack,
      point: isNil(options?.point) ? true : options.point,
      donutInner: isNil(options?.donutInner) ? 60 : options.donutInner,
    };

    this.parseSpec(spec);
  }

  public getChartSpec() {
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
      this.addEncoding(spec.encoding);
    }
  }

  private addMark(mark: MarkSpec) {
    let additionalProps = {};

    if (mark.type === MarkType.LINE) {
      additionalProps = { point: this.options.point };
    } else if (mark.type === MarkType.ARC) {
      additionalProps = { innerRadius: this.options.donutInner };
    }
    this.mark = { type: mark.type, ...additionalProps };
  }

  private addEncoding(encoding: EncodingSpec) {
    this.encoding = encoding;
    this.addHoverHighlight(encoding);
    const { x, y } = this.getAxisDomain();

    if (y) {
      this.encoding.y = {
        ...this.encoding.y,
        scale: {
          domain: y,
          nice: true,
          zero: false,
        },
      };
    }

    if (x) {
      this.encoding.x = {
        ...this.encoding.x,
        scale: {
          domain: x,
          nice: true,
          zero: false,
        },
      };
    }

    if (this.mark.type === MarkType.BAR) {
      if ('stack' in this.encoding.y) {
        this.encoding.y.stack = this.options.stack;
      }
    }
  }

  private getAxisDomain() {
    const xField = this.encoding.x as PositionFieldDef<any>;
    const yField = this.encoding.y as PositionFieldDef<any>;
    const calculateMaxDomain = (field: PositionFieldDef<any>) => {
      if (field?.type !== 'quantitative') return null;
      const fieldValue = field.field;
      const maxValue = (this.data as any).values.reduce((acc, d) => {
        if (d[fieldValue] > acc) {
          acc = d[fieldValue];
        }
        return acc;
      }, 0);
      return [0, Math.ceil(maxValue / 5) * 5];
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
      encoding.color.condition ? encoding.color.condition : encoding.color
    ) as { type: any; field: string };

    // Define the hover parameter correctly
    if (this.params) {
      this.params[0].select.fields = [category.field];
    }

    this.encoding.opacity = {
      condition: {
        param: 'hover',
        value: 1,
      },
      value: 0.3,
    };

    this.encoding.color = {
      field: category.field,
      scale: {
        range: colorScheme,
      },
      condition: {
        param: 'hover',
        field: category.field,
        type: category.type,
      },
    };
  }
}
