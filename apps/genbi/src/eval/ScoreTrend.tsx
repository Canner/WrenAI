import { useMemo } from 'react';
import { Chart, Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { toTrendOption } from './trendOption';
import type { EvalRun } from './types';

interface ScoreTrendProps {
  runs: EvalRun[];
}

/** Score trend across the last N runs, rendered via the shared ECharts renderer. */
export function ScoreTrend({ runs }: ScoreTrendProps) {
  const option = useMemo(() => toTrendOption(runs), [runs]);
  return (
    <Panel title={t('eval.trendTitle')}>
      <Chart option={option} height={220} ariaLabel={t('eval.trendAriaLabel')} />
    </Panel>
  );
}
