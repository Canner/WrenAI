import { useMemo } from 'react';
import { Chart } from '@/ui';
import type { ChartBlock as ChartBlockData } from '../types';
import { toEChartsOption } from './chartOption';

interface Props {
  block: ChartBlockData;
  height?: number;
}

/** Renders a chart block via the shared ECharts renderer. */
export function ChartBlock({ block, height }: Props) {
  const option = useMemo(() => toEChartsOption(block), [block]);
  return <Chart option={option} height={height} ariaLabel={`${block.chart_type} chart`} />;
}
