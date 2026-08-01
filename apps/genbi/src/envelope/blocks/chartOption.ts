import type { EChartsCoreOption } from 'echarts';
import type { ChartBlock, ChartRow, Cell } from '../types';

function toNumber(value: Cell | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Read a row as (x value, one value per series), supporting array or object rows. */
function readRow(row: ChartRow, xKey: string, series: string[]): { x: Cell; values: (number | null)[] } {
  if (Array.isArray(row)) {
    return { x: row[0] ?? null, values: series.map((_, i) => toNumber(row[i + 1])) };
  }
  return { x: row[xKey] ?? null, values: series.map((s) => toNumber(row[s])) };
}

/** Map an envelope chart block to an ECharts option (single renderer for all types). */
export function toEChartsOption(block: ChartBlock): EChartsCoreOption {
  const { chart_type, x, series, rows } = block;
  const parsed = rows.map((row) => readRow(row, x, series));
  const categories = parsed.map((p) => String(p.x ?? ''));

  if (chart_type === 'pie') {
    // Pie uses the first series only.
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: '65%',
          data: parsed.map((p) => ({ name: String(p.x ?? ''), value: p.values[0] ?? 0 })),
        },
      ],
    };
  }

  const isScatter = chart_type === 'scatter';
  const isArea = chart_type === 'area';

  return {
    tooltip: { trigger: isScatter ? 'item' : 'axis' },
    legend: { data: series, bottom: 0 },
    grid: { left: 8, right: 16, top: 24, bottom: 32, containLabel: true },
    xAxis: { type: 'category', data: categories },
    yAxis: { type: 'value' },
    series: series.map((name, i) => ({
      name,
      type: isArea ? 'line' : isScatter ? 'scatter' : chart_type,
      ...(isArea ? { areaStyle: {} } : {}),
      data: parsed.map((p) => p.values[i]),
    })),
  };
}
