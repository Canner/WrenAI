import { describe, it, expect } from 'vitest';
import { toEChartsOption } from '@/envelope/blocks/chartOption';
import type { ChartBlock } from '@/envelope/types';

describe('toEChartsOption', () => {
  it('maps a bar chart with object rows to category axis + one series', () => {
    const block: ChartBlock = {
      type: 'chart',
      chart_type: 'bar',
      x: 'month',
      series: ['revenue'],
      rows: [
        { month: 'Jan', revenue: 100 },
        { month: 'Feb', revenue: 120 },
      ],
    };
    const opt = toEChartsOption(block) as Record<string, any>;
    expect(opt.xAxis.data).toEqual(['Jan', 'Feb']);
    expect(opt.series).toHaveLength(1);
    expect(opt.series[0].type).toBe('bar');
    expect(opt.series[0].data).toEqual([100, 120]);
  });

  it('supports positional array rows', () => {
    const block: ChartBlock = {
      type: 'chart',
      chart_type: 'line',
      x: 'month',
      series: ['a', 'b'],
      rows: [
        ['Jan', 1, 2],
        ['Feb', 3, 4],
      ],
    };
    const opt = toEChartsOption(block) as Record<string, any>;
    expect(opt.xAxis.data).toEqual(['Jan', 'Feb']);
    expect(opt.series.map((s: any) => s.name)).toEqual(['a', 'b']);
    expect(opt.series[1].data).toEqual([2, 4]);
  });

  it('renders area as a line series with an area style', () => {
    const block: ChartBlock = {
      type: 'chart',
      chart_type: 'area',
      x: 'month',
      series: ['v'],
      rows: [{ month: 'Jan', v: 5 }],
    };
    const opt = toEChartsOption(block) as Record<string, any>;
    expect(opt.series[0].type).toBe('line');
    expect(opt.series[0].areaStyle).toBeDefined();
  });

  it('maps scatter and coerces non-numeric values to null', () => {
    const block: ChartBlock = {
      type: 'chart',
      chart_type: 'scatter',
      x: 'k',
      series: ['v'],
      rows: [
        { k: 'a', v: '3' },
        { k: 'b', v: 'x' },
      ],
    };
    const opt = toEChartsOption(block) as Record<string, any>;
    expect(opt.series[0].type).toBe('scatter');
    expect(opt.series[0].data).toEqual([3, null]);
  });

  it('maps pie to a single pie series using the first series', () => {
    const block: ChartBlock = {
      type: 'chart',
      chart_type: 'pie',
      x: 'plan',
      series: ['count'],
      rows: [
        { plan: 'A', count: 3 },
        { plan: 'B', count: 7 },
      ],
    };
    const opt = toEChartsOption(block) as Record<string, any>;
    expect(opt.series[0].type).toBe('pie');
    expect(opt.series[0].data).toEqual([
      { name: 'A', value: 3 },
      { name: 'B', value: 7 },
    ]);
  });
});
