import { useEffect, useRef } from 'react';
import type { ECharts, EChartsCoreOption } from 'echarts';
import { useUiStore } from '@/stores/useUiStore';

interface ChartProps {
  option: EChartsCoreOption;
  height?: number;
  className?: string;
  /** Accessible name for the chart (role="img"). */
  ariaLabel?: string;
}

/**
 * Single ECharts renderer for every envelope `chart` block (bar/line/pie/area/
 * scatter). v1 uses ECharts only — no Vega. ECharts is a heavy dependency and
 * charts only render once data arrives, so it is dynamically imported here to
 * keep it out of the initial bundle. Re-inits on theme change and resizes with
 * its container.
 */
export function Chart({ option, height = 280, className, ariaLabel = 'chart' }: ChartProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;
  const themeMode = useUiStore((s) => s.themeMode);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;

    void import('echarts').then((echarts) => {
      if (disposed || !elRef.current) return;
      const chart = echarts.init(
        elRef.current,
        themeMode === 'dark' ? 'dark' : undefined,
        { renderer: 'canvas' },
      );
      chart.setOption(optionRef.current, true);
      chartRef.current = chart;
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(elRef.current);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [themeMode]);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return (
    <div
      ref={elRef}
      className={className}
      style={{ width: '100%', height, background: 'transparent' }}
      role="img"
      aria-label={ariaLabel}
    />
  );
}
