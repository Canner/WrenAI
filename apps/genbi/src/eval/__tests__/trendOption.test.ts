import { describe, it, expect } from 'vitest';
import { toTrendOption } from '../trendOption';
import { fixtureEvalRuns } from '../fixtures';
import type { EvalRun } from '../types';

describe('toTrendOption', () => {
  it('orders the series oldest-to-newest (fixtures arrive newest-first)', () => {
    const option = toTrendOption(fixtureEvalRuns);
    const xAxis = option.xAxis as { data: string[] };
    expect(xAxis.data).toEqual([...fixtureEvalRuns].reverse().map((run) => run.id));
  });

  it('maps each run score into the single line series, in the same order as the axis', () => {
    const option = toTrendOption(fixtureEvalRuns);
    const series = option.series as { data: number[] }[];
    expect(series).toHaveLength(1);
    expect(series[0].data).toEqual([...fixtureEvalRuns].reverse().map((run) => run.score));
  });

  it('does not mutate the input array', () => {
    const runs: EvalRun[] = [...fixtureEvalRuns];
    const copy = [...runs];
    toTrendOption(runs);
    expect(runs).toEqual(copy);
  });
});
