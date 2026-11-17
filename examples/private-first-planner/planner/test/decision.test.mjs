import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanDecision } from '../plan.mjs';

const caps = [{ id: 'analytics', description: 'Read-only analysis', rules: true }];
const group = { id: 'total', capability: 'analytics', metric: 'Revenue using the project definition', grain: 'scalar' };
const constraints = { period: { lower: '2026-01-01', upper: '2026-01-19', timezone: 'UTC' }, filters: ['exclude test orders'], requested_statuses: [] };
const plan = { name: 'plan_queries', args: { objective: 'Revenue', constraints, groups: [group] } };
const clarify = { name: 'clarify_intent', args: { question: 'Which metric and period?' } };

test('decision schema rejects invented capabilities, routing, duplicate IDs and extra fields', () => {
  assert.throws(() => parsePlanDecision('delegate_cloud', {}, caps));
  for (const bad of [{ ...group, capability: 'sql' }, { ...group, model: 'gpt' }, { ...group, grain: 'everything' }])
    assert.throws(() => parsePlanDecision('plan_queries', { objective: 'x', constraints, groups: [bad] }, caps));
  assert.throws(() => parsePlanDecision('plan_queries', { objective: 'x', constraints, groups: [group, group] }, caps));
});

test('planner period contract rejects missing, reversed or invalid dates', () => {
  for (const period of [null,{lower:'2026-01-20',upper:'2026-01-19',timezone:'UTC'}, {lower:'2026-02-30',upper:'2026-03-02',timezone:'UTC'}])
    assert.throws(() => parsePlanDecision('plan_queries', {...plan.args,constraints:{...constraints,period}},caps));
});

test('open-ended clarification has one question, without generated option lists', () => {
  assert.deepEqual(parsePlanDecision('clarify_intent', { question: 'Which metric and period?' }, caps), clarify);
  assert.throws(() => parsePlanDecision('clarify_intent', { question: 'Which metric?', options: ['A', 'B'] }, caps));
});
