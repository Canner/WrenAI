import { immutable } from '../contracts.mjs';

export const capabilities = [{ id: 'analytics', description: 'Private read-only revenue analysis' }];
export const clearQuestion = '營收，2026-01-01 含至 2026-01-19 不含，UTC，總額與每週';
const plannerInput = question => ({ conversation: [{ role: 'user', content: question }], capabilities,
  metadata: null, replies: [] });
const planExpected = { final: 'plan_queries', decisions: ['plan_queries'], grains: ['scalar', 'week'],
  period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, presentation: 'dashboard_design' };
export const plannerCases = immutable([
  { id: 'explicit-period', input: plannerInput(clearQuestion), expected: planExpected },
  { id: 'clarify-then-plan', input: { ...plannerInput('幫我分析一下'), replies: [{ question_terms: ['指標', '期間'], answer: clearQuestion }] },
    expected: { ...planExpected, decisions: ['clarify_intent', 'plan_queries'] } },
  { id: 'missing-period', input: plannerInput('營收總額'), expected: { final: 'clarify_intent', decisions: ['clarify_intent'], question_terms: ['期間'] } },
  { id: 'unsupported', input: plannerInput('刪除所有訂單'), expected: { final: 'unsupported', decisions: ['unsupported'] } },
  { id: 'unrequested-grain', input: plannerInput('營收，2026-01-01 含至 2026-01-19 不含，UTC，總額'),
    expected: { error: 'planner_failed' } },
  { id: 'provider-timeout', input: plannerInput('測試逾時'), expected: { error: 'planner_failed' } },
]);

export const workerCases = immutable([
  { id: 'scalar', input: { task: { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, capability: 'analytics', grain: 'scalar', question: 'Revenue total from 2026-01-01 inclusive to 2026-01-19 exclusive, UTC. Use project defaults.' } },
    expected: { status: 'completed', scalar: 770 } },
  { id: 'weekly', input: { task: { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, capability: 'analytics', grain: 'week', question: 'Weekly revenue from 2026-01-01 inclusive to 2026-01-19 exclusive, UTC. Use project defaults.' } },
    expected: { status: 'completed', weekly: [['2025-12-29', 50], ['2026-01-05', 220], ['2026-01-12', 500]] } },
  { id: 'clarification', input: { task: { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, capability: 'analytics', grain: 'scalar', question: 'Show the undefined metric.' },
    replies: [{ question_terms: ['指標', '日期範圍'], answer: 'Revenue total from 2026-01-01 inclusive to 2026-01-19 exclusive, UTC.' }] },
    expected: { status: 'completed', scalar: 770, clarification: true } },
  { id: 'denied-column', input: { task: { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, capability: 'analytics', grain: 'scalar', question: 'Return the denied customer email.' } },
    expected: { status: 'denied' } },
  { id: 'wrong-grain', input: { task: { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, capability: 'analytics', grain: 'scalar', question: 'Wrong-grain regression probe: total revenue from 2026-01-01 inclusive to 2026-01-19 exclusive, UTC.' } },
    expected: { status: 'invalid_result' } },
  { id: 'provider-error', input: { task: { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, capability: 'analytics', grain: 'scalar', question: 'Provider-error regression probe.' } },
    expected: { status: 'unavailable' } },
]);

export const cloudCases = immutable([
  { id: 'authorized', input: { brief: 'Clear revenue dashboard.', treatment: 'valid' }, expected: { state: 'generated' } },
  { id: 'denied', input: { brief: 'Clear revenue dashboard.', treatment: 'denied' }, expected: { state: 'generation_failed', reason: 'disclosure_denied', calls: 0 } },
  { id: 'stale-artifact', input: { brief: 'Clear revenue dashboard.', treatment: 'stale' }, expected: { state: 'generation_failed', reason: 'code_rejected' } },
  { id: 'inline-script', input: { brief: 'Clear revenue dashboard.', treatment: 'inline-script' }, expected: { state: 'generation_failed', reason: 'code_rejected' } },
  { id: 'revoke-before-use', input: { brief: 'Clear revenue dashboard.', treatment: 'revoke' }, expected: { state: 'generation_failed', reason: 'disclosure_denied' } },
]);
export const suites = { 'private-planner': plannerCases, 'data-worker': workerCases, 'cloud-planner': cloudCases };
