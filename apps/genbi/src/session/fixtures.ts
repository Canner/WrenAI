import { fixtureEnvelopes } from '@/fixtures/envelopes';
import type { AskSessionData } from './types';

/**
 * Full-thread session fixtures, keyed by the same ids used in
 * `fixtureSessions` (`@/fixtures/index.ts`) so the Ask sidebar's session list
 * and this thread content stay paired. `s1` walks the entire answer spectrum
 * (clarify, text answer, rich answer, refusal, artifact, published) in one
 * thread; `s2` / `s3` are shorter resumed sessions so selection is meaningful.
 */
export const fixtureAskSessions: Record<string, AskSessionData> = {
  s1: {
    id: 's1',
    title: 'Top customers by revenue',
    updatedAt: '2m ago',
    events: [
      { id: 's1-e1', kind: 'user', text: 'What does MRR mean?' },
      {
        id: 's1-e2',
        kind: 'answer',
        answer: {
          form: 'text',
          verified: true,
          dataAnswer: false,
          text: 'MRR stands for Monthly Recurring Revenue — subscription revenue normalized to a monthly cadence.',
        },
      },
      { id: 's1-e3', kind: 'user', text: 'Top customers by revenue' },
      {
        id: 's1-e4',
        kind: 'answer',
        answer: { form: 'rich', envelope: fixtureEnvelopes.answerQuery },
      },
      { id: 's1-e5', kind: 'user', text: 'Turn this into a dashboard' },
      {
        id: 's1-e6',
        kind: 'clarify',
        prompt: 'Which time range should the dashboard cover?',
        chips: ['This month', 'This quarter', 'Last 12 months'],
      },
      { id: 's1-e7', kind: 'user', text: 'This quarter' },
      {
        id: 's1-e8',
        kind: 'answer',
        answer: { form: 'rich', envelope: fixtureEnvelopes.dashboard },
      },
      {
        id: 's1-e9',
        kind: 'artifact',
        name: 'Revenue dashboard',
        artifactKind: 'dashboard',
        location: 'artifacts/revenue-dashboard.json',
        // Placeholder — fixture mode has no real backend artifact row.
        artifactId: 'fixture-artifact-revenue-dashboard',
      },
      {
        id: 's1-e10',
        kind: 'published',
        artifactName: 'Revenue dashboard',
        link: 'https://share.genbi.example/revenue-dashboard',
        scope: 'workspace',
      },
      { id: 's1-e11', kind: 'user', text: 'Forecast revenue for next quarter' },
      {
        id: 's1-e12',
        kind: 'answer',
        answer: { form: 'rich', envelope: fixtureEnvelopes.forecast },
        // A static, already-settled trace for this turn, persisted directly on
        // the answer (per-turn, not the session's single live `workLog` slot)
        // so it survives every later turn in this thread — rendered collapsed
        // by default in `EventList`. It opens with a `kind: 'decision'` Route
        // row and closes with a Verify-gate decision row — both showing their
        // reasoning INLINE (no click) so the turn's control-flow reads at a
        // glance. In between: one verified-history tool step, plus a
        // delegated sub-agent step with a nested child — demonstrating
        // sub-agent delegation + the Estimate badge. `s1-w1` also carries
        // `input`/`detail` so offline mode demonstrates the expandable
        // disclosure (a `query` step's SQL + result summary) without a live turn.
        trace: [
          {
            id: 's1-w0',
            label: 'Route',
            state: 'done',
            kind: 'decision',
            depth: 0,
            detail: '→ forecast: forecasting intent (next quarter)',
          },
          {
            id: 's1-w1',
            label: 'Query verified history',
            state: 'done',
            kind: 'tool',
            depth: 0,
            input: { sql: 'SELECT date_trunc(\'month\', order_date) AS month, SUM(revenue)\nFROM verified_orders\nGROUP BY 1\nORDER BY 1' },
            detail: 'Returned 12 rows (Jan–Dec) from verified_orders.',
          },
          { id: 's1-w2', label: 'Delegate: forecast sub-agent', state: 'done', kind: 'subagent', depth: 0 },
          {
            id: 's1-w3',
            label: 'Fit trend model',
            state: 'done',
            kind: 'tool',
            parent: 's1-w2',
            depth: 1,
          },
          {
            id: 's1-w4',
            label: 'Verify gate',
            state: 'done',
            kind: 'decision',
            depth: 0,
            detail: 'verified — grounded in a successful data-access',
          },
        ],
      },
      { id: 's1-e13', kind: 'user', text: "What is Jane Doe's exact salary?" },
      {
        id: 's1-e14',
        kind: 'refusal',
        reason: 'This question needs a column your role cannot read.',
        fix: 'Ask a workspace admin to grant read access, or ask about an aggregate that does not expose individual values.',
      },
    ],
    // No live/in-progress turn for this resumed thread — every completed
    // turn's trace lives on its own `AnswerEvent.trace` instead (see s1-e12).
    workLog: [],
  },

  s2: {
    id: 's2',
    title: 'Monthly signups trend',
    updatedAt: '1h ago',
    events: [
      { id: 's2-e1', kind: 'user', text: 'Monthly signups trend' },
      {
        id: 's2-e2',
        kind: 'answer',
        answer: { form: 'rich', envelope: fixtureEnvelopes.explainChange },
        // Demonstrates the full reasoning flow, persisted on this turn's own
        // answer: two LLM reasoning steps (`resolve_intent`, `generate_sql`)
        // whose `detail` expands to that step's output, interleaved with the
        // tool-call trace. Then a SQL-repair retry: the first `query` attempt
        // errors (bad column name), the second retry succeeds — expanding the
        // errored step shows the failed SQL and why.
        trace: [
          {
            id: 's2-w0a',
            label: 'resolve_intent',
            state: 'done',
            kind: 'step',
            depth: 0,
            detail:
              'query_intent: Monthly count of new signups over time, ordered chronologically — a trend line.',
          },
          {
            id: 's2-w0b',
            label: 'generate_sql',
            state: 'done',
            kind: 'step',
            depth: 0,
            detail:
              'Selected the signups_monthly model; grouping by month and ordering ascending to form the trend.',
          },
          {
            id: 's2-w1',
            label: 'query',
            state: 'error',
            kind: 'tool',
            depth: 0,
            input: { sql: 'SELECT month, signup_cnt FROM signups_monthly ORDER BY month' },
            detail: 'column "signup_cnt" does not exist — did you mean "signup_count"?',
          },
          {
            id: 's2-w2',
            label: 'query',
            state: 'done',
            kind: 'tool',
            depth: 0,
            input: { sql: 'SELECT month, signup_count FROM signups_monthly ORDER BY month' },
            detail: 'Returned 12 rows from signups_monthly.',
          },
        ],
      },
    ],
    // See s1's note — the trace lives on `s2-e2.trace`, not this slot.
    workLog: [],
  },

  s3: {
    id: 's3',
    title: 'Churn by plan',
    updatedAt: 'yesterday',
    events: [
      { id: 's3-e1', kind: 'user', text: 'Churn by plan' },
      {
        id: 's3-e2',
        kind: 'answer',
        answer: { form: 'rich', envelope: fixtureEnvelopes.forecast },
      },
    ],
    workLog: [],
  },
};
