import {
  convertToChartType,
  getChartSpecFieldTitleMap,
  getChartSpecOptionValues,
} from './meta';

describe('chart meta helpers', () => {
  it('infers grouped and stacked chart types from mark/encoding', () => {
    expect(
      convertToChartType('bar', {
        xOffset: { field: 'segment', type: 'nominal' },
      }),
    ).toBe('GROUPED_BAR');

    expect(
      convertToChartType('bar', {
        y: { field: 'sales', type: 'quantitative', stack: 'zero' },
      }),
    ).toBe('STACKED_BAR');

    expect(convertToChartType('arc', {})).toBe('PIE');
    expect(convertToChartType('line', {})).toBe('LINE');
  });

  it('extracts chart option values from chart detail', () => {
    expect(
      getChartSpecOptionValues({
        chartType: null,
        chartSchema: {
          mark: 'bar',
          encoding: {
            x: { field: 'region', type: 'nominal' },
            y: { field: 'sales', type: 'quantitative' },
            color: { field: 'segment', type: 'nominal' },
            xOffset: { field: 'segment', type: 'nominal' },
          },
        },
      } as any),
    ).toEqual({
      chartType: 'GROUPED_BAR',
      xAxis: 'region',
      yAxis: 'sales',
      color: 'segment',
      xOffset: 'segment',
      theta: null,
    });
  });

  it('builds field title map from encoding', () => {
    expect(
      getChartSpecFieldTitleMap({
        x: { field: 'order_date', title: '订单日期' },
        y: { field: 'sales', title: '销售额' },
        color: { field: 'segment' },
      }),
    ).toEqual({
      order_date: '订单日期',
      sales: '销售额',
    });
  });
});

