import type { EChartsCoreOption } from 'echarts';
import type { EvalRun } from './types';

/**
 * Build the score-trend ECharts option: score across the last N runs. Runs
 * arrive newest-first (matching the sidebar); the trend reads left-to-right
 * oldest-to-newest, so the series is reversed here.
 */
export function toTrendOption(runs: EvalRun[]): EChartsCoreOption {
  const ordered = [...runs].reverse();

  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 16, top: 24, bottom: 32, containLabel: true },
    xAxis: { type: 'category', data: ordered.map((run) => run.id) },
    yAxis: { type: 'value', min: 0, max: 1 },
    series: [
      {
        name: 'score',
        type: 'line',
        data: ordered.map((run) => run.score),
      },
    ],
  };
}
