/**
 * Eval page domain types — GLOBAL eval scores only. Phase 1 shows the last N
 * eval runs, KPIs for the selected run (score, gate pass/fail, regressions,
 * cost, p50 latency), a score trend across runs, and a by-component score
 * breakdown. By-question drill-down is out of scope for this phase — see
 * `src/eval/fixtures.ts` for sample data and `README.md` for scope.
 */

export interface EvalRun {
  id: string;
  when: string;
  /** Verified-correct score, 0..1. */
  score: number;
  /** Minimum score the gate requires to pass, 0..1. */
  gateThreshold: number;
  gatePass: boolean;
  regressions: number;
  /** Formatted run cost, e.g. "$0.84". */
  cost: string;
  /** Formatted p50 latency, e.g. "1.2s". */
  p50: string;
}

export interface ComponentScore {
  component: string;
  score: number;
  /** Change vs. the previous run. */
  delta: number;
}
