import { TopLevelSpec, Config } from 'vega-lite';

// Enum for mark types matching the frontend implementation
export enum MarkType {
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

// Constants from handler.ts
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

const DEFAULT_COLOR = colorScheme[2];

// Configuration object identical to handler.ts
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

/**
 * VegaSpecHandler provides methods to enhance and standardize Vega specifications
 * Similar to the frontend handler.ts but focusing only on core styling needs
 */
export class VegaSpecHandler {
  public config: Config;
  public data: { values: any[] };
  public encoding: any;
  public mark: any;
  public width: 'container';
  public height: 'container';
  public autosize: { type: string; contains: string };
  public params: any[];
  public title: string;
  public $schema: string;

  constructor(spec: any, dataValues: any[]) {
    this.config = config;
    this.$schema = 'https://vega.github.io/schema/vega-lite/v5.json';
    this.title = spec.title;
    this.width = 'container';
    this.height = 'container';
    this.autosize = { type: 'fit', contains: 'padding' };
    this.data = { values: dataValues };
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

    // Clone to avoid mutating the original spec
    const clonedSpec = { ...spec };
    this.parseSpec(clonedSpec);
  }

  /**
   * Returns the complete enhanced Vega specification
   */
  public getChartSpec(): TopLevelSpec {
    return {
      $schema: this.$schema,
      config: this.config,
      title: this.title,
      data: this.data,
      mark: this.mark,
      width: this.width,
      height: this.height,
      autosize: this.autosize,
      encoding: this.encoding,
      params: this.params,
    } as TopLevelSpec;
  }

  /**
   * Parses the input specification to extract and enhance components
   */
  private parseSpec(spec: any): void {
    if ('mark' in spec) {
      const mark =
        typeof spec.mark === 'string' ? { type: spec.mark } : spec.mark;
      this.addMark(mark);
    }

    if ('encoding' in spec) {
      this.addEncoding(spec.encoding);
    }
  }

  /**
   * Processes and enhances the mark specification
   */
  private addMark(mark: any): void {
    this.mark = {
      type: mark.type,
    };

    // Handle specific mark types if needed
    if (mark.type === MarkType.LINE) {
      this.mark.point = true;
    } else if (mark.type === MarkType.ARC) {
      // Default inner radius for donut charts
      this.mark.innerRadius = 60;
    }
  }

  /**
   * Processes and enhances encoding with proper color and interactivity
   */
  private addEncoding(encoding: any): void {
    this.encoding = { ...encoding };

    // Add color field if not provided
    this.addColorEncoding();

    // Handle special case for bar charts
    this.handleBarChartEncoding();

    // Add interactivity through opacity
    this.addOpacityForInteractivity();
  }

  /**
   * Handles special encoding for bar charts
   */
  private handleBarChartEncoding(): void {
    if (this.mark.type === MarkType.BAR) {
      // Handle stacking for bar charts
      if (this.encoding.y && 'stack' in this.encoding.y) {
        this.encoding.y.stack = 'zero';
      }

      // Handle xOffset titles if present
      if (this.encoding.xOffset) {
        const xOffset = this.encoding.xOffset;
        let title = xOffset.title;

        // Find xOffset title if not provided
        if (!title && xOffset.field) {
          title = this.findFieldTitleInEncoding(xOffset.field);
        }

        if (title) {
          this.encoding.xOffset.title = title;
        }
      }
    }
  }

  /**
   * Utility to find a field's title from other encodings
   */
  private findFieldTitleInEncoding(field: string): string | undefined {
    const axes = ['x', 'y', 'xOffset', 'color'];

    for (const axis of axes) {
      if (this.encoding[axis]?.field === field && this.encoding[axis]?.title) {
        return this.encoding[axis].title;
      }
    }

    return undefined;
  }

  /**
   * Adds or enhances color encoding
   */
  private addColorEncoding(): void {
    // If no color encoding exists, use a nominal axis
    if (!this.encoding.color) {
      const nominalAxis = ['x', 'y'].find(
        (axis) => this.encoding[axis]?.type === 'nominal',
      );

      if (nominalAxis) {
        const category = this.encoding[nominalAxis];
        this.encoding.color = {
          field: category.field,
          type: category.type,
          title: category.title || category.field,
          scale: {
            range: colorScheme,
          },
        };
      }
    } else if (this.encoding.color && !this.encoding.color.scale) {
      // Add color scale if not present
      this.encoding.color.scale = {
        range: colorScheme,
      };
    }

    // Set up hover fields for the interactive parameter
    if (this.params && this.encoding.color?.field) {
      this.params[0].select.fields = [this.encoding.color.field];
    }
  }

  /**
   * Adds opacity encoding for hover interactivity
   */
  private addOpacityForInteractivity(): void {
    // Add opacity for hover effect
    if (!this.encoding.opacity) {
      this.encoding.opacity = {
        condition: {
          param: 'hover',
          value: 1,
        },
        value: 0.3,
      };
    }
  }
}

/**
 * Enhances a Vega specification with standard configuration and styling
 *
 * @param vegaSpec The original Vega specification from the AI model
 * @param dataValues The data to be visualized
 * @returns Enhanced Vega specification with consistent styling
 */
export function enhanceVegaSpec(
  vegaSpec: any,
  dataValues: any[],
): TopLevelSpec {
  const handler = new VegaSpecHandler(vegaSpec, dataValues);
  return handler.getChartSpec();
}
