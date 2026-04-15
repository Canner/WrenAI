import type { Config } from 'vega-lite';

const COLOR = {
  GRAY_10: '#262626',
  GRAY_9: '#434343',
  GRAY_8: '#65676c',
  GRAY_5: '#d9d9d9',
};

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

export const chartVegaConfig: Config = {
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

